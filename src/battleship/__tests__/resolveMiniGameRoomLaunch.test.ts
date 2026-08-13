import { describe, expect, it } from 'vitest';

import {
  isNavalDuelRoomSession,
  resolveMiniGameRoomLaunch,
} from '../resolveMiniGameRoomLaunch';
import { RoomGameSession } from '../../voice/requestRoomGameCommand';

const baseSession = (overrides: Partial<RoomGameSession> = {}): RoomGameSession => ({
  clientRoute: 'MiniGame',
  expiresAtMs: Date.now() + 60_000,
  gameId: 'royal-majlis',
  hostUid: 'host-1',
  maxPlayers: 1,
  minPlayers: 1,
  playerCount: 1,
  playerUids: ['host-1'],
  rewardPolicy: null,
  rewardsEnabled: false,
  roomId: 'room-1',
  sessionId: 'rgs_session_naval_0001',
  sessionMode: 'host-local',
  status: 'lobby',
  ...overrides,
});

describe('resolveMiniGameRoomLaunch', () => {
  it('keeps royal-majlis as a host-local MiniGame launch', () => {
    const launch = resolveMiniGameRoomLaunch({
      localDisplayName: 'Ali',
      localPlayerId: 'host-1',
      roomId: 'room-1',
      session: baseSession(),
    });

    expect(isNavalDuelRoomSession(baseSession())).toBe(false);
    expect(launch).toEqual({
      initialMode: 'naval',
      roomId: 'room-1',
      sessionId: 'rgs_session_naval_0001',
      source: 'voice-room',
    });
  });

  it('opens naval-duel as an online MiniGame launch with host and player identity', () => {
    const session = baseSession({
      gameId: 'naval-duel',
      maxPlayers: 2,
      minPlayers: 2,
      sessionMode: 'multiplayer',
      status: 'active',
      playerCount: 2,
      playerUids: ['host-1', 'joiner-2'],
    });

    expect(isNavalDuelRoomSession(session)).toBe(true);
    expect(
      resolveMiniGameRoomLaunch({
        localDisplayName: 'Sara',
        localPlayerId: 'joiner-2',
        roomId: 'room-1',
        session,
      }),
    ).toEqual({
      displayName: 'Sara',
      hostUid: 'host-1',
      initialMode: 'naval',
      mode: 'online',
      playerId: 'joiner-2',
      roomId: 'room-1',
      sessionId: 'rgs_session_naval_0001',
      source: 'voice-room',
    });
  });

  it('requires membership before opening a naval-duel session', () => {
    expect(
      resolveMiniGameRoomLaunch({
        roomId: 'room-1',
        session: baseSession({
          gameId: 'naval-duel',
          sessionMode: 'multiplayer',
          maxPlayers: 2,
          minPlayers: 2,
        }),
      }),
    ).toEqual({ error: 'MEMBERSHIP_REQUIRED' });
  });
});
