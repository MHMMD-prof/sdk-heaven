import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  DIRECT_CHAT_EVIDENCE_RETENTION_BOUNDS,
  DIRECT_CHAT_LEGAL_HOLD_RETENTION_BOUNDS,
  DIRECT_CHAT_MESSAGE_RETENTION_BOUNDS,
  buildDirectChatEvidenceExpiryPatch,
  buildDirectChatSweepState,
  directChatEvidenceObjectPath,
  mapDirectChatEvidenceMediaState,
  mapDirectChatRetentionPolicy,
  resolveDirectChatEvidenceExpiry,
  resolveDirectChatEvidenceMediaState,
  resolveDirectChatMediaPurge,
  resolveDirectChatMessagePurge,
  resolveDirectChatRetentionCutoffs,
} = require('./directChatRetentionCore');

const DAY_MS = 24 * 60 * 60 * 1_000;
const nowMs = Date.UTC(2026, 7, 4, 9);
const reportId = `dmr_${'a'.repeat(40)}`;
const messageId = (index) => `dmm_${String(index).padStart(40, '0')}`;

function message(index, ageDays, overrides = {}) {
  return {
    createdAt: nowMs - (ageDays * DAY_MS),
    id: messageId(index),
    sequence: index,
    unreadForUids: [],
    visibilityState: 'visible',
    ...overrides,
  };
}

describe('directChatRetentionCore', () => {
  it('falls back to defaults and clamps configuration to the platform hard bounds', () => {
    expect(mapDirectChatRetentionPolicy(undefined)).toEqual({
      evidenceRetentionDays: DIRECT_CHAT_EVIDENCE_RETENTION_BOUNDS.fallbackDays,
      legalHoldRetentionDays: DIRECT_CHAT_LEGAL_HOLD_RETENTION_BOUNDS.fallbackDays,
      messageRetentionDays: DIRECT_CHAT_MESSAGE_RETENTION_BOUNDS.fallbackDays,
      policyVersion: 1,
      source: 'default',
    });
    expect(mapDirectChatRetentionPolicy({
      evidenceRetentionDays: 100_000,
      legalHoldRetentionDays: 1,
      messageRetentionDays: 1,
    })).toMatchObject({
      evidenceRetentionDays: DIRECT_CHAT_EVIDENCE_RETENTION_BOUNDS.maxDays,
      legalHoldRetentionDays: DIRECT_CHAT_LEGAL_HOLD_RETENTION_BOUNDS.minDays,
      messageRetentionDays: DIRECT_CHAT_MESSAGE_RETENTION_BOUNDS.minDays,
      source: 'document',
    });
    expect(mapDirectChatRetentionPolicy({ messageRetentionDays: 'ninety' }).messageRetentionDays)
      .toBe(DIRECT_CHAT_MESSAGE_RETENTION_BOUNDS.fallbackDays);
  });

  it('derives the message cutoff from the configured policy at sweep time', () => {
    const cutoffs = resolveDirectChatRetentionCutoffs({ nowMs, policy: { messageRetentionDays: 30 } });
    expect(cutoffs.messageCutoffMs).toBe(nowMs - (30 * DAY_MS));
    const lowered = resolveDirectChatRetentionCutoffs({ nowMs, policy: { messageRetentionDays: 60 } });
    expect(lowered.messageCutoffMs).toBeLessThan(cutoffs.messageCutoffMs);
  });

  it('purges only the contiguous expired prefix and stops at the first message it cannot date', () => {
    const conversation = { lastMessageId: messageId(4), lastSequence: 4 };
    const purge = resolveDirectChatMessagePurge({
      conversation,
      cutoffMs: nowMs - (30 * DAY_MS),
      messages: [message(1, 90), message(2, 60), message(3, 10), message(4, 80)],
    });
    expect(purge.purged.map((entry) => entry.sequence)).toEqual([1, 2]);
    expect(purge.purgedThroughSequence).toBe(2);
    expect(purge.lastMessagePurged).toBe(false);

    const undated = resolveDirectChatMessagePurge({
      conversation,
      cutoffMs: nowMs,
      messages: [message(1, 90, { createdAt: undefined }), message(2, 90)],
    });
    expect(undated.purged).toEqual([]);
    expect(undated.purgedThroughSequence).toBe(0);
  });

  it('never lets the watermark regress or exceed lastSequence', () => {
    const purge = resolveDirectChatMessagePurge({
      conversation: { lastSequence: 5, retentionPurgedThroughSequence: 4 },
      cutoffMs: nowMs,
      messages: [message(1, 90), message(2, 90)],
    });
    expect(purge.purgedThroughSequence).toBe(4);
    const capped = resolveDirectChatMessagePurge({
      conversation: { lastSequence: 1, retentionPurgedThroughSequence: 0 },
      cutoffMs: nowMs,
      messages: [message(1, 90), message(2, 90)],
    });
    expect(capped.purgedThroughSequence).toBe(1);
  });

  it('reports the last message as purged so the stale preview can be cleared', () => {
    const purge = resolveDirectChatMessagePurge({
      conversation: { lastMessageId: messageId(2), lastSequence: 2 },
      cutoffMs: nowMs,
      messages: [message(1, 90), message(2, 90)],
    });
    expect(purge.lastMessagePurged).toBe(true);
    expect(purge.purgedThroughSequence).toBe(2);
  });

  it('decrements unread only for purged rows that were still counted above the member floor', () => {
    const purge = resolveDirectChatMessagePurge({
      conversation: { lastSequence: 4 },
      cutoffMs: nowMs,
      memberFloors: { 'user-2': 1 },
      messages: [
        message(1, 90, { unreadForUids: ['user-2'] }),
        message(2, 90, { unreadForUids: ['user-2'] }),
        message(3, 90, { unreadForUids: ['user-2'], visibilityState: 'unsent' }),
        message(4, 90, { unreadForUids: ['user-1', 'user-2'] }),
      ],
    });
    expect(purge.unreadDecrements).toEqual({ 'user-1': 1, 'user-2': 2 });
  });

  it('stops the purge at a row whose held bytes are still awaiting isolation', () => {
    const messages = [
      message(1, 90),
      message(2, 90, { attachmentId: 'dmu_held', mediaPath: 'direct-chat-media/c/dmu_held/image.webp' }),
      message(3, 90),
    ];
    const conversation = { lastSequence: 3 };
    const uploads = new Map([['dmu_held', { evidenceHold: true }]]);
    const blocked = resolveDirectChatMessagePurge({ conversation, cutoffMs: nowMs, messages, uploads });
    expect(blocked.purged.map((entry) => entry.sequence)).toEqual([1]);
    expect(blocked.purgedThroughSequence).toBe(1);

    const copied = new Map([['dmu_held', { evidenceCopiedAt: nowMs, evidenceHold: true }]]);
    const released = resolveDirectChatMessagePurge({ conversation, cutoffMs: nowMs, messages, uploads: copied });
    expect(released.purged.map((entry) => entry.sequence)).toEqual([1, 2, 3]);
    expect(released.purgedThroughSequence).toBe(3);
  });

  it('keeps held media until its evidence copy exists and releases it afterwards', () => {
    const purged = [
      { attachmentId: 'dmu_held', id: messageId(1), mediaPath: 'direct-chat-media/c/dmu_held/image.webp', sequence: 1 },
      { attachmentId: 'dmu_copied', id: messageId(2), mediaPath: 'direct-chat-media/c/dmu_copied/image.webp', sequence: 2 },
      { attachmentId: 'dmu_free', id: messageId(3), mediaPath: 'direct-chat-media/c/dmu_free/image.webp', sequence: 3 },
    ];
    const uploads = new Map([
      ['dmu_held', { evidenceHold: true, mediaPath: 'direct-chat-media/c/dmu_held/image.webp', uid: 'user-1' }],
      ['dmu_copied', { evidenceCopiedAt: nowMs, evidenceHold: true, mediaPath: 'direct-chat-media/c/dmu_copied/image.webp', uid: 'user-1' }],
      ['dmu_free', { evidenceHold: false, mediaPath: 'direct-chat-media/c/dmu_free/image.webp', uid: 'user-1' }],
    ]);
    const media = resolveDirectChatMediaPurge({ purged, uploads });
    expect(media.retained.map((entry) => entry.attachmentId)).toEqual(['dmu_held']);
    expect(media.purgeable.map((entry) => entry.attachmentId)).toEqual(['dmu_copied', 'dmu_free']);
  });

  it('refuses to expire evidence under an active legal hold', () => {
    expect(resolveDirectChatEvidenceExpiry({ evidenceCase: { legalHold: false, retentionUntilMs: nowMs - 1 }, nowMs })).toBe(true);
    expect(resolveDirectChatEvidenceExpiry({ evidenceCase: { legalHold: true, retentionUntilMs: nowMs - 1 }, nowMs })).toBe(false);
    expect(resolveDirectChatEvidenceExpiry({ evidenceCase: { legalHold: false, retentionUntilMs: nowMs + 1 }, nowMs })).toBe(false);
    expect(resolveDirectChatEvidenceExpiry({ evidenceCase: { legalHold: false, status: 'expired', retentionUntilMs: 0 }, nowMs })).toBe(false);
    expect(resolveDirectChatEvidenceExpiry({ evidenceCase: { legalHold: false }, nowMs })).toBe(false);
  });

  it('drops the retention deadline when tombstoning so the case leaves the expiry query', () => {
    const patch = buildDirectChatEvidenceExpiryPatch({ fieldValue: { delete: () => 'DELETED' }, now: nowMs, nowMs });
    expect(patch).toMatchObject({ attachmentIds: [], deletedAtMs: nowMs, retentionUntilMs: 'DELETED', snapshotCount: 0, status: 'expired' });
    expect(resolveDirectChatEvidenceExpiry({ evidenceCase: { ...patch, legalHold: false }, nowMs })).toBe(false);
  });

  it('builds evidence object paths only for known asset names and well-formed identifiers', () => {
    expect(directChatEvidenceObjectPath(reportId, messageId(1), 'direct-chat-media/c/u/image.webp'))
      .toBe(`direct-chat-evidence/${reportId}/${messageId(1)}/image.webp`);
    expect(directChatEvidenceObjectPath(reportId, messageId(1), 'direct-chat-media/c/u/voice.m4a'))
      .toBe(`direct-chat-evidence/${reportId}/${messageId(1)}/voice.m4a`);
    expect(directChatEvidenceObjectPath(reportId, messageId(1), 'direct-chat-media/c/u/source')).toBe('');
    expect(directChatEvidenceObjectPath('../escape', messageId(1), 'image.webp')).toBe('');
    expect(directChatEvidenceObjectPath(reportId, '../../escape', 'image.webp')).toBe('');
    expect(directChatEvidenceObjectPath(reportId, messageId(1), '../../../etc/image.webp'))
      .toBe(`direct-chat-evidence/${reportId}/${messageId(1)}/image.webp`);
  });

  it('queues only snapshots that actually carry media bytes', () => {
    expect(resolveDirectChatEvidenceMediaState({ attachmentId: 'dmu_1', mediaPath: 'direct-chat-media/a/b/image.webp' })).toBe('pending');
    expect(resolveDirectChatEvidenceMediaState({ attachmentId: 'dmu_1', mediaPath: '' })).toBe('none');
    expect(resolveDirectChatEvidenceMediaState({ attachmentId: '', mediaPath: 'direct-chat-media/a/b/image.webp' })).toBe('none');
    expect(mapDirectChatEvidenceMediaState('copied')).toBe('copied');
    expect(mapDirectChatEvidenceMediaState('nonsense')).toBe('none');
  });

  it('records the sweep cursor and wrap state', () => {
    expect(buildDirectChatSweepState({ cursor: 'abc', nowMs, scanned: 3, wrapped: false }))
      .toEqual({ cursor: 'abc', scanned: 3, sweptAtMs: nowMs, wrapped: false });
    expect(buildDirectChatSweepState({ cursor: undefined, nowMs, scanned: -1, wrapped: true }))
      .toEqual({ cursor: '', scanned: 0, sweptAtMs: nowMs, wrapped: true });
  });
});
