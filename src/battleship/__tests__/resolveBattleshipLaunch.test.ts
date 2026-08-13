import { describe, expect, it } from 'vitest';

import {
  createBattleshipOnlineLobbyViewModel,
  resolveBattleshipLaunch,
} from '../resolveBattleshipLaunch';

describe('resolveBattleshipLaunch', () => {
  it('keeps Games launches local without online lobby wiring', () => {
    const launch = resolveBattleshipLaunch({
      initialMode: 'naval',
      source: 'games',
    });

    expect(launch.isOnline).toBe(false);
    expect(launch.isHost).toBe(false);
    expect(launch.source).toBe('games');
  });

  it('marks naval-duel voice launches as online with host identity', () => {
    const hostLaunch = resolveBattleshipLaunch({
      displayName: 'Ali',
      hostUid: 'host-1',
      initialMode: 'naval',
      mode: 'online',
      playerId: 'host-1',
      roomId: 'room-1',
      sessionId: 'rgs_session_naval_0001',
      source: 'voice-room',
    });
    const joinerLaunch = resolveBattleshipLaunch({
      displayName: 'Sara',
      hostUid: 'host-1',
      initialMode: 'naval',
      mode: 'online',
      playerId: 'joiner-2',
      roomId: 'room-1',
      sessionId: 'rgs_session_naval_0001',
      source: 'voice-room',
    });

    expect(hostLaunch.isOnline).toBe(true);
    expect(hostLaunch.isHost).toBe(true);
    expect(joinerLaunch.isOnline).toBe(true);
    expect(joinerLaunch.isHost).toBe(false);
  });

  it('keeps host-local voice room MiniGame launches offline', () => {
    const launch = resolveBattleshipLaunch({
      initialMode: 'naval',
      roomId: 'room-1',
      sessionId: 'rgs_session_majlis_0001',
      source: 'voice-room',
    });

    expect(launch.isOnline).toBe(false);
    expect(launch.source).toBe('voice-room');
  });

  it('requires sessionId before enabling online lobby mode', () => {
    const launch = resolveBattleshipLaunch({
      hostUid: 'host-1',
      mode: 'online',
      playerId: 'host-1',
      roomId: 'room-1',
      source: 'voice-room',
    });

    expect(launch.isOnline).toBe(false);
  });

  it('builds online lobby copy without hot-seat or persistence controls', () => {
    const launch = resolveBattleshipLaunch({
      displayName: 'Ali',
      hostUid: 'host-1',
      mode: 'online',
      playerId: 'host-1',
      roomId: 'room-1',
      sessionId: 'rgs_session_naval_0001',
      source: 'voice-room',
    });
    const waiting = createBattleshipOnlineLobbyViewModel({
      launch,
      playerCount: 1,
      maxPlayers: 2,
      sessionStatus: 'lobby',
    });
    const ready = createBattleshipOnlineLobbyViewModel({
      launch,
      playerCount: 2,
      maxPlayers: 2,
      sessionStatus: 'active',
    });

    expect(waiting.showHandoffControls).toBe(false);
    expect(waiting.canUseLocalPersistence).toBe(false);
    expect(waiting.canStartLocalHotSeat).toBe(false);
    expect(waiting.body).toContain('Waiting for the second player');
    expect(ready.body).toContain('Both players are in the session');
    expect(ready.playerCountLabel).toBe('2/2 players');
  });
});
