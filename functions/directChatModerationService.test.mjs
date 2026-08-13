import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it } from 'vitest';

import { createFakeBucket, createFakeDb, seedPair } from './directChatTestSupport.mjs';

const require = createRequire(import.meta.url);
const { createDirectConversationId } = require('./directChatCore');
const { executeDirectChatCommand } = require('./directChatService');
const {
  executeDirectChatModerationAction,
  resolveDirectChatEvidence,
} = require('./directChatModerationService');

const owner = 'platform-owner';
const globalScope = { ok: true, regionCodes: null };
const conversationId = createDirectConversationId('user-1', 'user-2');

describe('directChatModerationService', () => {
  let db;
  let bucket;
  let reportId;
  let messageIds;

  beforeEach(async () => {
    db = createFakeDb();
    bucket = createFakeBucket();
    seedPair(db, { friends: true });
    db.write('publicProfiles/user-2', { countryCode: 'IQ', displayName: 'Two', moderationStatus: 'active', uid: 'user-2' });
    const first = await execute(db, 'user-2', directMessage('user-1', 'moderation_seed_0001', 'First abusive line'));
    const second = await execute(db, 'user-2', directMessage('user-1', 'moderation_seed_0002', 'Second abusive line'));
    seedAttachmentMessage(db, bucket);
    const submitted = await execute(db, 'user-1', reportChat('user-2', 'moderation_report_001', [first.result.messageId, second.result.messageId, 'dmm_attachment_seed']));
    expect(submitted).toMatchObject({ ok: true });
    reportId = submitted.result.reportId;
    messageIds = [first.result.messageId, second.result.messageId];
  });

  it('writes an audit event on every view and returns sequence-ordered snapshots with signed media', async () => {
    const first = await viewEvidence(db, bucket, 'direct_chat_view_000001');
    expect(first.case).toMatchObject({ reportId, source: 'direct-chat-safety-v1', status: 'open', targetUid: 'user-2' });
    expect(first.snapshots.map((snapshot) => snapshot.sequence)).toEqual([1, 2, 3]);
    expect(first.snapshots.filter((snapshot) => snapshot.selected)).toHaveLength(3);
    expect(first.mediaGranted).toBe(1);
    expect(first.snapshots.at(-1)).toMatchObject({ mediaHeld: true });
    expect(first.snapshots.at(-1).mediaUrl).toContain('https://signed.test/');
    expect(bucket.signed).toEqual([expect.objectContaining({ action: 'read', version: 'v4' })]);
    expect(db.read(`adminAuditEvents/direct_chat_evidence_view_direct_chat_view_000001`)).toMatchObject({
      actorRole: 'owner',
      actorUid: owner,
      countryCode: 'IQ',
      kind: 'direct-chat-evidence-view',
      mediaGranted: 1,
      reason: 'Escalated threat review',
      reportId,
      snapshotCount: 3,
      targetUid: 'user-2',
    });

    // A second look at the same case must cost a second audit entry: the log is per view, not per case.
    await viewEvidence(db, bucket, 'direct_chat_view_000002');
    expect(db.paths('adminAuditEvents/direct_chat_evidence_view_')).toHaveLength(2);
  });

  it('rejects a replayed evidence requestId instead of returning content without a new log entry', async () => {
    await viewEvidence(db, bucket, 'direct_chat_view_000003');
    await expect(viewEvidence(db, bucket, 'direct_chat_view_000003')).rejects.toMatchObject({ status: 409 });
    expect(db.paths('adminAuditEvents/direct_chat_evidence_view_')).toHaveLength(1);
  });

  it('refuses to open evidence for a report that is not a direct-message safety report', async () => {
    db.write('reports/voice_report_1', { countryCode: 'IQ', severity: 'high', source: 'voice-room-safety-v1', status: 'open', targetUid: 'user-2' });
    await expect(resolveDirectChatEvidence({
      assertReportScope,
      bucket,
      clock: db.clock,
      db,
      decodedToken: ownerToken(),
      request: { reason: 'Escalated threat review', reportId: 'voice_report_1', requestId: 'direct_chat_view_000004' },
      scope: globalScope,
    })).rejects.toMatchObject({ status: 400 });
    expect(db.paths('adminAuditEvents/direct_chat_evidence_view_')).toHaveLength(0);
  });

  it('refuses evidence and enforcement outside the operator region scope', async () => {
    const scope = { ok: true, regionCodes: ['EG'], role: 'super-moderator' };
    await expect(resolveDirectChatEvidence({
      assertReportScope,
      bucket,
      clock: db.clock,
      db,
      decodedToken: ownerToken('super-moderator'),
      request: { reason: 'Escalated threat review', reportId, requestId: 'direct_chat_view_000005' },
      scope,
    })).rejects.toMatchObject({ status: 403 });
    await expect(runAction(db, { directChatAction: 'dismiss', requestId: 'direct_chat_act_000001' }, { scope }))
      .rejects.toMatchObject({ status: 403 });
    expect(db.paths('adminAuditEvents/direct_chat_evidence_view_')).toHaveLength(0);
    expect(db.paths('adminAuditEvents/direct_chat_action_')).toHaveLength(0);
    expect(db.read(`reports/${reportId}`)).toMatchObject({ status: 'open' });
  });

  it('requires fresh administrator authentication before unmasking content', async () => {
    await expect(resolveDirectChatEvidence({
      assertReportScope,
      bucket,
      clock: db.clock,
      db,
      decodedToken: { ...ownerToken(), auth_time: Math.floor((Date.now() - (48 * 60 * 60 * 1_000)) / 1_000) },
      request: { reason: 'Escalated threat review', reportId, requestId: 'direct_chat_view_000006' },
      scope: globalScope,
    })).rejects.toMatchObject({ code: 'FRESH_AUTH_REQUIRED', status: 401 });
    expect(db.paths('adminAuditEvents/direct_chat_evidence_view_')).toHaveLength(0);
  });

  it('removes only the reported messages and refreshes both conversation projections', async () => {
    const other = await execute(db, 'user-1', directMessage('user-2', 'moderation_seed_0003', 'Unreported reply'));
    expect(db.read(`directConversationMembers/user-1/items/${conversationId}`).unreadCount).toBe(2);
    expect(db.read('directChatInboxSummaries/user-1').totalUnreadCount).toBe(2);
    await expect(runAction(db, {
      directChatAction: 'remove-direct-message',
      messageIds: [other.result.messageId],
      requestId: 'direct_chat_act_000002',
    })).rejects.toMatchObject({ status: 400 });
    expect(db.read(`directConversations/${conversationId}/messages/${other.result.messageId}`)).toMatchObject({ visibilityState: 'visible' });

    const eventId = await runAction(db, {
      directChatAction: 'remove-direct-message',
      messageIds,
      requestId: 'direct_chat_act_000003',
    });
    expect(eventId).toBe('direct_chat_action_direct_chat_act_000003');
    for (const messageId of messageIds) {
      expect(db.read(`directConversations/${conversationId}/messages/${messageId}`)).toMatchObject({
        moderationRemovedBy: owner,
        text: '',
        unreadForUids: [],
        visibilityState: 'removed',
      });
    }
    // The immutable snapshot is what staff and any later appeal rely on, so it must survive removal.
    expect(db.read(`directChatReports/${reportId}/evidence/${messageIds[0]}`)).toMatchObject({
      text: 'First abusive line',
      visibilityState: 'visible',
    });
    expect(db.read(`directChatReports/${reportId}`)).toMatchObject({ removedMessageIds: [...messageIds].sort() });
    // Both removed messages were still unread for the recipient, so the badge must drop with them.
    expect(db.read(`directConversationMembers/user-1/items/${conversationId}`).unreadCount).toBe(0);
    expect(db.read('directChatInboxSummaries/user-1').totalUnreadCount).toBe(0);
    expect(db.read(`directConversationMembers/user-2/items/${conversationId}`).unreadCount).toBe(1);
  });

  it('marks the conversation preview as removed when the last message is taken down', async () => {
    await runAction(db, { directChatAction: 'remove-direct-message', messageIds: ['dmm_attachment_seed'], requestId: 'direct_chat_act_000004' });
    expect(db.read(`directConversations/${conversationId}`)).toMatchObject({ lastMessageKind: 'removed', lastMessagePreview: 'Message removed' });
    expect(db.read(`directConversationMembers/user-1/items/${conversationId}`)).toMatchObject({ lastMessagePreview: 'Message removed' });
  });

  it('restricts direct chat for real and lifts it again', async () => {
    await runAction(db, { directChatAction: 'restrict-direct-chat', durationHours: 72, requestId: 'direct_chat_act_000005' });
    expect(db.read('directChatRestrictions/user-2')).toMatchObject({
      actorUid: owner,
      reportId,
      startsAt: db.clock.now,
      state: 'restricted',
      uid: 'user-2',
    });

    // The blast radius is both directions: the restricted user can neither send nor receive.
    await expect(execute(db, 'user-2', directMessage('user-1', 'moderation_after_0001', 'Still here')))
      .resolves.toMatchObject({ code: 'ACCOUNT_RESTRICTED', ok: false });
    await expect(execute(db, 'user-1', directMessage('user-2', 'moderation_after_0002', 'Hello again')))
      .resolves.toMatchObject({ code: 'ACCOUNT_RESTRICTED', ok: false });
    // Reporting deliberately survives the restriction the enforcement just created.
    await expect(execute(db, 'user-2', reportChat('user-1', 'moderation_after_0003', [messageIds[0]])))
      .resolves.toMatchObject({ ok: true });

    await runAction(db, { directChatAction: 'clear-direct-chat-restriction', requestId: 'direct_chat_act_000006' });
    expect(db.read('directChatRestrictions/user-2')).toMatchObject({ state: 'cleared' });
    await expect(execute(db, 'user-2', directMessage('user-1', 'moderation_after_0004', 'Back again')))
      .resolves.toMatchObject({ ok: true });
  });

  it('closes both the evidence case and the parent report on dismiss', async () => {
    await runAction(db, { directChatAction: 'dismiss', note: 'No policy violation found', requestId: 'direct_chat_act_000007' });
    expect(db.read(`directChatReports/${reportId}`)).toMatchObject({ dismissedBy: owner, status: 'dismissed' });
    expect(db.read(`reports/${reportId}`)).toMatchObject({
      resolutionNote: 'No policy violation found',
      resolvedBy: owner,
      status: 'resolved',
    });
  });

  it('extends retention on legal hold and keeps the case open', async () => {
    const before = db.read(`directChatReports/${reportId}`).retentionUntilMs;
    await runAction(db, { directChatAction: 'set-direct-chat-legal-hold', legalHold: true, requestId: 'direct_chat_act_000008' });
    const evidenceCase = db.read(`directChatReports/${reportId}`);
    expect(evidenceCase.legalHold).toBe(true);
    expect(evidenceCase.retentionUntilMs).toBeGreaterThan(before);
    expect(evidenceCase.status).toBe('open');
  });

  it('prefers the isolated evidence copy over the live conversation object once it exists', async () => {
    const evidencePath = `direct-chat-evidence/${reportId}/dmm_attachment_seed/image.webp`;
    bucket.seed(evidencePath, Buffer.from('copied-bytes'), { contentType: 'image/webp' });
    db.write(`directChatReports/${reportId}/evidence/dmm_attachment_seed`, {
      ...db.read(`directChatReports/${reportId}/evidence/dmm_attachment_seed`),
      evidenceMediaState: 'copied',
      evidencePath,
    });
    // The copy has to outlive the live object, which is the whole point of isolating the bytes.
    await bucket.file(`direct-chat-media/${conversationId}/attachment_seed.webp`).delete();
    db.write('directChatUploads/attachment_seed', { ...db.read('directChatUploads/attachment_seed'), evidenceHold: false });

    const evidence = await viewEvidence(db, bucket, 'direct_chat_view_000010');
    expect(evidence.mediaGranted).toBe(1);
    expect(evidence.snapshots.at(-1)).toMatchObject({ mediaHeld: true, mediaIsolated: true, mediaState: 'copied' });
    expect(evidence.snapshots.at(-1).mediaUrl).toContain(encodeURIComponent(evidencePath));
  });

  it('falls back to the held live object while the evidence copy is still pending', async () => {
    const snapshot = db.read(`directChatReports/${reportId}/evidence/dmm_attachment_seed`);
    expect(snapshot.evidenceMediaState).toBe('pending');
    const evidence = await viewEvidence(db, bucket, 'direct_chat_view_000011');
    expect(evidence.mediaGranted).toBe(1);
    expect(evidence.snapshots.at(-1)).toMatchObject({ mediaHeld: true, mediaIsolated: false, mediaState: 'pending' });
    expect(evidence.snapshots.at(-1).mediaUrl).toContain(encodeURIComponent(`direct-chat-media/${conversationId}/attachment_seed.webp`));
  });

  it('mints no url when the copy is marked missing and the live object is gone', async () => {
    db.write(`directChatReports/${reportId}/evidence/dmm_attachment_seed`, {
      ...db.read(`directChatReports/${reportId}/evidence/dmm_attachment_seed`),
      evidenceMediaState: 'missing',
      evidencePath: '',
    });
    db.write('directChatUploads/attachment_seed', { ...db.read('directChatUploads/attachment_seed'), evidenceHold: false });
    const evidence = await viewEvidence(db, bucket, 'direct_chat_view_000012');
    expect(evidence.mediaGranted).toBe(0);
    expect(evidence.snapshots.at(-1)).toMatchObject({ mediaHeld: false, mediaIsolated: false, mediaState: 'missing', mediaUrl: '' });
  });

  it('replays an action requestId for the same actor and conflicts for another', async () => {
    const first = await runAction(db, { directChatAction: 'dismiss', requestId: 'direct_chat_act_000009' });
    const replayed = await runAction(db, { directChatAction: 'dismiss', requestId: 'direct_chat_act_000009' });
    expect(replayed).toBe(first);
    await expect(runAction(db, { directChatAction: 'dismiss', requestId: 'direct_chat_act_000009' }, {
      decodedToken: { ...ownerToken(), uid: 'other-owner' },
    })).rejects.toMatchObject({ status: 409 });
    expect(db.paths('adminAuditEvents/direct_chat_action_')).toHaveLength(1);
  });
});

function viewEvidence(db, bucket, requestId) {
  return resolveDirectChatEvidence({
    assertReportScope,
    bucket,
    clock: db.clock,
    db,
    decodedToken: ownerToken(),
    request: { reason: 'Escalated threat review', reportId: currentReportId(db), requestId },
    scope: globalScope,
  });
}

function runAction(db, { directChatAction, ...rest }, { decodedToken, scope = globalScope } = {}) {
  return executeDirectChatModerationAction({
    action: {
      action: directChatAction,
      durationHours: undefined,
      legalHold: false,
      messageIds: [],
      note: 'Confirmed harassment',
      reportId: currentReportId(db),
      ...rest,
    },
    assertReportScope,
    clock: db.clock,
    db,
    decodedToken: decodedToken || ownerToken(),
    scope,
  });
}

function currentReportId(db) {
  const path = db.paths('directChatReports/').find((entry) => entry.split('/').length === 2);
  return path ? path.split('/')[1] : '';
}

function ownerToken(role = 'owner') {
  return {
    admin: true,
    adminRole: role,
    auth_time: Math.floor(Date.now() / 1_000),
    email: 'owner@example.test',
    email_verified: true,
    uid: owner,
  };
}

// Mirrors filterOperationalRowsByScope in functions/index.js: DM reports carry no roomId, so the
// region comes from the reported user's profile with the stored countryCode as the fallback.
async function assertReportScope(db, scope, report) {
  if (!scope.regionCodes) return report;
  const profile = await db.doc(`publicProfiles/${report.targetUid || report.reporterUid}`).get();
  const countryCode = String((profile.exists ? profile.data().countryCode : '') || report.countryCode || '').trim().toUpperCase();
  if (!scope.regionCodes.includes(countryCode)) {
    const error = new Error('This report is outside the operator region scope.');
    error.code = 'REGION_SCOPE_DENIED';
    error.status = 403;
    throw error;
  }
  return { ...report, countryCode };
}

// Writes a finalized attachment message straight into the thread so the evidence viewer has held
// media to sign without running the full image pipeline in this suite.
function seedAttachmentMessage(db, bucket) {
  const mediaPath = `direct-chat-media/${conversationId}/attachment_seed.webp`;
  bucket.seed(mediaPath, Buffer.from('webp-bytes'), { contentType: 'image/webp' });
  db.write('directChatUploads/attachment_seed', {
    contentType: 'image/webp',
    conversationId,
    kind: 'image',
    mediaPath,
    state: 'finalized',
    targetUid: 'user-1',
    uid: 'user-2',
  });
  db.write(`directConversations/${conversationId}/messages/dmm_attachment_seed`, {
    attachmentId: 'attachment_seed',
    conversationId,
    createdAt: db.clock.now,
    id: 'dmm_attachment_seed',
    kind: 'image',
    mediaContentType: 'image/webp',
    mediaPath,
    senderUid: 'user-2',
    sequence: 3,
    text: '',
    unreadForUids: ['user-1'],
    visibilityState: 'visible',
  });
  db.write(`directConversations/${conversationId}`, {
    ...db.read(`directConversations/${conversationId}`),
    lastMessageId: 'dmm_attachment_seed',
    lastMessageKind: 'image',
    lastMessagePreview: 'Message',
    lastMessageSenderUid: 'user-2',
    lastSequence: 3,
  });
}

function directMessage(targetUid, requestId, text) {
  return { action: 'send-direct-message', payload: { kind: 'text', targetUid, text }, requestId, version: 1 };
}

function reportChat(targetUid, requestId, messageIds, category = 'harassment') {
  return { action: 'report-direct-chat', payload: { category, messageIds, targetUid }, requestId, version: 1 };
}

function execute(db, uid, body) {
  return executeDirectChatCommand({
    body,
    clock: db.clock,
    db,
    decodedToken: { email: `${uid}@example.test`, email_verified: true, uid },
  });
}
