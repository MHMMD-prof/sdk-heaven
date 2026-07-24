import { describe, expect, it } from 'vitest';

import {
  createVacantRoomSeatDocument,
  mapRoomMessageDocument,
  mapRoomSeatDocument,
  roomSeatDocumentId,
} from '../roomV2Contract';

describe('roomV2Contract', () => {
  it('uses deterministic seat IDs and validates the 20-seat boundary', () => {
    expect(roomSeatDocumentId(1)).toBe('01');
    expect(roomSeatDocumentId(20)).toBe('20');
    expect(() => roomSeatDocumentId(21)).toThrow(RangeError);
    expect(createVacantRoomSeatDocument(5)).toEqual({
      schemaVersion: 2,
      seatNumber: 5,
      state: 'open',
      revision: 1,
    });
  });

  it('rejects forged seat occupancy and non-deterministic document IDs', () => {
    expect(mapRoomSeatDocument({
      schemaVersion: 2,
      seatNumber: 1,
      state: 'occupied',
      revision: 2,
    }, '01')).toBeNull();
    expect(mapRoomSeatDocument({
      schemaVersion: 2,
      seatNumber: 1,
      state: 'occupied',
      occupantUid: 'uid-1',
      revision: 2,
    }, '02')).toBeNull();
    expect(mapRoomSeatDocument({
      schemaVersion: 2,
      seatNumber: 1,
      state: 'occupied',
      occupantUid: 'uid-1',
      revision: 2,
    }, '01')).toMatchObject({ occupantUid: 'uid-1', state: 'occupied' });
  });

  it('strictly maps versioned room messages', () => {
    const message = {
      schemaVersion: 2,
      roomId: 'room-1',
      senderUid: 'uid-1',
      kind: 'chat',
      text: 'Hello',
      status: 'active',
      revision: 1,
    } as const;

    expect(mapRoomMessageDocument(message, 'message-1')).toMatchObject({
      id: 'message-1',
      kind: 'chat',
      text: 'Hello',
    });
    expect(mapRoomMessageDocument({ ...message, schemaVersion: 3 }, 'message-1')).toBeNull();
    expect(mapRoomMessageDocument({ ...message, text: '' }, 'message-1')).toBeNull();
  });
});
