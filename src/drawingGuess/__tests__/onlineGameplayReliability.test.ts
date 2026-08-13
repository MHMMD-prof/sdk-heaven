import { describe, expect, it } from 'vitest';

import {
  createInitialDrawingGuessState,
  drawingGuessReducer,
} from '../model/drawingGuessReducer';
import {
  applyOnlineStateForViewer,
  createAuthorityClaimGrace,
  observePeersForAuthorityClaimGrace,
  redactPrivatePromptForViewer,
  resolveOnlineInboundGameplay,
  shouldAcceptOnlineControlMessage,
  shouldClaimHostAfterAuthorityProbe,
  syncPresencePlayers,
  tickAuthorityClaimGraceOnProbe,
} from '../model/onlineGameplayReliability';
import { getPromptById } from '../model/wordBank';
import {
  createControlMessage,
  createGuessMessage,
  mapInboundMessageToReducerEvent,
} from '../transport/drawingGuessMessages';

const prompt = getPromptById('apple')!;

const createOnlineDrawingState = () => {
  let state = createInitialDrawingGuessState({ roomId: 'room-1', matchId: 'match-1' });
  state = drawingGuessReducer(state, {
    type: 'player-joined',
    player: {
      id: 'host-1',
      displayName: 'Host',
      avatarLabel: 'H',
      role: 'player',
      joinedAt: 1,
    },
  });
  state = drawingGuessReducer(state, {
    type: 'player-joined',
    player: {
      id: 'joiner-1',
      displayName: 'Sara',
      avatarLabel: 'S',
      role: 'player',
      joinedAt: 2,
    },
  });
  state = {
    ...state,
    hostId: 'host-1',
  };
  state = drawingGuessReducer(state, {
    type: 'start-match',
    actorId: 'host-1',
    now: 1000,
    matchId: 'match-1',
  });
  state = drawingGuessReducer(state, {
    type: 'select-prompt',
    actorId: 'host-1',
    prompt,
    now: 2000,
  });
  return state;
};

describe('Drawing Guess online gameplay reliability', () => {
  it('redacts private prompts for guessers but keeps them for host and drawer', () => {
    const state = createOnlineDrawingState();

    expect(redactPrivatePromptForViewer(state, 'joiner-1').privatePrompt).toBeUndefined();
    expect(redactPrivatePromptForViewer(state, 'host-1').privatePrompt?.id).toBe('apple');
    expect(applyOnlineStateForViewer(state, 'joiner-1').privatePrompt).toBeUndefined();
  });

  it('marks missing presence players as left and transfers host', () => {
    const state = createOnlineDrawingState();
    const synced = syncPresencePlayers({
      localDisplayName: 'Sara',
      localPlayerId: 'joiner-1',
      players: [
        {
          id: 'joiner-1',
          displayName: 'Sara',
          joinedAt: 2,
          isConnected: true,
        },
      ],
      state,
    });

    expect(synced.previousHostId).toBe('host-1');
    expect(synced.state.hostId).toBe('joiner-1');
    expect(synced.becameHost).toBe(true);
    expect(synced.state.players.find((player) => player.id === 'host-1')?.isConnected).toBe(false);
  });

  it('rejects non-host start and non-drawer prompt control messages', () => {
    const state = createOnlineDrawingState();

    expect(
      shouldAcceptOnlineControlMessage({
        hostId: state.hostId,
        drawerId: state.drawerId,
        message: {
          ...createControlMessage({
            matchId: 'match-1',
            messageId: 'm1',
            senderId: 'joiner-1',
            clientTime: 3000,
            sequence: 1,
            payload: {
              type: 'start-match-applied',
              matchId: 'match-2',
              now: 3000,
            },
          }),
          receivedAt: 3001,
        },
      }),
    ).toBe(false);

    expect(
      shouldAcceptOnlineControlMessage({
        hostId: state.hostId,
        drawerId: state.drawerId,
        message: {
          ...createControlMessage({
            matchId: 'match-1',
            messageId: 'm2',
            senderId: 'joiner-1',
            clientTime: 3000,
            sequence: 2,
            payload: {
              type: 'prompt-selected',
              prompt,
              now: 3000,
            },
          }),
          receivedAt: 3001,
        },
      }),
    ).toBe(false);
  });

  it('lets only the host score chat guesses and broadcast authoritative results', () => {
    const state = createOnlineDrawingState();
    const guessMessage = {
      ...createGuessMessage({
        matchId: 'match-1',
        messageId: 'guess-1',
        senderId: 'joiner-1',
        clientTime: 3000,
        sequence: 3,
        payload: {
          type: 'guess-submitted',
          guessId: 'g1',
          text: 'apple',
        },
      }),
      receivedAt: 3001,
    };

    expect(
      resolveOnlineInboundGameplay({
        localPlayerId: 'joiner-1',
        message: guessMessage,
        state,
      }),
    ).toEqual({});

    const hostResolved = resolveOnlineInboundGameplay({
      localPlayerId: 'host-1',
      message: guessMessage,
      state,
    });

    expect(hostResolved.event).toMatchObject({
      type: 'submit-guess',
      actorId: 'joiner-1',
      guessId: 'g1',
    });
    expect(hostResolved.hostFollowUp?.guessScored).toMatchObject({
      playerId: 'joiner-1',
      isCorrect: true,
      pointsAwarded: expect.any(Number),
    });
    expect(hostResolved.hostFollowUp?.guessScored.pointsAwarded).toBeGreaterThan(0);
  });

  it('applies host guess-scored results without requiring private prompts', () => {
    const state = applyOnlineStateForViewer(createOnlineDrawingState(), 'joiner-1');
    expect(state.privatePrompt).toBeUndefined();

    const event = mapInboundMessageToReducerEvent({
      ...createControlMessage({
        matchId: 'match-1',
        messageId: 'scored-1',
        senderId: 'host-1',
        clientTime: 3000,
        sequence: 4,
        payload: {
          type: 'guess-scored',
          guessId: 'g1',
          playerId: 'joiner-1',
          text: 'apple',
          now: 3000,
          isCorrect: true,
          pointsAwarded: 80,
        },
      }),
      receivedAt: 3001,
    });

    const nextState = drawingGuessReducer(state, event!);

    expect(nextState.guesses[0]).toMatchObject({
      id: 'g1',
      playerId: 'joiner-1',
      isCorrect: true,
    });
    expect(nextState.scores['joiner-1']).toBe(80);
    expect(nextState.privatePrompt).toBeUndefined();
  });

  it('reveals the prompt from host round-ended even when guessers redacted it', () => {
    let state = applyOnlineStateForViewer(createOnlineDrawingState(), 'joiner-1');
    state = drawingGuessReducer(state, {
      type: 'apply-scored-guess',
      guessId: 'g1',
      playerId: 'joiner-1',
      text: 'apple',
      now: 3000,
      isCorrect: true,
      pointsAwarded: 80,
    });

    state = drawingGuessReducer(state, {
      type: 'end-round',
      actorId: 'host-1',
      now: 4000,
      reason: 'manual',
      revealedPrompt: prompt,
    });

    expect(state.phase).toBe('round-results');
    expect(state.revealedPrompt?.id).toBe('apple');
  });

  it('never force-claims host authority while a peer is still connected', () => {
    expect(
      shouldClaimHostAfterAuthorityProbe({
        consecutivePeerAbsentIntervals: 5,
        hasClaimedHostSnapshot: false,
        hasMatchProgress: false,
        isLocalHost: true,
        peersConnected: true,
      }),
    ).toBe(false);

    expect(
      shouldClaimHostAfterAuthorityProbe({
        consecutivePeerAbsentIntervals: 1,
        hasClaimedHostSnapshot: false,
        hasMatchProgress: false,
        isLocalHost: true,
        peersConnected: false,
      }),
    ).toBe(false);

    expect(
      shouldClaimHostAfterAuthorityProbe({
        consecutivePeerAbsentIntervals: 2,
        hasClaimedHostSnapshot: false,
        hasMatchProgress: false,
        isLocalHost: true,
        peersConnected: false,
      }),
    ).toBe(true);
  });

  it('resets claim grace when a peer reappears between absent intervals', () => {
    let grace = createAuthorityClaimGrace();
    grace = observePeersForAuthorityClaimGrace(grace, true);
    grace = tickAuthorityClaimGraceOnProbe(grace, false);
    expect(grace.consecutivePeerAbsentIntervals).toBe(1);

    grace = observePeersForAuthorityClaimGrace(grace, true);
    expect(grace.consecutivePeerAbsentIntervals).toBe(0);
    expect(
      shouldClaimHostAfterAuthorityProbe({
        consecutivePeerAbsentIntervals: grace.consecutivePeerAbsentIntervals,
        hasClaimedHostSnapshot: false,
        hasMatchProgress: false,
        isLocalHost: true,
        peersConnected: false,
      }),
    ).toBe(false);
  });
});
