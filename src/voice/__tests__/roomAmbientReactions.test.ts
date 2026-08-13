import { describe, expect, it } from 'vitest';

import {
  aggregateAmbientReaction,
  decodeRoomReactionEnvelope,
  MAX_AMBIENT_REACTION_COUNT,
  MAX_AMBIENT_REACTION_GROUPS,
  type RoomReactionEnvelope,
} from '../roomAmbientReactions';

const nowMs = 2_000_000_000_000;

function envelope(index = 1): RoomReactionEnvelope {
  return {
    assetId: `reaction-${index}`,
    assetVersionId: 'v1-123456789abc',
    checksum: 'a'.repeat(64),
    count: 1,
    createdAtMs: nowMs,
    eventId: `rr_${String(index).padStart(24, 'a')}`,
    expiresAtMs: nowMs + 4_000,
    format: 'png',
    roomId: 'room-1',
    senderUid: 'user-1',
    type: 'room-reaction',
    version: 1,
  };
}

describe('roomAmbientReactions', () => {
  it('decodes exact, current, room-scoped envelopes', () => {
    const payload = new TextEncoder().encode(JSON.stringify(envelope()));
    expect(decodeRoomReactionEnvelope(payload, 'room-1', nowMs)).toMatchObject({ roomId: 'room-1' });
    expect(decodeRoomReactionEnvelope(payload, 'room-2', nowMs)).toBeUndefined();
    expect(decodeRoomReactionEnvelope(
      new TextEncoder().encode(JSON.stringify({ ...envelope(), arbitraryUrl: 'https://unsafe.test' })),
      'room-1',
      nowMs,
    )).toBeUndefined();
  });

  it('aggregates bursts and caps count and active groups', () => {
    let groups = aggregateAmbientReaction([], envelope(), nowMs);
    for (let index = 0; index < 120; index += 1) {
      groups = aggregateAmbientReaction(groups, envelope(), nowMs + index);
    }
    expect(groups[0].count).toBe(MAX_AMBIENT_REACTION_COUNT);
    for (let index = 2; index <= 8; index += 1) {
      groups = aggregateAmbientReaction(groups, envelope(index), nowMs + 1_000 + index);
    }
    expect(groups).toHaveLength(MAX_AMBIENT_REACTION_GROUPS);
  });
});
