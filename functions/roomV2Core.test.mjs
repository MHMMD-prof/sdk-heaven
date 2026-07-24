import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  analyzeRoomMemberV2Document,
  analyzeRoomSeatV2Document,
  analyzeRoomV2Document,
  buildVacantRoomSeatV2Document,
} = require('./roomV2Core');

const legacyRoom = {
  title: 'Majlis',
  type: 'voice',
  hostId: 'owner-1',
  hostDisplayName: 'Salem',
  hostAvatarLabel: 'S',
  status: 'active',
  participantCount: 2,
};

describe('roomV2Core', () => {
  it('builds an idempotent dual-write patch for a legacy room', () => {
    const first = analyzeRoomV2Document(legacyRoom, 'room-1');

    expect(first).toMatchObject({
      ok: true,
      status: 'migrate',
      ownerUid: 'owner-1',
      patch: {
        schemaVersion: 2,
        ownerUid: 'owner-1',
        hostId: 'owner-1',
        revision: 1,
        availability: 'active',
        seatTargetCount: 10,
        seatMode: 'open',
      },
    });
    expect(analyzeRoomV2Document({ ...legacyRoom, ...first.patch }, 'room-1')).toMatchObject({
      ok: true,
      status: 'ready',
    });
  });

  it('separates member authority from legacy audio role', () => {
    const speaker = {
      uid: 'member-1',
      displayName: 'Dana',
      avatarLabel: 'D',
      role: 'speaker',
      status: 'active',
      canPublishAudio: true,
    };

    expect(analyzeRoomMemberV2Document(speaker, 'member-1', 'owner-1')).toMatchObject({
      ok: true,
      patch: {
        authorityRole: 'member',
        seatId: null,
      },
    });
  });

  it('reports malformed and unsupported documents instead of guessing', () => {
    expect(analyzeRoomV2Document({ ...legacyRoom, schemaVersion: 3 }, 'room-1')).toEqual({
      ok: false,
      code: 'unsupported-schema',
    });
    expect(analyzeRoomMemberV2Document({ uid: 'member-1' }, 'member-1', 'owner-1')).toEqual({
      ok: false,
      code: 'malformed-member',
    });
  });

  it('builds and validates deterministic vacant seat documents', () => {
    expect(buildVacantRoomSeatV2Document(20)).toEqual({
      schemaVersion: 2,
      seatNumber: 20,
      state: 'open',
      revision: 1,
    });
    expect(analyzeRoomSeatV2Document(buildVacantRoomSeatV2Document(1), 1)).toEqual({
      ok: true,
      status: 'ready',
    });
    expect(analyzeRoomSeatV2Document({
      schemaVersion: 2,
      seatNumber: 1,
      state: 'occupied',
      revision: 2,
    }, 1)).toEqual({ ok: false, code: 'malformed-seat-occupant' });
  });
});
