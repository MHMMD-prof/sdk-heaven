import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildRoomChatFingerprint,
  filterChatText,
  normalizeChatText,
  normalizeRoomChatBody,
  resolveChatRateLimit,
  resolveRoomChatAuthority,
  resolveSendMessage,
  validateRoomChatRequest,
} = require('./roomChatCore');

const validSend = {
  action: 'send-message',
  requestId: 'chat_request_123',
  roomId: 'room-1',
  text: 'مرحبا',
};

test('normalizes Unicode, whitespace, newlines, and control characters', () => {
  assert.equal(
    normalizeChatText('  Ｈi\u0000   there\r\n\r\n\r\nfriend  '),
    'Hi there\n\nfriend',
  );
});

test('accepts a bounded send-message command and rejects invalid requests', () => {
  assert.equal(validateRoomChatRequest(normalizeRoomChatBody(validSend)).ok, true);
  assert.equal(validateRoomChatRequest(normalizeRoomChatBody({ ...validSend, text: '' })).code, 'MESSAGE_EMPTY');
  assert.equal(
    validateRoomChatRequest(normalizeRoomChatBody({ ...validSend, requestId: 'short' })).code,
    'INVALID_REQUEST',
  );
  assert.equal(
    validateRoomChatRequest(normalizeRoomChatBody({
      ...validSend,
      action: 'report-content',
      subjectType: 'message',
      category: 'spam',
      messageId: '',
    })).code,
    'MESSAGE_REQUIRED',
  );
});

test('resolves room authority with staff region scope above room roles', () => {
  assert.deepEqual(
    resolveRoomChatAuthority({
      decodedToken: { admin: true, adminRole: 'super-moderator' },
      featureFlags: { voice_room_super_moderation: true },
      membership: { authorityRole: 'member', status: 'active', uid: 'actor' },
      operatorProfile: { role: 'super-moderator', status: 'active', regionCodes: ['IQ'] },
      room: { countryCode: 'IQ' },
    }),
    { authority: 'super-moderator', canManage: true },
  );
  assert.deepEqual(
    resolveRoomChatAuthority({
      decodedToken: { admin: true, adminRole: 'super-moderator' },
      featureFlags: { voice_room_super_moderation: false },
      membership: { authorityRole: 'member', status: 'active', uid: 'actor' },
      operatorProfile: { role: 'super-moderator', status: 'active', regionCodes: ['IQ'] },
      room: { countryCode: 'IQ' },
    }),
    { authority: 'member', canManage: false },
  );
  assert.deepEqual(
    resolveRoomChatAuthority({
      membership: { authorityRole: 'moderator', status: 'active', uid: 'actor' },
      room: { countryCode: 'SA' },
    }),
    { authority: 'moderator', canManage: true },
  );
});

test('enforces burst and owner slow mode limits', () => {
  assert.equal(resolveChatRateLimit({
    nowMs: 10_000,
    rate: { lastSentAt: 9_000 },
    slowModeSeconds: 5,
  }).code, 'SLOW_MODE_ACTIVE');

  assert.equal(resolveChatRateLimit({
    nowMs: 10_000,
    rate: { messageCount: 5, windowStartedAt: 5_000 },
    slowModeSeconds: 0,
  }).code, 'RATE_LIMITED');

  assert.deepEqual(resolveChatRateLimit({
    nowMs: 20_000,
    rate: { messageCount: 5, windowStartedAt: 5_000 },
    slowModeSeconds: 0,
  }), {
    ok: true,
    value: { lastSentAtMs: 20_000, messageCount: 1, windowStartedAtMs: 20_000 },
  });
});

test('fails closed and enforces followers-only room chat', () => {
  const input = {
    authority: 'member',
    featureFlags: { voice_room_chat: true },
    isFollowerOfOwner: false,
    membership: { status: 'active', uid: 'actor' },
    nowMs: 1_000,
    profile: { uid: 'actor' },
    publicProfile: { avatarLabel: 'A', displayName: 'Actor', moderationStatus: 'active' },
    rate: undefined,
    room: { chatMode: 'followers', status: 'active' },
    text: 'hello',
  };
  assert.equal(resolveSendMessage(input).code, 'CHAT_FOLLOWERS_ONLY');
  assert.equal(resolveSendMessage({
    ...input,
    featureFlags: {},
    isFollowerOfOwner: true,
  }).code, 'FEATURE_DISABLED');
  assert.equal(resolveSendMessage({ ...input, isFollowerOfOwner: true }).ok, true);
});

test('applies configured server keyword terms', () => {
  assert.deepEqual(filterChatText('hello world', 'standard', ['blocked']), {
    ok: true,
    value: 'hello world',
  });
  assert.equal(filterChatText('this BLOCKED phrase', 'strict', ['blocked']).code, 'CONTENT_FILTERED');
});

test('fingerprint covers content and target fields', () => {
  const first = buildRoomChatFingerprint('actor', normalizeRoomChatBody(validSend));
  const second = buildRoomChatFingerprint('actor', normalizeRoomChatBody({ ...validSend, text: 'different' }));
  assert.notEqual(first, second);
});
