import { DRAWING_GUESS_TOPICS } from './constants';
import { drawingGuessReducer, shouldAutoEndRound } from './drawingGuessReducer';
import { hasOnlineMatchProgress } from './onlineMatchProgress';
import {
  DrawingGuessEvent,
  DrawingGuessPresenceSyncResult,
  DrawingGuessPrompt,
  DrawingGuessState,
} from './types';
import {
  DrawingGuessControlPayload,
  mapInboundMessageToReducerEvent,
} from '../transport/drawingGuessMessages';
import { DrawingGuessInboundMessage } from '../transport/types';

export { hasOnlineMatchProgress } from './onlineMatchProgress';

export const isPromptPrivilegedViewer = (
  state: DrawingGuessState,
  localPlayerId: string,
) => localPlayerId === state.hostId || localPlayerId === state.drawerId;

export const redactPrivatePromptForViewer = (
  state: DrawingGuessState,
  localPlayerId: string,
): DrawingGuessState => {
  if (isPromptPrivilegedViewer(state, localPlayerId) || !state.privatePrompt) {
    return state;
  }

  return {
    ...state,
    privatePrompt: undefined,
  };
};

export const applyOnlineStateForViewer = (
  state: DrawingGuessState,
  localPlayerId: string,
): DrawingGuessState => redactPrivatePromptForViewer(state, localPlayerId);

/**
 * After an authority probe timeout, claim only when still local host with no progress
 * and no connected peer for enough consecutive absent intervals (presence-flap grace).
 */
export const PEER_ABSENT_INTERVALS_BEFORE_CLAIM = 2;

export type AuthorityClaimGrace = {
  consecutivePeerAbsentIntervals: number;
  sawPeerWhileUnclaimed: boolean;
};

export const createAuthorityClaimGrace = (): AuthorityClaimGrace => ({
  consecutivePeerAbsentIntervals: 0,
  sawPeerWhileUnclaimed: false,
});

/** Presence/probe observer: a connected peer resets the absent streak. */
export const observePeersForAuthorityClaimGrace = (
  grace: AuthorityClaimGrace,
  peersConnected: boolean,
): AuthorityClaimGrace => {
  if (!peersConnected) {
    return grace;
  }
  return {
    consecutivePeerAbsentIntervals: 0,
    sawPeerWhileUnclaimed: true,
  };
};

/** Probe-timeout tick while alone: advance the consecutive-absent counter. */
export const tickAuthorityClaimGraceOnProbe = (
  grace: AuthorityClaimGrace,
  peersConnected: boolean,
): AuthorityClaimGrace => {
  const observed = observePeersForAuthorityClaimGrace(grace, peersConnected);
  if (peersConnected) {
    return observed;
  }
  return {
    ...observed,
    consecutivePeerAbsentIntervals: observed.consecutivePeerAbsentIntervals + 1,
  };
};

/**
 * After we have already seen a peer, one empty presence tick must not instant-claim.
 * Schedule probe grace instead.
 */
export const shouldDeferInstantHostClaimOnPresenceFlap = ({
  hasClaimedHostSnapshot,
  hasMatchProgress,
  peersConnected,
  sawPeerWhileUnclaimed,
}: {
  hasClaimedHostSnapshot: boolean;
  hasMatchProgress: boolean;
  peersConnected: boolean;
  sawPeerWhileUnclaimed: boolean;
}) =>
  !peersConnected
  && sawPeerWhileUnclaimed
  && !hasClaimedHostSnapshot
  && !hasMatchProgress;

export const shouldClaimHostAfterAuthorityProbe = ({
  hasClaimedHostSnapshot,
  hasMatchProgress,
  isLocalHost,
  peersConnected,
  consecutivePeerAbsentIntervals = 0,
  requiredAbsentIntervals = PEER_ABSENT_INTERVALS_BEFORE_CLAIM,
}: {
  consecutivePeerAbsentIntervals?: number;
  hasClaimedHostSnapshot: boolean;
  hasMatchProgress: boolean;
  isLocalHost: boolean;
  peersConnected: boolean;
  requiredAbsentIntervals?: number;
}) =>
  isLocalHost
  && !hasClaimedHostSnapshot
  && !hasMatchProgress
  && !peersConnected
  && consecutivePeerAbsentIntervals >= requiredAbsentIntervals;

/** Empty remounter may yield to a peer host; progressed matches must not. */
export const canAcceptForeignAuthority = ({
  localPlayerId,
  senderId,
  state,
}: {
  localPlayerId: string;
  senderId: string;
  state: DrawingGuessState;
}) => !hasOnlineMatchProgress(state) && senderId !== localPlayerId;

/**
 * Progressed local hosts ignore peer snapshots so a stale joiner bootstrap cannot
 * overwrite the authoritative match. Empty remounters must be allowed to adopt.
 */
export const shouldIgnorePeerSnapshotAsHost = ({
  hasClaimedHostSnapshot,
  localPlayerId,
  senderId,
  state,
}: {
  hasClaimedHostSnapshot: boolean;
  localPlayerId: string;
  senderId: string;
  state: DrawingGuessState;
}) =>
  state.hostId === localPlayerId
  && senderId !== localPlayerId
  && (hasOnlineMatchProgress(state) || hasClaimedHostSnapshot);

/** S1: reject adopting a foreign live match once local already has progress. */
export const shouldAdoptPeerSnapshot = ({
  localPlayerId,
  previous,
  snapshotState,
}: {
  localPlayerId: string;
  previous: DrawingGuessState;
  snapshotState: DrawingGuessState;
}) => {
  if (!canAcceptForeignAuthority({
    localPlayerId,
    senderId: snapshotState.hostId ?? '',
    state: previous,
  })) {
    return false;
  }
  if (
    hasOnlineMatchProgress(previous)
    && snapshotState.matchId !== previous.matchId
  ) {
    return false;
  }
  return Boolean(snapshotState.hostId);
};

export const syncPresencePlayers = ({
  localDisplayName,
  localPlayerId,
  players,
  state,
}: {
  localDisplayName: string;
  localPlayerId: string;
  players: Array<{
    id: string;
    displayName: string;
    joinedAt?: number;
    isConnected?: boolean;
  }>;
  state: DrawingGuessState;
}): DrawingGuessPresenceSyncResult => {
  const previousHostId = state.hostId;
  let nextState = state;
  const presentIds = new Set(players.map((player) => player.id));

  players.forEach((player, index) => {
    nextState = drawingGuessReducer(nextState, {
      type: 'player-joined',
      player: {
        id: player.id,
        displayName: player.displayName || player.id,
        avatarLabel: (player.displayName || player.id).trim().charAt(0).toUpperCase() || '?',
        role: 'player',
        joinedAt: player.joinedAt || Date.now() + index,
        isConnected: player.isConnected ?? true,
      },
    });
  });

  nextState.players.forEach((player) => {
    if (player.isConnected && !presentIds.has(player.id)) {
      nextState = drawingGuessReducer(nextState, {
        type: 'player-left',
        playerId: player.id,
      });
    }
  });

  nextState = drawingGuessReducer(nextState, {
    type: 'player-joined',
    player: {
      id: localPlayerId,
      displayName: localDisplayName,
      avatarLabel: localDisplayName.trim().charAt(0).toUpperCase() || 'Y',
      role: 'player',
      joinedAt: Date.now(),
      isConnected: true,
    },
  });

  return {
    previousHostId,
    state: nextState,
    becameHost: previousHostId !== nextState.hostId && nextState.hostId === localPlayerId,
  };
};

export const shouldAcceptOnlineControlMessage = ({
  hostId,
  drawerId,
  message,
}: {
  hostId?: string;
  drawerId?: string;
  message: DrawingGuessInboundMessage;
}) => {
  if (message.topic !== DRAWING_GUESS_TOPICS.control) {
    return true;
  }

  const payload = message.payload as Partial<DrawingGuessControlPayload>;

  if (
    payload.type === 'start-match-applied' ||
    payload.type === 'guess-scored' ||
    payload.type === 'round-ended' ||
    payload.type === 'round-advanced' ||
    payload.type === 'match-finished'
  ) {
    return Boolean(hostId) && message.senderId === hostId;
  }

  if (payload.type === 'prompt-selected' || payload.type === 'canvas-cleared' || payload.type === 'stroke-undone') {
    return Boolean(drawerId) && message.senderId === drawerId;
  }

  return true;
};

export type OnlineHostGuessFollowUp = {
  guessScored: {
    guessId: string;
    playerId: string;
    text: string;
    now: number;
    isCorrect: boolean;
    pointsAwarded: number;
  };
  roundEnded?: {
    now: number;
    reason: 'timer' | 'all-guessed' | 'manual';
    revealedPrompt?: DrawingGuessPrompt;
  };
};

export const resolveOnlineInboundGameplay = ({
  localPlayerId,
  message,
  state,
}: {
  localPlayerId: string;
  message: DrawingGuessInboundMessage;
  state: DrawingGuessState;
}): {
  event?: DrawingGuessEvent;
  hostFollowUp?: OnlineHostGuessFollowUp;
} => {
  if (message.topic === DRAWING_GUESS_TOPICS.chat) {
    const payload = message.payload as { type?: string; guessId?: string; text?: string };

    if (payload.type !== 'guess-submitted' || !payload.guessId || typeof payload.text !== 'string') {
      return {};
    }

    if (state.hostId !== localPlayerId) {
      return {};
    }

    const event: DrawingGuessEvent = {
      type: 'submit-guess',
      actorId: message.senderId,
      guessId: payload.guessId,
      text: payload.text,
      now: message.clientTime,
    };
    const nextState = drawingGuessReducer(state, event);

    if (nextState === state) {
      return {};
    }

    const scoredGuess = nextState.guesses.find((guess) => guess.id === payload.guessId);
    const pointsAwarded = scoredGuess?.isCorrect
      ? Math.max(
          0,
          (nextState.scores[message.senderId] ?? 0) - (state.scores[message.senderId] ?? 0),
        )
      : 0;
    const autoEnd = shouldAutoEndRound(nextState, message.clientTime);
    const roundAlreadyEnded = state.phase === 'drawing' && nextState.phase === 'round-results';

    return {
      event,
      hostFollowUp: {
        guessScored: {
          guessId: payload.guessId,
          playerId: message.senderId,
          text: payload.text,
          now: message.clientTime,
          isCorrect: scoredGuess?.isCorrect === true,
          pointsAwarded,
        },
        ...(roundAlreadyEnded || autoEnd.shouldEnd
          ? {
              roundEnded: {
                now: message.clientTime,
                reason: roundAlreadyEnded
                  ? nextState.roundEndReason ?? 'all-guessed'
                  : autoEnd.reason ?? 'all-guessed',
                revealedPrompt: nextState.revealedPrompt ?? nextState.privatePrompt ?? state.privatePrompt,
              },
            }
          : {}),
      },
    };
  }

  if (
    !shouldAcceptOnlineControlMessage({
      hostId: state.hostId,
      drawerId: state.drawerId,
      message,
    })
  ) {
    return {};
  }

  if (message.topic === DRAWING_GUESS_TOPICS.control) {
    const payload = message.payload as Partial<DrawingGuessControlPayload>;

    if (payload.type === 'guess-scored') {
      if (state.hostId === localPlayerId) {
        return {};
      }

      const event = mapInboundMessageToReducerEvent(message);
      return event ? { event } : {};
    }
  }

  const event = mapInboundMessageToReducerEvent(message);
  return event ? { event } : {};
};
