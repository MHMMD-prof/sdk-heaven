import { MiniGameModeId } from '../types/miniGame';
import { RootStackParamList } from '../types/navigation';

export type BattleshipRouteParams = RootStackParamList['MiniGame'];

export type BattleshipLaunch = {
  displayName: string;
  hostUid: string;
  initialMode: MiniGameModeId;
  isHost: boolean;
  isOnline: boolean;
  playerId: string;
  roomId: string;
  sessionId: string;
  source: 'games' | 'voice-room';
};

export const resolveBattleshipLaunch = (
  params: BattleshipRouteParams | undefined,
): BattleshipLaunch => {
  const source = params?.source ?? 'games';
  const initialMode = params?.initialMode ?? 'naval';
  const roomId = params?.roomId?.trim() || '';
  const sessionId = params?.sessionId?.trim() || '';
  const hostUid = params?.hostUid?.trim() || '';
  const playerId = params?.playerId?.trim() || '';
  const displayName = params?.displayName?.trim() || 'You';
  const isOnline = params?.mode === 'online' && Boolean(sessionId);

  return {
    displayName,
    hostUid,
    initialMode,
    isHost: Boolean(hostUid) && hostUid === playerId,
    isOnline,
    playerId,
    roomId,
    sessionId,
    source,
  };
};

export const createBattleshipOnlineLobbyViewModel = ({
  launch,
  playerCount,
  maxPlayers,
  sessionStatus,
}: {
  launch: BattleshipLaunch;
  maxPlayers?: number;
  playerCount?: number;
  sessionStatus?: string;
}) => {
  const resolvedMaxPlayers = maxPlayers && maxPlayers > 0 ? maxPlayers : 2;
  const resolvedPlayerCount = Math.max(0, playerCount ?? (launch.isHost ? 1 : 0));
  const waitingForOpponent = resolvedPlayerCount < resolvedMaxPlayers;

  return {
    eyebrow: 'Voice room duel',
    title: launch.isHost ? 'Host lobby' : 'Joined lobby',
    body: waitingForOpponent
      ? launch.isHost
        ? 'Waiting for the second player to join from the voice room invite.'
        : 'You joined from the voice room. Waiting for the shared match lobby to fill.'
      : 'Both players are in the session. Ship placement sync arrives in the next wave.',
    roleLabel: launch.isHost ? 'Host' : 'Guest',
    playerCountLabel: `${resolvedPlayerCount}/${resolvedMaxPlayers} players`,
    sessionStatusLabel: sessionStatus === 'active' ? 'Active' : 'Lobby',
    showHandoffControls: false,
    canUseLocalPersistence: false,
    canStartLocalHotSeat: false,
    leaveLabel: 'Back to voice room',
  };
};
