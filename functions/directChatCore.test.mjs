import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const fixtures = JSON.parse(fs.readFileSync(new URL('../fixtures/directChatContractFixtures.json', import.meta.url), 'utf8'));
const {
  DIRECT_CHAT_ACTIONS,
  DIRECT_CHAT_ERRORS,
  buildDirectChatFingerprint,
  createDirectChatReportId,
  createDirectConversationId,
  createDirectMessageId,
  createDisabledDirectChatFlags,
  mapDirectChatFlags,
  mapDirectChatRestriction,
  normalizeDirectChatCommand,
  normalizeDirectChatText,
} = require('./directChatCore');

describe('directChatCore shared contract', () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      const result = normalizeDirectChatCommand(fixture.input, fixture.requestingUid);
      if (fixture.expected.ok) {
        expect(result).toEqual(fixture.expected);
      } else {
        expect(result).toMatchObject(fixture.expected);
      }
    });
  }

  it('creates stable unordered pair, message, and report identifiers', () => {
    const conversationId = createDirectConversationId('uid-1', 'uid-2');
    expect(conversationId).toBe('5995bb3b191639c75b60209028e6b56fd95e2c9dddae9594eb20755a43d42154');
    expect(createDirectConversationId('uid-2', 'uid-1')).toBe(conversationId);
    expect(createDirectConversationId('uid-1', 'uid-1')).toBe('');
    expect(createDirectMessageId({
      conversationId,
      requestId: 'request_12345678',
      senderUid: 'uid-1',
    })).toBe('dmm_301590ff702c23d8787c4df1f68e23587c5357a0');
    expect(createDirectChatReportId({
      conversationId,
      reporterUid: 'uid-1',
      requestId: 'request_12345678',
    })).toBe('dmr_78b1ecce58fd4d381eadbc2c15aa6fbc649d58eb');
  });

  it('fails all feature flags closed and ignores truthy non-booleans', () => {
    expect(createDisabledDirectChatFlags()).toEqual({
      directMessageMedia: false,
      directMessageRequests: false,
      directMessages: false,
    });
    expect(mapDirectChatFlags({ directMessageMedia: 1, directMessages: true })).toEqual({
      directMessageMedia: false,
      directMessageRequests: false,
      directMessages: true,
    });
  });

  it('maps only valid active restrictions and respects expiry', () => {
    const restriction = {
      actorUid: 'admin-1',
      endsAt: 2_000,
      reason: 'Safety review',
      startsAt: 1_000,
      state: 'restricted',
      uid: 'uid-1',
    };
    expect(mapDirectChatRestriction(restriction, 'uid-1', 1_500)).toMatchObject({ active: true });
    expect(mapDirectChatRestriction(restriction, 'uid-1', 2_000)).toMatchObject({ active: false });
    expect(mapDirectChatRestriction({ ...restriction, uid: 'uid-2' }, 'uid-1', 1_500)).toBeUndefined();
  });

  it('normalizes safely, rejects overlong text, and fingerprints normalized commands', () => {
    expect(normalizeDirectChatText(' A\u0000\u202e   B ')).toBe('A B');
    const valid = normalizeDirectChatCommand({
      action: 'send-message-request',
      payload: { targetUid: 'uid-2', text: 'hello' },
      requestId: 'request_12345678',
      version: 1,
    }, 'uid-1');
    const changed = normalizeDirectChatCommand({
      action: 'send-message-request',
      payload: { targetUid: 'uid-2', text: 'changed' },
      requestId: 'request_12345678',
      version: 1,
    }, 'uid-1');
    expect(buildDirectChatFingerprint(valid)).toMatch(/^[a-f0-9]{64}$/);
    expect(buildDirectChatFingerprint(changed)).not.toBe(buildDirectChatFingerprint(valid));
    expect(normalizeDirectChatCommand({
      action: 'send-message-request',
      payload: { targetUid: 'uid-2', text: 'x'.repeat(2_001) },
      requestId: 'request_12345678',
      version: 1,
    }, 'uid-1')).toMatchObject({ code: 'MESSAGE_TOO_LONG', ok: false });
  });

  it('provides a bounded Arabic-safe error for every command failure', () => {
    expect(DIRECT_CHAT_ACTIONS).toHaveLength(15);
    expect(Object.keys(DIRECT_CHAT_ERRORS).length).toBeGreaterThanOrEqual(20);
    for (const error of Object.values(DIRECT_CHAT_ERRORS)) {
      expect(error.status).toBeGreaterThanOrEqual(400);
      expect(error.status).toBeLessThan(600);
      expect(error.error.length).toBeGreaterThan(3);
      expect(error.messageAr.length).toBeGreaterThan(3);
    }
  });
});
