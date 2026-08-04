import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  QUOTE_TTL_MS,
  applyPlatformGiftRevenue,
  createRoomGiftQuoteId,
  createRoomGiftEventId,
  createRoomGiftLedgerId,
  mapCommissionPolicy,
  mapPlatformGiftAccount,
  normalizeRoomGiftBody,
  quoteRoomGift,
  resolveRoomGiftSend,
  validateRoomGiftRequest,
} = require('./roomGiftCore');

const nowMs = 2_000_000_000_000;
const catalogItem = {
  assetVersion: '1',
  giftId: 'rose',
  iconKey: 'rose',
  nameAr: 'وردة',
  price: 100,
  scoreValue: 5,
  status: 'available',
};
const policy = {
  commissionBps: 1000,
  effectiveAtMs: nowMs - 1_000,
  version: 3,
};
const quoteCommand = normalizeRoomGiftBody({
  action: 'quote-room-gift',
  giftId: 'rose',
  quantity: 2,
  requestId: 'roomgift_request_0001',
  roomId: 'room-1',
  targetUid: 'target-1',
});

describe('roomGiftCore', () => {
  it('validates quote and send commands', () => {
    expect(validateRoomGiftRequest(quoteCommand).ok).toBe(true);
    expect(validateRoomGiftRequest(normalizeRoomGiftBody({
      action: 'send-room-gift',
      giftId: 'rose',
      quantity: 2,
      quoteId: createRoomGiftQuoteId('roomgift_request_0001'),
      requestId: 'roomgift_send_00000001',
      roomId: 'room-1',
      targetUid: 'target-1',
    })).ok).toBe(true);
    expect(validateRoomGiftRequest(normalizeRoomGiftBody({
      action: 'send-room-gift',
      giftId: 'rose',
      requestId: 'roomgift_send_00000001',
      roomId: 'room-1',
      targetUid: 'target-1',
    })).code).toBe('INVALID_REQUEST');
  });

  it('quotes commission without mutating historical policy math', () => {
    const quoted = quoteRoomGift({
      catalogItem,
      command: quoteCommand,
      nowMs,
      policy,
      quoteId: 'rgq_test',
    });
    expect(quoted.ok).toBe(true);
    expect(quoted.value).toMatchObject({
      commissionBps: 1000,
      platformShare: 20,
      policyVersion: 3,
      price: 200,
      quantity: 2,
      recipientCredit: 180,
      unitPrice: 100,
    });
    expect(quoted.value.expiresAtMs).toBe(nowMs + QUOTE_TTL_MS);
    expect(mapCommissionPolicy({
      commissionBps: 1000,
      effectiveAt: { toMillis: () => nowMs },
      version: 3,
    })).toEqual({
      commissionBps: 1000,
      effectiveAtMs: nowMs,
      version: 3,
    });
  });

  it('fails closed for self-gift, disabled flag, and quote mismatch', () => {
    const sendCommand = normalizeRoomGiftBody({
      action: 'send-room-gift',
      giftId: 'rose',
      quantity: 2,
      quoteId: 'rgq_test',
      requestId: 'roomgift_send_00000001',
      roomId: 'room-1',
      targetUid: 'target-1',
    });
    const base = {
      actorMembership: { status: 'active', uid: 'sender-1' },
      actorPublicProfile: { displayName: 'Sender', moderationStatus: 'active', uid: 'sender-1' },
      catalogItem,
      command: sendCommand,
      featureFlags: { voice_room_gifts: true },
      nowMs,
      policy,
      quote: {
        ...quoteRoomGift({
          catalogItem,
          command: quoteCommand,
          nowMs,
          policy,
          quoteId: 'rgq_test',
        }).value,
        expiresAt: nowMs + QUOTE_TTL_MS,
        senderUid: 'sender-1',
        status: 'open',
      },
      recipientMembership: { status: 'active', uid: 'target-1' },
      recipientPublicProfile: { displayName: 'Target', moderationStatus: 'active', uid: 'target-1' },
      room: { availability: 'active', status: 'active' },
      senderUid: 'sender-1',
    };

    expect(resolveRoomGiftSend({
      ...base,
      featureFlags: { voice_room_gifts: false },
    }).code).toBe('FEATURE_DISABLED');

    expect(resolveRoomGiftSend({
      ...base,
      command: { ...sendCommand, targetUid: 'sender-1' },
      senderUid: 'sender-1',
    }).code).toBe('SELF_GIFT_FORBIDDEN');

    expect(resolveRoomGiftSend({
      ...base,
      quote: { ...base.quote, price: 999 },
    }).code).toBe('QUOTE_MISMATCH');

    expect(resolveRoomGiftSend({
      ...base,
      blockedByRecipient: true,
    }).code).toBe('BLOCKED_RELATIONSHIP');
  });

  it('honors the immutable quote snapshot when the active policy changes later', () => {
    const command = normalizeRoomGiftBody({
      action: 'send-room-gift',
      giftId: 'rose',
      quantity: 2,
      quoteId: 'rgq_test',
      requestId: 'roomgift_send_00000002',
      roomId: 'room-1',
      targetUid: 'target-1',
    });
    const stored = {
      ...quoteRoomGift({
        catalogItem,
        command: quoteCommand,
        nowMs,
        policy,
        quoteId: 'rgq_test',
      }).value,
      expiresAt: nowMs + QUOTE_TTL_MS,
      senderUid: 'sender-1',
      status: 'open',
    };
    expect(resolveRoomGiftSend({
      actorMembership: { status: 'active', uid: 'sender-1' },
      actorPublicProfile: { displayName: 'Sender', moderationStatus: 'active', uid: 'sender-1' },
      command,
      featureFlags: { voice_room_gifts: true },
      nowMs,
      quote: stored,
      recipientMembership: { status: 'active', uid: 'target-1' },
      recipientPublicProfile: { displayName: 'Target', moderationStatus: 'active', uid: 'target-1' },
      room: { availability: 'active', status: 'active' },
      senderUid: 'sender-1',
    })).toMatchObject({
      ok: true,
      value: { platformShare: 20, policyVersion: 3, recipientCredit: 180 },
    });
  });

  it('creates cross-room-safe IDs and reconciles platform revenue', () => {
    expect(createRoomGiftEventId('same_request_0001', 'room-1'))
      .not.toBe(createRoomGiftEventId('same_request_0001', 'room-2'));
    expect(createRoomGiftLedgerId({
      kind: 'spend',
      requestId: 'same_request_0001',
      roomId: 'room-1',
      uid: 'sender-1',
    })).not.toBe(createRoomGiftLedgerId({
      kind: 'spend',
      requestId: 'same_request_0001',
      roomId: 'room-2',
      uid: 'sender-1',
    }));
    const account = mapPlatformGiftAccount({ balanceCoins: 10, lifetimeRevenueCoins: 25 });
    expect(applyPlatformGiftRevenue(account, 20)).toEqual({
      ok: true,
      value: {
        accountId: 'room-gifts',
        balanceCoins: 30,
        lifetimeRevenueCoins: 45,
      },
    });
  });
});
