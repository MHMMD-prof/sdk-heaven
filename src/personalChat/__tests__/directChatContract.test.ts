import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', async () => {
  const { createHash } = await import('node:crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digestStringAsync: async (_algorithm: string, value: string) =>
      createHash('sha256').update(value).digest('hex'),
  };
});

import fixtures from '../../../fixtures/directChatContractFixtures.json';
import {
  DIRECT_CHAT_ACTIONS,
  DIRECT_CHAT_ERRORS,
  createDirectChatReportId,
  createDirectConversationId,
  createDirectMessageId,
  disabledDirectChatFeatureFlags,
  mapDirectChatFeatureFlags,
  normalizeDirectChatCommand,
} from '../directChatContract';

describe('mobile direct-chat contract', () => {
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

  it('matches the backend deterministic IDs', async () => {
    const conversationId = await createDirectConversationId('uid-1', 'uid-2');
    expect(conversationId).toBe('5995bb3b191639c75b60209028e6b56fd95e2c9dddae9594eb20755a43d42154');
    expect(await createDirectConversationId('uid-2', 'uid-1')).toBe(conversationId);
    expect(await createDirectMessageId({
      conversationId,
      requestId: 'request_12345678',
      senderUid: 'uid-1',
    })).toBe('dmm_301590ff702c23d8787c4df1f68e23587c5357a0');
    expect(await createDirectChatReportId({
      conversationId,
      reporterUid: 'uid-1',
      requestId: 'request_12345678',
    })).toBe('dmr_78b1ecce58fd4d381eadbc2c15aa6fbc649d58eb');
  });

  it('fails feature flags closed and exposes safe Arabic messages', () => {
    expect(mapDirectChatFeatureFlags(undefined)).toEqual(disabledDirectChatFeatureFlags);
    expect(mapDirectChatFeatureFlags({ directMessages: true, directMessageMedia: 1 })).toEqual({
      directMessageMedia: false,
      directMessageRequests: false,
      directMessages: true,
    });
    expect(DIRECT_CHAT_ACTIONS).toHaveLength(15);
    for (const error of Object.values(DIRECT_CHAT_ERRORS)) {
      expect(error.messageAr.length).toBeGreaterThan(3);
    }
  });
});
