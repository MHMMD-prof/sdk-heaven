import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { mapDirectChatRestriction } = require('./directChatCore');
const {
  DIRECT_CHAT_LEGAL_HOLD_RETENTION_MS,
  DIRECT_CHAT_MODERATION_MAX_REMOVALS,
  DIRECT_CHAT_RESTRICTION_MAX_HOURS,
  buildDirectChatRemovalPatch,
  buildDirectChatRestrictionClearDocument,
  buildDirectChatRestrictionDocument,
  normalizeDirectChatEvidenceRequest,
  normalizeDirectChatModerationAction,
  resolveDirectChatLegalHold,
  resolveDirectChatRemovalTargets,
} = require('./directChatModerationCore');

const nowMs = Date.UTC(2026, 7, 4, 9);
const requestId = 'direct_chat_view_000001';

describe('directChatModerationCore', () => {
  it('requires a reason before private message content can be requested', () => {
    expect(normalizeDirectChatEvidenceRequest({ reportId: 'dmr_1', requestId })).toMatchObject({ ok: false, status: 400 });
    expect(normalizeDirectChatEvidenceRequest({ reason: ' a ', reportId: 'dmr_1', requestId })).toMatchObject({ ok: false, status: 400 });
    expect(normalizeDirectChatEvidenceRequest({ reason: 'Escalated threat review', requestId })).toMatchObject({ ok: false, status: 400 });
    expect(normalizeDirectChatEvidenceRequest({ reason: 'Escalated threat review', reportId: 'dmr_1', requestId: 'short' })).toMatchObject({ ok: false, status: 400 });
    expect(normalizeDirectChatEvidenceRequest({ reason: '  Escalated threat review  ', reportId: ' dmr_1 ', requestId })).toEqual({
      ok: true,
      value: { reason: 'Escalated threat review', reportId: 'dmr_1', requestId },
    });
  });

  it('requires a note on every enforcement action and validates each action payload', () => {
    const base = { note: 'Confirmed harassment', reportId: 'dmr_1', requestId };
    expect(normalizeDirectChatModerationAction({ ...base, directChatAction: 'ban-user' })).toMatchObject({ ok: false, status: 400 });
    expect(normalizeDirectChatModerationAction({ ...base, directChatAction: 'dismiss', note: 'x' })).toMatchObject({ ok: false, status: 400 });
    expect(normalizeDirectChatModerationAction({ ...base, directChatAction: 'dismiss' })).toMatchObject({
      ok: true,
      value: { action: 'dismiss', messageIds: [], note: 'Confirmed harassment' },
    });

    expect(normalizeDirectChatModerationAction({ ...base, directChatAction: 'remove-direct-message', messageIds: [] })).toMatchObject({ ok: false, status: 400 });
    expect(normalizeDirectChatModerationAction({
      ...base,
      directChatAction: 'remove-direct-message',
      messageIds: Array.from({ length: DIRECT_CHAT_MODERATION_MAX_REMOVALS + 1 }, (_, index) => `dmm_${index}`),
    })).toMatchObject({ ok: false, status: 400 });
    expect(normalizeDirectChatModerationAction({ ...base, directChatAction: 'remove-direct-message', messageIds: ['dmm_1', 'dmm_1', ' dmm_2 '] }))
      .toMatchObject({ ok: true, value: { messageIds: ['dmm_1', 'dmm_2'] } });

    expect(normalizeDirectChatModerationAction({ ...base, directChatAction: 'restrict-direct-chat', durationHours: 0 })).toMatchObject({ ok: false, status: 400 });
    expect(normalizeDirectChatModerationAction({ ...base, directChatAction: 'restrict-direct-chat', durationHours: DIRECT_CHAT_RESTRICTION_MAX_HOURS + 1 })).toMatchObject({ ok: false, status: 400 });
    expect(normalizeDirectChatModerationAction({ ...base, directChatAction: 'restrict-direct-chat', durationHours: 72 }))
      .toMatchObject({ ok: true, value: { durationHours: 72 } });
    expect(normalizeDirectChatModerationAction({ ...base, directChatAction: 'restrict-direct-chat' }).value.durationHours).toBeUndefined();

    expect(normalizeDirectChatModerationAction({ ...base, directChatAction: 'set-direct-chat-legal-hold' })).toMatchObject({ ok: false, status: 400 });
    expect(normalizeDirectChatModerationAction({ ...base, directChatAction: 'set-direct-chat-legal-hold', legalHold: true }))
      .toMatchObject({ ok: true, value: { legalHold: true } });
  });

  it('builds restriction documents that mapDirectChatRestriction accepts as active', () => {
    const document = buildDirectChatRestrictionDocument({
      actorUid: 'platform-owner',
      durationHours: 72,
      nowMs,
      reason: 'Confirmed harassment',
      targetUid: 'user-2',
    });
    expect(mapDirectChatRestriction(document, 'user-2', nowMs + 1)).toMatchObject({
      active: true,
      actorUid: 'platform-owner',
      endsAtMs: nowMs + (72 * 60 * 60 * 1_000),
      startsAtMs: nowMs,
      state: 'restricted',
      uid: 'user-2',
    });
    // Past the window the same document must stop restricting rather than needing a cleanup job.
    expect(mapDirectChatRestriction(document, 'user-2', nowMs + (73 * 60 * 60 * 1_000))).toMatchObject({ active: false });
    expect(mapDirectChatRestriction(document, 'user-3', nowMs + 1)).toBeUndefined();

    const permanent = buildDirectChatRestrictionDocument({ actorUid: 'platform-owner', nowMs, reason: '', targetUid: 'user-2' });
    expect(permanent.endsAt).toBeUndefined();
    expect(mapDirectChatRestriction(permanent, 'user-2', nowMs + (400 * 24 * 60 * 60 * 1_000))).toMatchObject({ active: true });

    const cleared = buildDirectChatRestrictionClearDocument({ actorUid: 'platform-owner', nowMs, reason: 'Appeal accepted', targetUid: 'user-2' });
    expect(mapDirectChatRestriction(cleared, 'user-2', nowMs + 1)).toMatchObject({ active: false, state: 'cleared' });
  });

  it('caps restriction reasons at the length mapDirectChatRestriction still accepts', () => {
    const document = buildDirectChatRestrictionDocument({
      actorUid: 'platform-owner',
      nowMs,
      reason: 'x'.repeat(600),
      targetUid: 'user-2',
    });
    expect(document.reason).toHaveLength(300);
    expect(mapDirectChatRestriction(document, 'user-2', nowMs + 1)).toMatchObject({ active: true });
  });

  it('tombstones removed messages without touching the evidence snapshot', () => {
    expect(buildDirectChatRemovalPatch({ actorUid: 'platform-owner', now: nowMs })).toEqual({
      moderationAuthority: 'staff',
      moderationRemovedAt: nowMs,
      moderationRemovedBy: 'platform-owner',
      text: '',
      unreadForUids: [],
      updatedAt: nowMs,
      visibilityState: 'removed',
    });
  });

  it('raises retention on legal hold and never shortens an existing longer hold', () => {
    expect(resolveDirectChatLegalHold({ evidenceCase: { retentionUntilMs: nowMs + 1_000 }, legalHold: true, nowMs })).toEqual({
      legalHold: true,
      retentionUntilMs: nowMs + DIRECT_CHAT_LEGAL_HOLD_RETENTION_MS,
    });
    const longer = nowMs + DIRECT_CHAT_LEGAL_HOLD_RETENTION_MS + 5_000;
    expect(resolveDirectChatLegalHold({ evidenceCase: { retentionUntilMs: longer }, legalHold: true, nowMs })).toEqual({
      legalHold: true,
      retentionUntilMs: longer,
    });
    const released = resolveDirectChatLegalHold({ evidenceCase: { retentionUntilMs: longer }, legalHold: false, nowMs });
    expect(released.legalHold).toBe(false);
    expect(released.retentionUntilMs).toBeLessThan(longer);
    expect(released.retentionUntilMs).toBeGreaterThan(nowMs);
  });

  it('refuses removals outside the messages the reporter actually reported', () => {
    const evidenceCase = { selectedMessageIds: ['dmm_a', 'dmm_b'] };
    expect(resolveDirectChatRemovalTargets({ evidenceCase, messageIds: ['dmm_a', 'dmm_c'] })).toMatchObject({ ok: false, status: 400 });
    expect(resolveDirectChatRemovalTargets({ evidenceCase: {}, messageIds: ['dmm_a'] })).toMatchObject({ ok: false, status: 400 });
    expect(resolveDirectChatRemovalTargets({ evidenceCase, messageIds: ['dmm_b', 'dmm_a'] })).toEqual({
      ok: true,
      value: { messageIds: ['dmm_a', 'dmm_b'] },
    });
  });
});
