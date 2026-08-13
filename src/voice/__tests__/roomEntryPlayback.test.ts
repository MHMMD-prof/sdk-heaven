import { describe, expect, it } from 'vitest';

import {
  areRoomEntryParticipantsPresent,
  resolveRoomEntryPlaybackDropReason,
} from '../roomEntryPlayback';
import type { QueuedRoomEffect } from '../roomEffectsQueue';

describe('room entry playback policy', () => {
  it('accepts a fresh normal entry only while the entrant remains present', () => {
    const effect = entry({ occurredAtMs: 1_100, senderUid: 'user-1' });
    expect(resolveRoomEntryPlaybackDropReason(effect, {
      enteredRoomAtMs: 1_000,
      presentUids: new Set(['user-1']),
    })).toBeUndefined();
    expect(resolveRoomEntryPlaybackDropReason(effect, {
      enteredRoomAtMs: 1_000,
      presentUids: new Set(),
    })).toBe('participant-left');
  });

  it('cancels a couple entrance as soon as either participant leaves', () => {
    const effect = entry({
      coupleEntrance: true,
      participantUids: ['user-1', 'user-2'],
      senderUid: undefined,
    });
    expect(areRoomEntryParticipantsPresent(effect, new Set(['user-1', 'user-2']))).toBe(true);
    expect(areRoomEntryParticipantsPresent(effect, new Set(['user-1']))).toBe(false);
  });

  it('never replays a seen entry after a connection reconnect', () => {
    const effect = entry({ occurredAtMs: 1_100 });
    const seenEventIds = new Set([effect.eventId]);
    expect(resolveRoomEntryPlaybackDropReason(effect, {
      enteredRoomAtMs: 1_000,
      presentUids: new Set(['user-1']),
      seenEventIds,
    })).toBe('already-seen');
  });

  it('does not play unseen entries that happened while the app was backgrounded', () => {
    const effect = entry({ occurredAtMs: 1_500 });
    expect(resolveRoomEntryPlaybackDropReason(effect, {
      enteredRoomAtMs: 2_000,
      presentUids: new Set(['user-1']),
      seenEventIds: new Set(),
    })).toBe('already-present');
    expect(resolveRoomEntryPlaybackDropReason(entry({ occurredAtMs: 2_001 }), {
      enteredRoomAtMs: 2_000,
      presentUids: new Set(['user-1']),
      seenEventIds: new Set(),
    })).toBeUndefined();
  });
});

function entry(overrides: Partial<QueuedRoomEffect>): QueuedRoomEffect {
  return {
    durationMs: 4_000,
    eventId: 'entry-session-1',
    expiresAtMs: 10_000,
    kind: 'room-entry',
    label: 'Ali entered',
    priority: 2,
    senderUid: 'user-1',
    ...overrides,
  };
}
