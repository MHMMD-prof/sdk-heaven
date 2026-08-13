import { MiniGameModeId } from '../types/miniGame';
import { RoomGameSession } from '../voice/requestRoomGameCommand';

export type MiniGameRoomLaunchParams = {
  displayName?: string;
  hostUid?: string;
  initialMode: MiniGameModeId;
  mode?: 'online' | 'local';
  playerId?: string;
  roomId: string;
  sessionId: string;
  source: 'voice-room';
};

export const isNavalDuelRoomSession = (session: Pick<RoomGameSession, 'gameId' | 'sessionMode'>) =>
  session.gameId === 'naval-duel';

export const resolveMiniGameRoomLaunch = ({
  localDisplayName,
  localPlayerId,
  roomId,
  session,
}: {
  localDisplayName?: string;
  localPlayerId?: string;
  roomId: string;
  session: RoomGameSession;
}): MiniGameRoomLaunchParams | { error: 'MEMBERSHIP_REQUIRED' } => {
  if (isNavalDuelRoomSession(session)) {
    if (!localPlayerId) {
      return { error: 'MEMBERSHIP_REQUIRED' };
    }

    return {
      displayName: localDisplayName,
      hostUid: session.hostUid,
      initialMode: 'naval',
      mode: 'online',
      playerId: localPlayerId,
      roomId,
      sessionId: session.sessionId,
      source: 'voice-room',
    };
  }

  return {
    initialMode: 'naval',
    roomId,
    sessionId: session.sessionId,
    source: 'voice-room',
  };
};
