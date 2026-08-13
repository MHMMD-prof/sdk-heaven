import type { RoomSeatViewModel } from './roomMainScreenModel';

export type RoomSeatPresentationKind =
  | 'occupied'
  | 'open'
  | 'locked'
  | 'reconnecting'
  | 'retiring';

export type RoomSeatPresentation = {
  kind: RoomSeatPresentationKind;
  isOccupied: boolean;
  roleLabel?: 'المالك' | 'مشرف';
  secondaryLabel?: 'جارٍ التنفيذ…' | 'مغلق' | 'إعادة الاتصال' | 'سيُغلق';
};

export function resolveRoomSeatPresentation(
  seat: Pick<RoomSeatViewModel, 'isModerator' | 'isOwner' | 'participant' | 'state'>,
  pending = false,
): RoomSeatPresentation {
  const isOccupied = Boolean(seat.participant);
  const kind = isOccupied && seat.state !== 'reconnecting' && seat.state !== 'retiring'
    ? 'occupied'
    : !isOccupied && seat.state === 'occupied'
      ? 'reconnecting'
      : seat.state;

  return {
    isOccupied,
    kind,
    ...(seat.isOwner ? { roleLabel: 'المالك' as const } : seat.isModerator ? { roleLabel: 'مشرف' as const } : {}),
    ...(pending
      ? { secondaryLabel: 'جارٍ التنفيذ…' as const }
      : kind === 'locked'
        ? { secondaryLabel: 'مغلق' as const }
        : kind === 'reconnecting'
          ? { secondaryLabel: 'إعادة الاتصال' as const }
          : kind === 'retiring'
            ? { secondaryLabel: 'سيُغلق' as const }
            : {}),
  };
}

export function orderRoomSeatsForAccessibility<T extends Pick<RoomSeatViewModel, 'id' | 'seatNumber'>>(
  seats: readonly T[],
): T[] {
  return [...seats].sort((left, right) => (
    left.seatNumber - right.seatNumber || left.id.localeCompare(right.id)
  ));
}
