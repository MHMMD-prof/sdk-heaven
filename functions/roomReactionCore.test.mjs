import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  ROOM_REACTION_TOPIC,
  normalizeRoomReactionBody,
  resolveRoomReaction,
  validateRoomReactionRequest,
} = require('./roomReactionCore');

const command = normalizeRoomReactionBody({
  action: 'send-room-reaction',
  assetId: 'room-heart',
  assetVersionId: 'v1-123456789abc',
  requestId: 'reaction_request_00001',
  roomId: 'room-1',
  sessionId: 'presence_session_0001',
});
const checksum = 'a'.repeat(64);
const base = {
  approval: {
    assetId: 'room-heart',
    assetVersionId: 'v1-123456789abc',
    checksum,
    decision: 'approved',
  },
  assetSummary: {
    approvalId: 'room-heart__v1-123456789abc',
    approvedVersionId: 'v1-123456789abc',
    assetId: 'room-heart',
    moderationStatus: 'approved',
    publicationStatus: 'published',
    publishedVersionId: 'v1-123456789abc',
    renderingEnabled: true,
  },
  assetVersion: {
    assetId: 'room-heart',
    assetVersionId: 'v1-123456789abc',
    category: 'room-reaction',
    format: 'lottie-json',
    sha256: checksum,
  },
  command,
  cosmeticsFlags: {
    room_reaction_catalog: [{ assetId: 'room-heart', assetVersionId: 'v1-123456789abc' }],
    room_reactions: true,
  },
  nowMs: 2_000_000_000_000,
  publicProfile: { moderationStatus: 'active', uid: 'user-1' },
  room: { availability: 'active', effectsPolicy: 'full', status: 'active' },
  senderUid: 'user-1',
};

describe('roomReactionCore', () => {
  it('validates exact reaction commands', () => {
    expect(validateRoomReactionRequest(command).ok).toBe(true);
    expect(validateRoomReactionRequest({ ...command, requestId: 'short' }).code).toBe('INVALID_REQUEST');
  });

  it('creates a bounded server-authored envelope for approved catalog assets', () => {
    const result = resolveRoomReaction(base);
    expect(result).toMatchObject({
      ok: true,
      value: {
        topic: ROOM_REACTION_TOPIC,
        envelope: {
          assetId: 'room-heart',
          count: 1,
          roomId: 'room-1',
          senderUid: 'user-1',
          type: 'room-reaction',
          version: 1,
        },
      },
    });
  });

  it('fails closed for flags, room policy, catalog, and approval mismatches', () => {
    expect(resolveRoomReaction({
      ...base,
      cosmeticsFlags: { ...base.cosmeticsFlags, room_reactions: false },
    }).code).toBe('FEATURE_DISABLED');
    expect(resolveRoomReaction({
      ...base,
      room: { ...base.room, effectsPolicy: 'off' },
    }).code).toBe('ROOM_EFFECTS_DISABLED');
    expect(resolveRoomReaction({
      ...base,
      cosmeticsFlags: { room_reaction_catalog: [], room_reactions: true },
    }).code).toBe('REACTION_NOT_AVAILABLE');
    expect(resolveRoomReaction({
      ...base,
      approval: { ...base.approval, checksum: 'b'.repeat(64) },
    }).code).toBe('REACTION_ASSET_UNAVAILABLE');
  });
});
