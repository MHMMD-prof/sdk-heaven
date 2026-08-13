import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  DIRECT_CHAT_NEW_RECIPIENT_DAILY_LIMIT,
  DIRECT_CHAT_SEND_RATE_LIMIT,
  DIRECT_CHAT_UNSEND_WINDOW_MS,
  canUnsendDirectMessage,
  createBaghdadDayKey,
  filterDirectChatText,
  isAcceptedConversation,
  resolveDirectChatPairAccess,
  resolveDirectChatRateLimit,
  resolveDirectChatRequestStatus,
} = require('./directChatPolicyCore');

const activeProfile = (uid) => ({ moderationStatus: 'active', uid });

describe('directChatPolicyCore', () => {
  it('fails closed for flags, blocks, suspended accounts, and active restrictions', () => {
    const base = {
      actorProfile: activeProfile('user-1'),
      nowMs: 10_000,
      targetProfile: activeProfile('user-2'),
    };
    expect(resolveDirectChatPairAccess({ ...base, featureFlags: {} })).toMatchObject({ code: 'FEATURE_DISABLED', ok: false });
    expect(resolveDirectChatPairAccess({ ...base, featureFlags: { directMessages: true }, blockedByTarget: true })).toMatchObject({ code: 'BLOCKED' });
    expect(resolveDirectChatPairAccess({ ...base, featureFlags: { directMessages: true }, targetProfile: { ...activeProfile('user-2'), moderationStatus: 'suspended' } })).toMatchObject({ code: 'ACCOUNT_RESTRICTED' });
    expect(resolveDirectChatPairAccess({
      ...base,
      actorRestriction: { actorUid: 'owner-1', reason: 'Safety', startsAt: 1_000, state: 'restricted', uid: 'user-1' },
      featureFlags: { directMessages: true },
    })).toMatchObject({ code: 'ACCOUNT_RESTRICTED' });
    expect(resolveDirectChatPairAccess({ ...base, featureFlags: { directMessages: true }, requireRequests: true })).toMatchObject({ code: 'REQUESTS_DISABLED' });
  });

  it('does not inspect staff roles or allow role-based bypasses', () => {
    const result = resolveDirectChatPairAccess({
      actorProfile: { ...activeProfile('staff-1'), role: 'platform-owner' },
      blockedByTarget: true,
      featureFlags: { directMessageRequests: true, directMessages: true },
      nowMs: 10_000,
      targetProfile: activeProfile('user-2'),
    });
    expect(result).toMatchObject({ code: 'BLOCKED', ok: false });
  });

  it('enforces concurrent-safe send and unique non-friend recipient budgets', () => {
    expect(resolveDirectChatRateLimit({
      isNewNonFriendRecipient: false,
      nowMs: 10_000,
      rate: { sendCount: DIRECT_CHAT_SEND_RATE_LIMIT, sendWindowStartedAt: 9_000 },
      targetUid: 'user-2',
    })).toMatchObject({ code: 'RATE_LIMITED' });
    const recipients = Array.from({ length: DIRECT_CHAT_NEW_RECIPIENT_DAILY_LIMIT }, (_, index) => `user-${index + 2}`);
    expect(resolveDirectChatRateLimit({
      isNewNonFriendRecipient: true,
      nowMs: Date.UTC(2026, 7, 2),
      rate: { newRecipientUids: recipients, requestDayKey: createBaghdadDayKey(Date.UTC(2026, 7, 2)) },
      targetUid: 'user-99',
    })).toMatchObject({ code: 'RATE_LIMITED' });
    expect(resolveDirectChatRateLimit({
      isNewNonFriendRecipient: true,
      nowMs: Date.UTC(2026, 7, 2),
      rate: { newRecipientUids: recipients, requestDayKey: createBaghdadDayKey(Date.UTC(2026, 7, 2)) },
      targetUid: recipients[0],
    })).toMatchObject({ ok: true });
  });

  it('uses the Baghdad day boundary for non-friend budgets', () => {
    expect(createBaghdadDayKey(Date.UTC(2026, 7, 1, 20, 59))).toBe('2026-08-01');
    expect(createBaghdadDayKey(Date.UTC(2026, 7, 1, 21, 0))).toBe('2026-08-02');
  });

  it('keeps feature-disabled closed when only media or requests are on', () => {
    expect(resolveDirectChatPairAccess({
      actorProfile: activeProfile('user-1'),
      featureFlags: { directMessageMedia: true, directMessageRequests: true, directMessages: false },
      nowMs: 10_000,
      targetProfile: activeProfile('user-2'),
    })).toMatchObject({ code: 'FEATURE_DISABLED', ok: false });
  });

  it('adapts the existing keyword policy without leaking the blocked term', () => {
    expect(filterDirectChatText('hello', { keywordTerms: ['blocked'] })).toEqual({ ok: true, value: 'hello' });
    expect(filterDirectChatText('a BLOCKED phrase', { keywordTerms: ['blocked'] })).toMatchObject({
      code: 'CONTENT_FILTERED',
      ok: false,
    });
  });

  it('resolves request expiry and accepted conversation continuity', () => {
    expect(resolveDirectChatRequestStatus({ expiresAt: 9_999, status: 'pending' }, 10_000)).toBe('expired');
    expect(resolveDirectChatRequestStatus({ expiresAt: 10_001, status: 'pending' }, 10_000)).toBe('pending');
    expect(isAcceptedConversation({ lifecycleState: 'active', memberUids: ['user-1', 'user-2'], requestState: 'accepted' })).toBe(true);
  });

  it('enforces sender ownership, visibility, and the five-minute unsend window', () => {
    const message = { createdAt: 10_000, kind: 'text', senderUid: 'user-1', visibilityState: 'visible' };
    expect(canUnsendDirectMessage({ actorUid: 'user-1', message, nowMs: 10_000 + DIRECT_CHAT_UNSEND_WINDOW_MS })).toEqual({ ok: true });
    expect(canUnsendDirectMessage({ actorUid: 'user-1', message, nowMs: 10_001 + DIRECT_CHAT_UNSEND_WINDOW_MS })).toMatchObject({ code: 'UNSEND_WINDOW_EXPIRED' });
    expect(canUnsendDirectMessage({ actorUid: 'user-2', message, nowMs: 10_000 })).toMatchObject({ code: 'MESSAGE_UNAVAILABLE' });
  });

  it('authorizes unsend windows from server nowMillis only (clock-skew resistant)', () => {
    const message = { createdAt: 10_000, kind: 'text', senderUid: 'user-1', visibilityState: 'visible' };
    // Policy never reads a client clock field; injected nowMs is authoritative.
    expect(canUnsendDirectMessage({
      actorUid: 'user-1',
      message: { ...message, clientClaimedNowMs: 10_000 + DIRECT_CHAT_UNSEND_WINDOW_MS },
      nowMs: 10_001 + DIRECT_CHAT_UNSEND_WINDOW_MS,
    })).toMatchObject({ code: 'UNSEND_WINDOW_EXPIRED' });
  });
});
