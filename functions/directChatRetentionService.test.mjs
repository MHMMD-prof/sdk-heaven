import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it } from 'vitest';

import { createFakeBucket, createFakeDb, seedPair } from './directChatTestSupport.mjs';

const require = createRequire(import.meta.url);
const { createDirectConversationId } = require('./directChatCore');
const { executeDirectChatCommand } = require('./directChatService');
const {
  cleanupDirectChatEvidence,
  cleanupDirectChatMessages,
  copyDirectChatEvidenceMedia,
} = require('./directChatRetentionService');

const DAY_MS = 24 * 60 * 60 * 1_000;
const conversationId = createDirectConversationId('user-1', 'user-2');
const attachmentMessageId = `dmm_${'a'.repeat(40)}`;
const fieldValue = { delete: () => 'DELETED' };

describe('directChatRetentionService', () => {
  let db;
  let bucket;

  beforeEach(() => {
    db = createFakeDb();
    bucket = createFakeBucket();
    seedPair(db, { friends: true });
  });

  it('deletes the expired prefix, raises the watermark, and keeps lastSequence intact', async () => {
    await send('user-2', 'user-1', 'retention_seed_0001', 'Oldest line');
    await send('user-2', 'user-1', 'retention_seed_0002', 'Older line');
    db.clock.now += 400 * DAY_MS;
    const recent = await send('user-2', 'user-1', 'retention_seed_0003', 'Recent line');

    const result = await cleanupDirectChatMessages({ bucket, clock: db.clock, db });
    expect(result).toMatchObject({ deleted: 2, scanned: 1, wrapped: true });

    const remaining = db.paths(`directConversations/${conversationId}/messages/`);
    expect(remaining).toEqual([`directConversations/${conversationId}/messages/${recent.result.messageId}`]);
    const conversation = db.read(`directConversations/${conversationId}`);
    expect(conversation.retentionPurgedThroughSequence).toBe(2);
    expect(conversation.lastSequence).toBe(3);
    expect(db.read(`directConversationMembers/user-1/items/${conversationId}`).retentionPurgedThroughSequence).toBe(2);
    expect(db.read(`directConversationMembers/user-2/items/${conversationId}`).retentionPurgedThroughSequence).toBe(2);
  });

  it('hides purged history from the thread read without hiding the surviving tail', async () => {
    await send('user-2', 'user-1', 'retention_seed_0004', 'Oldest line');
    db.clock.now += 400 * DAY_MS;
    await send('user-2', 'user-1', 'retention_seed_0005', 'Recent line');
    await cleanupDirectChatMessages({ bucket, clock: db.clock, db });

    const thread = await execute('user-1', {
      action: 'get-direct-chat-thread',
      payload: { limit: 40, targetUid: 'user-2' },
      requestId: 'retention_thread_0001',
      version: 1,
    });
    expect(thread.ok).toBe(true);
    expect(thread.result.messages.map((message) => message.sequence)).toEqual([2]);
    expect(thread.result.hasMore).toBe(false);
  });

  it('drops the unread count and inbox summary for rows it deletes', async () => {
    await send('user-2', 'user-1', 'retention_seed_0006', 'One');
    await send('user-2', 'user-1', 'retention_seed_0007', 'Two');
    expect(db.read(`directConversationMembers/user-1/items/${conversationId}`).unreadCount).toBe(2);
    expect(db.read('directChatInboxSummaries/user-1').totalUnreadCount).toBe(2);

    db.clock.now += 400 * DAY_MS;
    await cleanupDirectChatMessages({ bucket, clock: db.clock, db });

    const projection = db.read(`directConversationMembers/user-1/items/${conversationId}`);
    expect(projection.unreadCount).toBe(0);
    expect(db.read('directChatInboxSummaries/user-1').totalUnreadCount).toBe(0);
    // The preview pointed at a row that no longer exists, so it has to be cleared with it.
    expect(db.read(`directConversations/${conversationId}`)).toMatchObject({ lastMessageId: '', lastMessagePreview: '' });
    expect(projection.lastMessagePreview).toBe('');
  });

  it('defers an expired row whose held bytes are not isolated yet, then purges both', async () => {
    const mediaPath = seedAttachmentMessage({ evidenceHold: true });
    db.clock.now += 400 * DAY_MS;

    // Deleting the row here would orphan the object, because the row is the only pointer to it.
    const deferred = await cleanupDirectChatMessages({ bucket, clock: db.clock, db });
    expect(deferred).toMatchObject({ deleted: 0, mediaDeleted: 0 });
    expect(db.read(`directConversations/${conversationId}/messages/${attachmentMessageId}`)).toBeTruthy();
    expect(bucket.paths('direct-chat-media/')).toEqual([mediaPath]);
    expect(db.read(`directConversations/${conversationId}`).retentionPurgedThroughSequence).toBe(0);

    db.write('directChatUploads/dmu_attachment', { ...db.read('directChatUploads/dmu_attachment'), evidenceCopiedAt: db.clock.now });
    db.write('directChatRetention/sweepState', { cursor: '' });
    const released = await cleanupDirectChatMessages({ bucket, clock: db.clock, db });
    expect(released).toMatchObject({ deleted: 1, mediaDeleted: 1 });
    expect(db.read(`directConversations/${conversationId}/messages/${attachmentMessageId}`)).toBeUndefined();
    expect(bucket.paths('direct-chat-media/')).toEqual([]);
    expect(db.read('directChatUploads/dmu_attachment')).toBeUndefined();
  });

  it('does not let a deferred held row block the rest of the thread forever', async () => {
    seedAttachmentMessage({ evidenceHold: true });
    await send('user-2', 'user-1', 'retention_seed_0011', 'Later line');
    db.clock.now += 400 * DAY_MS;

    const blocked = await cleanupDirectChatMessages({ bucket, clock: db.clock, db });
    expect(blocked.deleted).toBe(0);

    db.write('directChatUploads/dmu_attachment', { ...db.read('directChatUploads/dmu_attachment'), evidenceCopiedAt: db.clock.now });
    db.write('directChatRetention/sweepState', { cursor: '' });
    const unblocked = await cleanupDirectChatMessages({ bucket, clock: db.clock, db });
    expect(unblocked.deleted).toBe(2);
    expect(db.paths(`directConversations/${conversationId}/messages/`)).toEqual([]);
  });

  it('copies pending evidence media into the report prefix exactly once', async () => {
    const reportId = await seedReport();
    const first = await copyDirectChatEvidenceMedia({ bucket, clock: db.clock, db });
    expect(first).toMatchObject({ copied: 1, missing: 0 });
    const expectedPath = `direct-chat-evidence/${reportId}/${attachmentMessageId}/image.webp`;
    expect(bucket.paths('direct-chat-evidence/')).toEqual([expectedPath]);
    expect(db.read(`directChatReports/${reportId}/evidence/${attachmentMessageId}`)).toMatchObject({
      evidenceMediaState: 'copied',
      evidencePath: expectedPath,
    });
    expect(db.read('directChatUploads/dmu_attachment').evidenceCopiedAt).toBeTruthy();

    const second = await copyDirectChatEvidenceMedia({ bucket, clock: db.clock, db });
    expect(second).toMatchObject({ copied: 0, missing: 0, scanned: 0 });
    expect(bucket.copies).toHaveLength(1);
  });

  it('marks a vanished source missing and still releases the hold so the object cannot leak', async () => {
    const reportId = await seedReport();
    await bucket.file(db.read(`directChatReports/${reportId}/evidence/${attachmentMessageId}`).mediaPath).delete();

    const result = await copyDirectChatEvidenceMedia({ bucket, clock: db.clock, db });
    expect(result).toMatchObject({ copied: 0, missing: 1 });
    expect(db.read(`directChatReports/${reportId}/evidence/${attachmentMessageId}`)).toMatchObject({
      evidenceMediaState: 'missing',
      evidencePath: '',
    });
    expect(db.read('directChatUploads/dmu_attachment').evidenceCopiedAt).toBeTruthy();
    expect(bucket.paths('direct-chat-evidence/')).toEqual([]);
  });

  it('never expires evidence under an active legal hold', async () => {
    const reportId = await seedReport();
    await copyDirectChatEvidenceMedia({ bucket, clock: db.clock, db });
    db.write(`directChatReports/${reportId}`, {
      ...db.read(`directChatReports/${reportId}`),
      legalHold: true,
      retentionUntilMs: db.clock.now - 1,
    });

    const result = await cleanupDirectChatEvidence({ bucket, clock: db.clock, db, fieldValue });
    expect(result).toMatchObject({ expired: 0, objectsDeleted: 0, scanned: 0 });
    expect(db.read(`directChatReports/${reportId}`).status).toBe('open');
    expect(db.paths(`directChatReports/${reportId}/evidence/`)).not.toHaveLength(0);
    expect(bucket.paths('direct-chat-evidence/')).toHaveLength(1);
  });

  it('tombstones an expired case, deletes its snapshots and copies, and does not re-select it', async () => {
    const reportId = await seedReport();
    await copyDirectChatEvidenceMedia({ bucket, clock: db.clock, db });
    db.write(`directChatReports/${reportId}`, { ...db.read(`directChatReports/${reportId}`), retentionUntilMs: db.clock.now - 1 });

    const first = await cleanupDirectChatEvidence({ bucket, clock: db.clock, db, fieldValue });
    expect(first).toMatchObject({ expired: 1, objectsDeleted: 1, scanned: 1 });
    expect(db.read(`directChatReports/${reportId}`)).toMatchObject({
      attachmentIds: [],
      retentionUntilMs: 'DELETED',
      snapshotCount: 0,
      status: 'expired',
    });
    expect(db.paths(`directChatReports/${reportId}/evidence/`)).toEqual([]);
    expect(bucket.paths('direct-chat-evidence/')).toEqual([]);

    // Dropping the deadline is what keeps the tombstone out of every later sweep.
    const second = await cleanupDirectChatEvidence({ bucket, clock: db.clock, db, fieldValue });
    expect(second).toMatchObject({ expired: 0, scanned: 0 });
  });

  it('advances the sweep cursor across conversations and wraps at the end', async () => {
    await send('user-2', 'user-1', 'retention_seed_0008', 'Pair one');
    db.write('publicProfiles/user-3', { displayName: 'Three', moderationStatus: 'active', uid: 'user-3' });
    db.write(`friendships/${require('./socialFriendsCore').createFriendshipId('user-1', 'user-3')}`, { memberUids: ['user-1', 'user-3'] });
    await send('user-3', 'user-1', 'retention_seed_0009', 'Pair two');
    const ids = db.paths('directConversations/')
      .filter((path) => path.split('/').length === 2)
      .map((path) => path.split('/')[1])
      .sort();
    expect(ids).toHaveLength(2);

    const first = await cleanupDirectChatMessages({ bucket, clock: db.clock, conversationLimit: 1, db });
    expect(first).toMatchObject({ scanned: 1, wrapped: false });
    expect(db.read('directChatRetention/sweepState').cursor).toBe(ids[0]);

    const second = await cleanupDirectChatMessages({ bucket, clock: db.clock, conversationLimit: 1, db });
    expect(second).toMatchObject({ scanned: 1, wrapped: false });
    expect(db.read('directChatRetention/sweepState').cursor).toBe(ids[1]);

    const third = await cleanupDirectChatMessages({ bucket, clock: db.clock, conversationLimit: 1, db });
    expect(third).toMatchObject({ scanned: 0, wrapped: true });
    expect(db.read('directChatRetention/sweepState')).toMatchObject({ cursor: '', wrapped: true });
  });

  it('honours a lowered policy immediately without any per-message backfill', async () => {
    await send('user-2', 'user-1', 'retention_seed_0010', 'Only line');
    db.clock.now += 40 * DAY_MS;

    const untouched = await cleanupDirectChatMessages({ bucket, clock: db.clock, db });
    expect(untouched.deleted).toBe(0);

    db.write('directChatRetention/current', { messageRetentionDays: 30 });
    db.write('directChatRetention/sweepState', { cursor: '' });
    const purged = await cleanupDirectChatMessages({ bucket, clock: db.clock, db });
    expect(purged.deleted).toBe(1);
  });

  function send(fromUid, targetUid, requestId, text) {
    return execute(fromUid, {
      action: 'send-direct-message',
      payload: { kind: 'text', targetUid, text },
      requestId,
      version: 1,
    });
  }

  function execute(uid, body) {
    return executeDirectChatCommand({
      body,
      clock: db.clock,
      db,
      decodedToken: { email: `${uid}@example.test`, email_verified: true, uid },
    });
  }

  // Writes a finalized attachment straight into the thread so the retention passes have real media
  // to reason about without running the whole image pipeline in this suite.
  function seedAttachmentMessage({ evidenceCopiedAt, evidenceHold = false, reuseUpload = false } = {}) {
    const mediaPath = `direct-chat-media/${conversationId}/dmu_attachment/image.webp`;
    if (!reuseUpload) bucket.seed(mediaPath, Buffer.from('webp-bytes'), { contentType: 'image/webp' });
    db.write('directChatUploads/dmu_attachment', {
      contentType: 'image/webp',
      conversationId,
      ...(evidenceCopiedAt ? { evidenceCopiedAt } : {}),
      evidenceHold,
      kind: 'image',
      mediaPath,
      state: 'finalized',
      targetUid: 'user-1',
      uid: 'user-2',
      uploadId: 'dmu_attachment',
    });
    db.write(`directConversations/${conversationId}/messages/${attachmentMessageId}`, {
      attachmentId: 'dmu_attachment',
      conversationId,
      createdAt: db.clock.now,
      id: attachmentMessageId,
      kind: 'image',
      mediaContentType: 'image/webp',
      mediaPath,
      senderUid: 'user-2',
      sequence: 1,
      text: '',
      unreadForUids: ['user-1'],
      visibilityState: 'visible',
    });
    db.write(`directConversations/${conversationId}`, {
      conversationId,
      createdAt: db.clock.now,
      lastMessageId: attachmentMessageId,
      lastMessageKind: 'image',
      lastMessagePreview: 'Attachment',
      lastMessageSenderUid: 'user-2',
      lastSequence: 1,
      lifecycleState: 'active',
      memberUids: ['user-1', 'user-2'],
      requestState: 'accepted',
      retentionPurgedThroughSequence: 0,
      schemaVersion: 1,
    });
    return mediaPath;
  }

  async function seedReport() {
    seedAttachmentMessage({ evidenceHold: false });
    const submitted = await execute('user-1', {
      action: 'report-direct-chat',
      payload: { category: 'harassment', messageIds: [attachmentMessageId], targetUid: 'user-2' },
      requestId: 'retention_report_0001',
      version: 1,
    });
    expect(submitted).toMatchObject({ ok: true });
    return submitted.result.reportId;
  }
});
