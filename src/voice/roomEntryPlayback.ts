import type { QueuedRoomEffect } from './roomEffectsQueue';

export type RoomEntryPlaybackDropReason =
  | 'already-present'
  | 'already-seen'
  | 'participant-left';

export function resolveRoomEntryPlaybackDropReason(
  effect: QueuedRoomEffect,
  input: {
    enteredRoomAtMs: number;
    presentUids?: ReadonlySet<string>;
    seenEventIds?: ReadonlySet<string>;
  },
): RoomEntryPlaybackDropReason | undefined {
  if (effect.kind !== 'room-entry') return undefined;
  if (input.seenEventIds?.has(effect.eventId)) return 'already-seen';
  if (effect.occurredAtMs && effect.occurredAtMs < input.enteredRoomAtMs) {
    return 'already-present';
  }
  if (input.presentUids && !areRoomEntryParticipantsPresent(effect, input.presentUids)) {
    return 'participant-left';
  }
  return undefined;
}

export function areRoomEntryParticipantsPresent(
  effect: QueuedRoomEffect,
  presentUids: ReadonlySet<string>,
) {
  if (effect.kind !== 'room-entry') return true;
  if (effect.participantUids) {
    return effect.participantUids.length > 0
      && effect.participantUids.every((uid) => presentUids.has(uid));
  }
  return Boolean(effect.senderUid && presentUids.has(effect.senderUid));
}
