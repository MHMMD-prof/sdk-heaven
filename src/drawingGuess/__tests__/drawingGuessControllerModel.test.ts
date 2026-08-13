import { describe, expect, it } from 'vitest';

import { advanceToNextRound, drawingGuessReducer } from '../model/drawingGuessReducer';
import { getPromptById } from '../model/wordBank';
import {
  createDrawingGuessViewModel,
  createLocalSimulatedDrawingGuessState,
  createOnlineDrawingGuessState,
  resolveOnlineBootstrapMatchId,
} from '../controller/drawingGuessControllerModel';
import { resolveDrawingGuessLaunch } from '../controller/resolveDrawingGuessLaunch';
import { getLocalShowcaseWrongGuess } from '../controller/useDrawingGuessController';
import { getPromptAnswers, normalizeGuess } from '../model/guessNormalization';
import { triggerDrawingGuessHaptic } from '../screens/drawingGuessHaptics';
import {
  drawingGuessShowcaseHelpBody,
  drawingGuessShowcaseHelpSteps,
  drawingGuessShowcaseHelpTitle,
} from '../screens/drawingGuessShowcaseHelp';

const localPlayerId = 'dg-player-local';
const sessionHostUid = 'voice-host-uid';

const createState = () =>
  createLocalSimulatedDrawingGuessState({
    roomCode: 'DG-TEST',
    localPlayerId,
    matchId: 'match-1',
    now: 1000,
  });

describe('Drawing Guess controller model', () => {
  it('resolves VoiceRoom launch params to online mode with the voice room id', () => {
    const launch = resolveDrawingGuessLaunch({
      roomId: 'voice-room-1',
      source: 'voice-room',
    });

    expect(launch.roomCode).toBe('voice-room-1');
    expect(launch.mode).toBe('online');
    expect(launch.source).toBe('voice-room');
    expect(launch.title).toBe('Voice room voice-room-1');
  });

  it('passes session hostUid through voice-room launch resolution', () => {
    const launch = resolveDrawingGuessLaunch({
      roomId: 'voice-room-1',
      source: 'voice-room',
      mode: 'online',
      playerId: 'joiner-uid',
      sessionId: 'rgs_session_1',
      hostUid: sessionHostUid,
      displayName: 'Sara',
    });

    expect(launch.hostUid).toBe(sessionHostUid);
    expect(launch.playerId).toBe('joiner-uid');
    expect(launch.sessionId).toBe('rgs_session_1');
    expect(launch.displayName).toBe('Sara');
  });

  it('keeps Games launch defaulted to local simulated mode', () => {
    const launch = resolveDrawingGuessLaunch({
      roomId: 'DG-GAME',
      source: 'games',
    });

    expect(launch.roomCode).toBe('DG-GAME');
    expect(launch.mode).toBe('local-simulated');
    expect(launch.hostUid).toBe('');
  });

  it('lets explicit route mode override source-based defaults', () => {
    expect(
      resolveDrawingGuessLaunch({
        roomId: 'voice-room-1',
        source: 'voice-room',
        mode: 'local-simulated',
      }).mode,
    ).toBe('local-simulated');
    expect(
      resolveDrawingGuessLaunch({
        roomId: 'DG-GAME',
        source: 'games',
        mode: 'online',
      }).mode,
    ).toBe('online');
  });

  it('seeds online host from the room session host, not the joining client', () => {
    const state = createOnlineDrawingGuessState({
      roomCode: 'voice-room-1',
      localPlayerId: 'joiner-uid',
      displayName: 'Sara',
      hostId: sessionHostUid,
      matchId: 'pending-rgs_session_1',
      now: 1000,
    });
    const viewModel = createDrawingGuessViewModel({
      state,
      roomCode: 'voice-room-1',
      localPlayerId: 'joiner-uid',
      now: 1000,
      transportMode: 'livekit',
      launchSource: 'voice-room',
    });

    expect(state.hostId).toBe(sessionHostUid);
    expect(state.matchId).toBe('pending-rgs_session_1');
    expect(state.players.map((player) => player.id)).toEqual(['joiner-uid']);
    expect(state.players[0].displayName).toBe('Sara');
    expect(viewModel.isHost).toBe(false);
    expect(viewModel.canStart).toBe(false);
  });

  it('keeps the session host as the only start authority', () => {
    let state = createOnlineDrawingGuessState({
      roomCode: 'voice-room-1',
      localPlayerId: sessionHostUid,
      displayName: 'Host',
      hostId: sessionHostUid,
      matchId: 'match-host-1',
      now: 1000,
    });
    state = drawingGuessReducer(state, {
      type: 'player-joined',
      player: {
        id: 'joiner-uid',
        displayName: 'Sara',
        avatarLabel: 'S',
        role: 'player',
        joinedAt: 1001,
      },
    });
    const viewModel = createDrawingGuessViewModel({
      state,
      roomCode: 'voice-room-1',
      localPlayerId: sessionHostUid,
      now: 1000,
      transportMode: 'livekit',
      launchSource: 'voice-room',
    });
    const joinerViewModel = createDrawingGuessViewModel({
      state,
      roomCode: 'voice-room-1',
      localPlayerId: 'joiner-uid',
      now: 1000,
      transportMode: 'livekit',
      launchSource: 'voice-room',
    });

    expect(state.hostId).toBe(sessionHostUid);
    expect(viewModel.isHost).toBe(true);
    expect(viewModel.canStart).toBe(true);
    expect(joinerViewModel.isHost).toBe(false);
    expect(joinerViewModel.canStart).toBe(false);
  });

  it('gives hosts a real match id and joiners a pending bootstrap id', () => {
    expect(
      resolveOnlineBootstrapMatchId({
        createMatchId: () => 'match-generated',
        hostUid: sessionHostUid,
        localPlayerId: sessionHostUid,
        roomCode: 'voice-room-1',
        sessionId: 'rgs_session_1',
      }),
    ).toBe('match-generated');

    expect(
      resolveOnlineBootstrapMatchId({
        createMatchId: () => 'match-generated',
        hostUid: sessionHostUid,
        localPlayerId: 'joiner-uid',
        roomCode: 'voice-room-1',
        sessionId: 'rgs_session_1',
      }),
    ).toBe('pending-rgs_session_1');
  });

  it('hides online create/join controls for voice-room launches', () => {
    const state = createOnlineDrawingGuessState({
      roomCode: 'voice-room-1',
      localPlayerId: sessionHostUid,
      displayName: 'Host',
      hostId: sessionHostUid,
      matchId: 'match-host-1',
      now: 1000,
    });
    const viewModel = createDrawingGuessViewModel({
      state,
      roomCode: 'voice-room-1',
      localPlayerId: sessionHostUid,
      now: 1000,
      transportMode: 'livekit',
      launchSource: 'voice-room',
    });

    expect(viewModel.isVoiceRoomSession).toBe(true);
    expect(viewModel.showOnlineControls).toBe(false);
    expect(viewModel.showRoomResetControls).toBe(false);
    expect(viewModel.onlineStatusLabel).toBe('Voice room match');
    expect(viewModel.lobbyStatusLabel).toContain('Waiting for another player');
  });

  it('tells voice-room joiners to wait for the host', () => {
    const state = createOnlineDrawingGuessState({
      roomCode: 'voice-room-1',
      localPlayerId: 'joiner-uid',
      displayName: 'Sara',
      hostId: sessionHostUid,
      matchId: 'pending-rgs_session_1',
      now: 1000,
    });
    const viewModel = createDrawingGuessViewModel({
      state,
      roomCode: 'voice-room-1',
      localPlayerId: 'joiner-uid',
      now: 1000,
      transportMode: 'livekit',
      launchSource: 'voice-room',
    });

    expect(viewModel.isHost).toBe(false);
    expect(viewModel.showOnlineControls).toBe(false);
    expect(viewModel.lobbyStatusLabel).toContain('Wait for the host');
  });

  it('keeps debug online controls available outside voice-room launches', () => {
    const state = createOnlineDrawingGuessState({
      roomCode: 'DG-ONLINE',
      localPlayerId,
      matchId: 'match-1',
      now: 1000,
    });
    const viewModel = createDrawingGuessViewModel({
      state,
      roomCode: 'DG-ONLINE',
      localPlayerId,
      now: 1000,
      transportMode: 'livekit',
      launchSource: 'games',
    });

    expect(viewModel.isVoiceRoomSession).toBe(false);
    expect(viewModel.showOnlineControls).toBe(true);
    expect(viewModel.showRoomResetControls).toBe(true);
  });

  it('creates a local simulated room with local and simulated players', () => {
    const state = createState();
    const viewModel = createDrawingGuessViewModel({
      state,
      roomCode: 'DG-TEST',
      localPlayerId,
      now: 1000,
      launchSource: 'games',
    });

    expect(viewModel.roomCode).toBe('DG-TEST');
    expect(viewModel.players.map((player) => player.id)).toEqual([
      localPlayerId,
      'dg-player-sim-1',
      'dg-player-sim-2',
    ]);
    expect(viewModel.canStart).toBe(true);
    expect(viewModel.isShowcaseMode).toBe(true);
    expect(viewModel.showOnlineControls).toBe(false);
    expect(viewModel.canUseSimulatedGuessControls).toBe(false);
    expect(viewModel.connectedPlayerCount).toBe(3);
    expect(viewModel.phaseLabel).toBe('Game setup');
    expect(viewModel.connectionLabel).toBe('Local game ready');
  });

  it('keeps Games showcase copy free of online and debug terms', () => {
    const state = createState();
    const viewModel = createDrawingGuessViewModel({
      state,
      roomCode: 'DG-TEST',
      localPlayerId,
      now: 1000,
      launchSource: 'games',
    });
    const visibleShowcaseCopy = [
      viewModel.connectionLabel,
      viewModel.launchTitle,
      viewModel.launchSubtitle,
      viewModel.onlineStatusLabel,
      viewModel.phaseLabel,
    ].join(' ');

    expect(visibleShowcaseCopy).not.toMatch(
      /\b(online|LiveKit|token|simulation|debug|future|wave)\b/i,
    );
  });

  it('keeps local showcase help concise and free of online and debug terms', () => {
    const helpCopy = [drawingGuessShowcaseHelpTitle, drawingGuessShowcaseHelpBody].join(' ');

    expect(drawingGuessShowcaseHelpSteps.length).toBeGreaterThanOrEqual(4);
    expect(helpCopy).toContain('secret prompt');
    expect(helpCopy).toContain('final score wins');
    expect(helpCopy).not.toMatch(/\b(online|LiveKit|token|simulation|debug|future|wave)\b/i);
  });

  it('keeps haptic feedback best-effort when native feedback rejects', async () => {
    const hapticsModule = async () => ({
      selectionAsync: async () => {
        throw new Error('no haptics');
      },
      notificationAsync: async () => {
        throw new Error('no haptics');
      },
    });

    await expect(triggerDrawingGuessHaptic('selection', hapticsModule)).resolves.toBeUndefined();
    await expect(triggerDrawingGuessHaptic('success', hapticsModule)).resolves.toBeUndefined();
  });

  it('creates an online room without simulated players', () => {
    const state = createOnlineDrawingGuessState({
      roomCode: 'voice-room-1',
      localPlayerId,
      matchId: 'match-1',
      now: 1000,
    });
    const viewModel = createDrawingGuessViewModel({
      state,
      roomCode: 'voice-room-1',
      localPlayerId,
      now: 1000,
      transportMode: 'livekit',
      launchSource: 'voice-room',
      launchTitle: 'Voice room voice-room-1',
      launchSubtitle: 'Joined from the voice room. Stay here while friends join from the invite card.',
    });

    expect(viewModel.players.map((player) => player.id)).toEqual([localPlayerId]);
    expect(viewModel.transportMode).toBe('livekit');
    expect(viewModel.launchSource).toBe('voice-room');
    expect(viewModel.launchTitle).toBe('Voice room voice-room-1');
    expect(viewModel.showOnlineControls).toBe(false);
    expect(viewModel.showRoomResetControls).toBe(false);
  });

  it('uses release-ready connection labels for online connection states', () => {
    const state = createOnlineDrawingGuessState({
      roomCode: 'voice-room-1',
      localPlayerId,
      matchId: 'match-1',
      now: 1000,
    });
    const viewModel = createDrawingGuessViewModel({
      state,
      roomCode: 'voice-room-1',
      localPlayerId,
      now: 1000,
      transportMode: 'livekit',
    });
    const recoveringViewModel = createDrawingGuessViewModel({
      state,
      roomCode: 'voice-room-1',
      localPlayerId,
      now: 1000,
      transportMode: 'livekit',
      isRecoveringSnapshot: true,
    });

    expect(viewModel.connectionLabel).toBe('Connecting to Drawing Guess online room');
    expect(recoveringViewModel.connectionLabel).toBe('Recovering online room');
  });

  it('starts match and moves to prompt selection', () => {
    let state = createState();

    state = drawingGuessReducer(state, {
      type: 'start-match',
      actorId: localPlayerId,
      now: 2000,
      matchId: 'match-2',
    });

    expect(state.phase).toBe('prompt-select');
    expect(state.promptOptions.length).toBeGreaterThan(0);

    const viewModel = createDrawingGuessViewModel({
      state,
      roomCode: 'DG-TEST',
      localPlayerId,
      now: 2000,
    });

    expect(viewModel.promptOptions[0].categoryLabel).toBeTruthy();
  });

  it('keeps prompt category labels and long text available in the view model', () => {
    const longPromptText =
      'A very long showcase prompt that should remain available for wrapping inside a prompt card';
    const state = {
      ...drawingGuessReducer(createState(), {
        type: 'start-match',
        actorId: localPlayerId,
        now: 2000,
        matchId: 'match-2',
      }),
      promptOptions: [
        {
          id: 'long-showcase-prompt',
          text: longPromptText,
          category: 'objects' as const,
          aliases: ['long object'],
        },
      ],
    };

    const viewModel = createDrawingGuessViewModel({
      state,
      roomCode: 'DG-TEST',
      localPlayerId,
      now: 2000,
      launchSource: 'games',
    });

    expect(viewModel.promptOptions[0]).toEqual({
      id: 'long-showcase-prompt',
      text: longPromptText,
      categoryLabel: 'Object',
    });
  });

  it('keeps long player names available for leaderboard and player rows', () => {
    const longDisplayName =
      'The Local Showcase Player With An Extra Long Display Name For Narrow Phones';
    const state = {
      ...createState(),
      players: createState().players.map((player) =>
        player.id === localPlayerId
          ? {
              ...player,
              displayName: longDisplayName,
            }
          : player,
      ),
    };

    const viewModel = createDrawingGuessViewModel({
      state,
      roomCode: 'DG-TEST',
      localPlayerId,
      now: 1000,
      launchSource: 'games',
    });

    expect(viewModel.players[0].displayName).toBe(longDisplayName);
    expect(viewModel.leaderboard.find((player) => player.playerId === localPlayerId)?.displayName).toBe(
      longDisplayName,
    );
  });

  it('ends a drawing round through existing host authority', () => {
    let state = createState();

    state = drawingGuessReducer(state, {
      type: 'start-match',
      actorId: localPlayerId,
      now: 2000,
      matchId: 'match-2',
    });
    state = drawingGuessReducer(state, {
      type: 'select-prompt',
      actorId: localPlayerId,
      prompt: state.promptOptions[0],
      now: 3000,
    });

    const drawingViewModel = createDrawingGuessViewModel({
      state,
      roomCode: 'DG-TEST',
      localPlayerId,
      now: 3500,
      launchSource: 'games',
    });

    expect(drawingViewModel.canEndRound).toBe(true);

    state = drawingGuessReducer(state, {
      type: 'end-round',
      actorId: localPlayerId,
      now: 4000,
    });

    expect(state.phase).toBe('round-results');
  });

  it('maps timer urgency and clamps round progress', () => {
    let state = createState();

    state = drawingGuessReducer(state, {
      type: 'start-match',
      actorId: localPlayerId,
      now: 2000,
      matchId: 'match-2',
    });
    state = drawingGuessReducer(state, {
      type: 'select-prompt',
      actorId: localPlayerId,
      prompt: state.promptOptions[0],
      now: 3000,
    });

    expect(
      createDrawingGuessViewModel({
        state,
        roomCode: 'DG-TEST',
        localPlayerId,
        now: 4000,
      }),
    ).toMatchObject({
      timerUrgency: 'normal',
      roundProgress: expect.closeTo(1 / 60, 3),
    });
    expect(
      createDrawingGuessViewModel({
        state,
        roomCode: 'DG-TEST',
        localPlayerId,
        now: state.roundEndsAt! - 10_000,
      }).timerUrgency,
    ).toBe('warning');
    expect(
      createDrawingGuessViewModel({
        state,
        roomCode: 'DG-TEST',
        localPlayerId,
        now: state.roundEndsAt! - 4_000,
      }).timerUrgency,
    ).toBe('danger');
    expect(
      createDrawingGuessViewModel({
        state,
        roomCode: 'DG-TEST',
        localPlayerId,
        now: state.roundEndsAt! + 10_000,
      }).roundProgress,
    ).toBe(1);
  });

  it('sorts final rankings by score', () => {
    let state = createState();
    state = {
      ...state,
      scores: {
        [localPlayerId]: 10,
        'dg-player-sim-1': 90,
        'dg-player-sim-2': 40,
      },
    };

    const viewModel = createDrawingGuessViewModel({
      state,
      roomCode: 'DG-TEST',
      localPlayerId,
      now: 1000,
      launchSource: 'games',
    });

    expect(viewModel.finalRankings.map((player) => player.playerId)).toEqual([
      'dg-player-sim-1',
      'dg-player-sim-2',
      localPlayerId,
    ]);
    expect(viewModel.finalRankings[0].rank).toBe(1);
    expect(viewModel.leaderboard[0].playerId).toBe('dg-player-sim-1');
    expect(viewModel.leaderboard[0].isWinner).toBe(true);
  });

  it('hides prompt from the local guesser view model', () => {
    let state = createState();

    state = drawingGuessReducer(state, {
      type: 'start-match',
      actorId: localPlayerId,
      now: 2000,
      matchId: 'match-2',
    });
    state = drawingGuessReducer(state, {
      type: 'select-prompt',
      actorId: localPlayerId,
      prompt: state.promptOptions[0],
      now: 3000,
    });
    state = drawingGuessReducer(state, { type: 'end-round', actorId: localPlayerId, now: 4000 });
    state = advanceToNextRound(state, localPlayerId, 5000);
    state = drawingGuessReducer(state, {
      type: 'select-prompt',
      actorId: state.drawerId!,
      prompt: getPromptById('apple')!,
      now: 6000,
    });

    const viewModel = createDrawingGuessViewModel({
      state,
      roomCode: 'DG-TEST',
      localPlayerId,
      now: 7000,
    });

    expect(viewModel.isDrawer).toBe(false);
    expect(viewModel.canGuess).toBe(true);
    expect(viewModel.canSubmitGuess).toBe(true);
    expect(viewModel.promptTextForDrawer).toBeUndefined();
    expect(viewModel.drawerName).toBe('Maha');
    expect(viewModel.phaseLabel).toBe('Drawing round');
    expect(viewModel.localRoundStatusLabel).toBe('Waiting for the drawer.');
  });

  it('updates guesses and score for a correct local guess', () => {
    let state = createState();

    state = drawingGuessReducer(state, {
      type: 'start-match',
      actorId: localPlayerId,
      now: 2000,
      matchId: 'match-2',
    });
    state = drawingGuessReducer(state, {
      type: 'select-prompt',
      actorId: localPlayerId,
      prompt: state.promptOptions[0],
      now: 3000,
    });
    state = drawingGuessReducer(state, { type: 'end-round', actorId: localPlayerId, now: 4000 });
    state = advanceToNextRound(state, localPlayerId, 5000);
    state = drawingGuessReducer(state, {
      type: 'select-prompt',
      actorId: state.drawerId!,
      prompt: getPromptById('apple')!,
      now: 6000,
    });
    state = drawingGuessReducer(state, {
      type: 'submit-guess',
      actorId: localPlayerId,
      guessId: 'guess-1',
      text: 'apple',
      now: 7000,
    });

    expect(state.guesses[0].isCorrect).toBe(true);
    expect(state.scores[localPlayerId]).toBeGreaterThan(0);

    const viewModel = createDrawingGuessViewModel({
      state,
      roomCode: 'DG-TEST',
      localPlayerId,
      now: 7000,
    });

    expect(viewModel.hasLocalPlayerGuessedCorrectly).toBe(true);
    expect(viewModel.canSubmitGuess).toBe(false);
    expect(viewModel.canGuess).toBe(false);
    expect(viewModel.localRoundStatusLabel).toBe('Correct! Wait for the round reveal.');
    expect(viewModel.guessFeed[0]).toMatchObject({
      playerName: 'You',
      isLocalPlayer: true,
      isCorrect: true,
    });
  });

  it('blocks drawer guesses through model rules', () => {
    let state = createState();

    state = drawingGuessReducer(state, {
      type: 'start-match',
      actorId: localPlayerId,
      now: 2000,
      matchId: 'match-2',
    });
    state = drawingGuessReducer(state, {
      type: 'select-prompt',
      actorId: localPlayerId,
      prompt: state.promptOptions[0],
      now: 3000,
    });
    state = drawingGuessReducer(state, {
      type: 'submit-guess',
      actorId: localPlayerId,
      guessId: 'guess-1',
      text: state.privatePrompt?.text ?? '',
      now: 4000,
    });

    expect(state.guesses).toEqual([]);
  });

  it('clears canvas and advances to match results after final drawer', () => {
    let state = createState();

    state = drawingGuessReducer(state, {
      type: 'start-match',
      actorId: localPlayerId,
      now: 2000,
      matchId: 'match-2',
    });

    for (let round = 0; round < 3; round += 1) {
      state = drawingGuessReducer(state, {
        type: 'select-prompt',
        actorId: state.drawerId!,
        prompt: state.promptOptions[0],
        now: 3000 + round,
      });
      state = drawingGuessReducer(state, { type: 'clear-canvas', actorId: state.drawerId! });
      expect(state.strokes).toEqual([]);
      state = drawingGuessReducer(state, {
        type: 'end-round',
        actorId: localPlayerId,
        now: 4000 + round,
      });
      state = advanceToNextRound(state, localPlayerId, 5000 + round);
    }

    expect(state.phase).toBe('match-results');
  });

  it('labels next round versus final scores', () => {
    let state = createState();

    state = drawingGuessReducer(state, {
      type: 'start-match',
      actorId: localPlayerId,
      now: 2000,
      matchId: 'match-2',
    });
    state = drawingGuessReducer(state, {
      type: 'select-prompt',
      actorId: localPlayerId,
      prompt: state.promptOptions[0],
      now: 3000,
    });
    state = drawingGuessReducer(state, {
      type: 'end-round',
      actorId: localPlayerId,
      now: 4000,
    });

    expect(
      createDrawingGuessViewModel({
        state,
        roomCode: 'DG-TEST',
        localPlayerId,
        now: 5000,
      }),
    ).toMatchObject({
      isFinalRound: false,
      nextRoundLabel: 'Next round',
    });

    state = advanceToNextRound(state, localPlayerId, 5000);
    state = drawingGuessReducer(state, {
      type: 'select-prompt',
      actorId: state.drawerId!,
      prompt: state.promptOptions[0],
      now: 6000,
    });
    state = drawingGuessReducer(state, {
      type: 'end-round',
      actorId: localPlayerId,
      now: 7000,
    });
    state = advanceToNextRound(state, localPlayerId, 8000);
    state = drawingGuessReducer(state, {
      type: 'select-prompt',
      actorId: state.drawerId!,
      prompt: state.promptOptions[0],
      now: 9000,
    });
    state = drawingGuessReducer(state, {
      type: 'end-round',
      actorId: localPlayerId,
      now: 10_000,
    });

    expect(
      createDrawingGuessViewModel({
        state,
        roomCode: 'DG-TEST',
        localPlayerId,
        now: 11_000,
      }),
    ).toMatchObject({
      isFinalRound: true,
      nextRoundLabel: 'Final scores',
    });
  });

  it('uses stable final ranking tie-breakers', () => {
    let state = createState();
    state = {
      ...state,
      players: [
        {
          ...state.players[0],
          displayName: 'Same',
        },
        {
          ...state.players[1],
          displayName: 'Same',
        },
        state.players[2],
      ],
      scores: {
        [localPlayerId]: 10,
        'dg-player-sim-1': 10,
        'dg-player-sim-2': 5,
      },
    };

    const viewModel = createDrawingGuessViewModel({
      state,
      roomCode: 'DG-TEST',
      localPlayerId,
      now: 1000,
      launchSource: 'games',
    });

    expect(viewModel.finalRankings.map((player) => player.playerId)).toEqual([
      localPlayerId,
      'dg-player-sim-1',
      'dg-player-sim-2',
    ]);
    expect(viewModel.finalRankings[0].isWinner).toBe(true);
  });

  it('keeps local showcase wrong guesses away from prompt answers', () => {
    const prompt = getPromptById('apple')!;
    const wrongGuess = getLocalShowcaseWrongGuess(prompt);

    expect(getPromptAnswers(prompt)).not.toContain(normalizeGuess(wrongGuess));
  });
});
