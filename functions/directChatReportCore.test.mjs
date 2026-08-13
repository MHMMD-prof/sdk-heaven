import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  DIRECT_CHAT_MAX_EVIDENCE_SNAPSHOTS,
  DIRECT_CHAT_REPORT_RATE_LIMIT,
  buildDirectChatEvidenceSnapshot,
  directChatReportSeverity,
  resolveDirectChatEvidenceRange,
  resolveDirectChatEvidenceWindow,
  resolveDirectChatReportAccess,
  resolveDirectChatReportRateLimit,
} = require('./directChatReportCore');

const CONVERSATION_ID = 'a'.repeat(64);
const activeProfile = { moderationStatus: 'active', uid: 'user-1' };
const conversation = { conversationId: CONVERSATION_ID, memberUids: ['user-1', 'user-2'] };

describe('directChatReportCore access', () => {
  it('lets a participant report while blocked, restricted, or facing a suspended peer', () => {
    // Reporting must stay reachable in exactly the states that block ordinary sends.
    expect(resolveDirectChatReportAccess({
      actorProfile: activeProfile, conversation, targetUid: 'user-2', uid: 'user-1',
    })).toEqual({ ok: true });
    expect(resolveDirectChatReportAccess({
      actorProfile: { moderationStatus: 'suspended', uid: 'user-1' }, conversation, targetUid: 'user-2', uid: 'user-1',
    })).toEqual({ ok: true });
  });

  it('denies outsiders, mismatched pairs, and deleted reporters', () => {
    expect(resolveDirectChatReportAccess({
      actorProfile: { moderationStatus: 'active', uid: 'user-3' }, conversation, targetUid: 'user-2', uid: 'user-3',
    })).toMatchObject({ code: 'NOT_FOUND', ok: false });
    expect(resolveDirectChatReportAccess({
      actorProfile: activeProfile, conversation: undefined, targetUid: 'user-2', uid: 'user-1',
    })).toMatchObject({ code: 'NOT_FOUND', ok: false });
    expect(resolveDirectChatReportAccess({
      actorProfile: activeProfile, conversation, targetUid: 'user-9', uid: 'user-1',
    })).toMatchObject({ code: 'NOT_FOUND', ok: false });
    expect(resolveDirectChatReportAccess({
      actorProfile: { moderationStatus: 'removed', uid: 'user-1' }, conversation, targetUid: 'user-2', uid: 'user-1',
    })).toMatchObject({ code: 'ACCOUNT_RESTRICTED', ok: false });
    expect(resolveDirectChatReportAccess({
      actorProfile: undefined, conversation, targetUid: 'user-2', uid: 'user-1',
    })).toMatchObject({ code: 'ACCOUNT_RESTRICTED', ok: false });
  });
});

describe('directChatReportCore rate limits', () => {
  it('caps hourly reports and resets on a new window', () => {
    let rate = {};
    for (let index = 0; index < DIRECT_CHAT_REPORT_RATE_LIMIT; index += 1) {
      const result = resolveDirectChatReportRateLimit({ conversationId: `conversation-${index}`, nowMs: 1_000, rate });
      expect(result).toMatchObject({ ok: true });
      rate = {
        reportCount: result.value.reportCount,
        reportWindowStartedAt: result.value.reportWindowStartedAtMs,
        reportedConversations: result.value.reportedConversations,
      };
    }
    expect(resolveDirectChatReportRateLimit({ conversationId: 'conversation-new', nowMs: 1_000, rate }))
      .toMatchObject({ code: 'RATE_LIMITED', ok: false });
    expect(resolveDirectChatReportRateLimit({ conversationId: 'conversation-new', nowMs: 1_000 + 60 * 60 * 1_000, rate }))
      .toMatchObject({ ok: true, value: { reportCount: 1 } });
  });

  it('applies a per-conversation cooldown that expires', () => {
    const rate = { reportCount: 1, reportWindowStartedAt: 1_000, reportedConversations: [{ atMs: 1_000, conversationId: CONVERSATION_ID }] };
    expect(resolveDirectChatReportRateLimit({ conversationId: CONVERSATION_ID, nowMs: 2_000, rate }))
      .toMatchObject({ code: 'RATE_LIMITED', ok: false });
    expect(resolveDirectChatReportRateLimit({ conversationId: CONVERSATION_ID, nowMs: 1_000 + 61 * 60 * 1_000, rate }))
      .toMatchObject({ ok: true });
  });

  it('bounds the tracked conversation list', () => {
    const rate = {
      reportCount: 0,
      reportWindowStartedAt: 1_000,
      reportedConversations: Array.from({ length: 40 }, (_, index) => ({ atMs: 1_000, conversationId: `conversation-${index}` })),
    };
    const result = resolveDirectChatReportRateLimit({ conversationId: 'fresh-conversation', nowMs: 1_500, rate });
    expect(result.value.reportedConversations).toHaveLength(10);
    expect(result.value.reportedConversations.at(-1)).toEqual({ atMs: 1_500, conversationId: 'fresh-conversation' });
  });
});

describe('directChatReportCore evidence', () => {
  it('rejects a report when no selected message resolves', () => {
    expect(resolveDirectChatEvidenceRange({ messageIds: ['dmm_missing0001'], messages: [] }))
      .toMatchObject({ code: 'EVIDENCE_UNAVAILABLE', ok: false });
    expect(resolveDirectChatEvidenceRange({ messageIds: ['dmm_other000001'], messages: [message(4)] }))
      .toMatchObject({ code: 'EVIDENCE_UNAVAILABLE', ok: false });
  });

  it('bounds the context query around the selected sequences', () => {
    const range = resolveDirectChatEvidenceRange({
      messageIds: [message(20).id, message(24).id],
      messages: [message(20), message(24), message(99)],
    });
    expect(range.value).toMatchObject({
      contextEndSequence: 34,
      contextStartSequence: 10,
      maxSequence: 24,
      minSequence: 20,
    });
    expect(range.value.selectedIds).toEqual([message(20).id, message(24).id].sort());
    const early = resolveDirectChatEvidenceRange({ messageIds: [message(2).id], messages: [message(2)] });
    expect(early.value.contextStartSequence).toBe(0);
  });

  it('keeps every selected message, caps the total, and orders by sequence', () => {
    const selected = Array.from({ length: 10 }, (_, index) => message(100 + index));
    const range = resolveDirectChatEvidenceRange({ messageIds: selected.map((entry) => entry.id), messages: selected });
    const contextMessages = Array.from({ length: 60 }, (_, index) => message(80 + index));
    const captured = resolveDirectChatEvidenceWindow({ contextMessages, range: range.value });
    expect(captured).toHaveLength(DIRECT_CHAT_MAX_EVIDENCE_SNAPSHOTS);
    for (const entry of selected) expect(captured.some((row) => row.id === entry.id)).toBe(true);
    expect(captured.map((row) => row.sequence)).toEqual([...captured.map((row) => row.sequence)].sort((left, right) => left - right));
    // Nearest context wins, so the retained window hugs the selected range.
    expect(Math.min(...captured.map((row) => row.sequence))).toBeGreaterThanOrEqual(90);
    expect(Math.max(...captured.map((row) => row.sequence))).toBeLessThanOrEqual(119);
  });

  it('never duplicates a selected message that also appears in the context page', () => {
    const range = resolveDirectChatEvidenceRange({ messageIds: [message(5).id], messages: [message(5)] });
    const captured = resolveDirectChatEvidenceWindow({ contextMessages: [message(4), message(5), message(6)], range: range.value });
    expect(captured.filter((row) => row.id === message(5).id)).toHaveLength(1);
    expect(captured).toHaveLength(3);
  });

  it('captures an immutable bounded snapshot including unsent state and attachments', () => {
    const snapshot = buildDirectChatEvidenceSnapshot({
      conversationId: CONVERSATION_ID,
      message: {
        ...message(7),
        attachmentId: 'dmu_attachment0001',
        kind: 'image',
        mediaContentType: 'image/webp',
        mediaDurationMs: 12.6,
        mediaPath: `direct-chat-media/${CONVERSATION_ID}/dmu_attachment0001/image.webp`,
        text: 'x'.repeat(2_500),
        visibilityState: 'unsent',
      },
      reportId: 'dmr_report0001',
      selected: true,
    });
    expect(snapshot).toMatchObject({
      attachmentId: 'dmu_attachment0001',
      conversationId: CONVERSATION_ID,
      kind: 'image',
      mediaContentType: 'image/webp',
      mediaDurationMs: 13,
      messageId: message(7).id,
      reportId: 'dmr_report0001',
      selected: true,
      senderUid: 'user-2',
      sequence: 7,
      visibilityState: 'unsent',
    });
    expect(snapshot.text).toHaveLength(2_000);
  });

  it('maps the same severities as the room reporting pipeline', () => {
    expect(directChatReportSeverity('threat')).toBe('high');
    expect(directChatReportSeverity('sexual-content')).toBe('high');
    expect(directChatReportSeverity('underage')).toBe('high');
    expect(directChatReportSeverity('spam')).toBe('medium');
    expect(directChatReportSeverity('other')).toBe('medium');
  });
});

function message(sequence, overrides = {}) {
  return {
    createdAt: 1_000 + sequence,
    id: `dmm_${String(sequence).padStart(12, '0')}`,
    kind: 'text',
    senderUid: 'user-2',
    sequence,
    text: `message ${sequence}`,
    visibilityState: 'visible',
    ...overrides,
  };
}
