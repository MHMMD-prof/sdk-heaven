import { describe, expect, it } from 'vitest';

import type { RoomSeatViewModel } from '../roomMainScreenModel';
import {
  orderRoomSeatsForAccessibility,
  resolveRoomSeatPresentation,
} from '../roomSeatPresentationModel';

const seat = (overrides: Partial<RoomSeatViewModel> = {}): RoomSeatViewModel => ({
  accessibilityLabel: 'المقعد 1',
  action: 'claim',
  id: 'seat-1',
  isLocal: false,
  isModerator: false,
  isOwner: false,
  isSpeaking: false,
  seatNumber: 1,
  state: 'open',
  ...overrides,
});

describe('roomSeatPresentationModel', () => {
  it('keeps every lifecycle state visually distinguishable', () => {
    expect(resolveRoomSeatPresentation(seat()).kind).toBe('open');
    expect(resolveRoomSeatPresentation(seat({ state: 'locked' })).secondaryLabel).toBe('مغلق');
    expect(resolveRoomSeatPresentation(seat({ state: 'reconnecting' })).secondaryLabel).toBe('إعادة الاتصال');
    expect(resolveRoomSeatPresentation(seat({ state: 'retiring' })).secondaryLabel).toBe('سيُغلق');
  });

  it('keeps role copy separate from participant identity', () => {
    const participant = {
      avatarLabel: 'م',
      displayName: 'محمد',
      id: 'user-1',
      isMuted: false,
      isSpeaking: false,
      role: 'speaker' as const,
    };
    expect(resolveRoomSeatPresentation(seat({ isOwner: true, participant, state: 'occupied' })))
      .toMatchObject({ isOccupied: true, kind: 'occupied', roleLabel: 'المالك' });
    expect(resolveRoomSeatPresentation(seat({ isModerator: true, participant, state: 'occupied' })))
      .toMatchObject({ roleLabel: 'مشرف' });
  });

  it('shows pending work without changing the seat identity', () => {
    expect(resolveRoomSeatPresentation(seat(), true))
      .toMatchObject({ kind: 'open', secondaryLabel: 'جارٍ التنفيذ…' });
  });

  it('treats an occupied document without a projected participant as reconnecting', () => {
    expect(resolveRoomSeatPresentation(seat({ state: 'occupied' })))
      .toMatchObject({ isOccupied: false, kind: 'reconnecting', secondaryLabel: 'إعادة الاتصال' });
  });

  it('keeps accessibility traversal in numeric seat order regardless of visual z-order', () => {
    expect(orderRoomSeatsForAccessibility([
      { id: 'seat-10', seatNumber: 10 },
      { id: 'seat-2', seatNumber: 2 },
      { id: 'seat-1', seatNumber: 1 },
    ]).map((item) => item.id)).toEqual(['seat-1', 'seat-2', 'seat-10']);
  });
});
