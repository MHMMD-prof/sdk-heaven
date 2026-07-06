import { describe, expect, it } from 'vitest';

import { createClientHostAuthority } from '../model/authority';
import {
  advanceToNextRound,
  createInitialDrawingGuessState,
  drawingGuessReducer,
  shouldAutoEndRound,
} from '../model/drawingGuessReducer';
import { isCorrectGuessForPrompt, normalizeGuess } from '../model/guessNormalization';
import { DrawingGuessPrompt, DrawingGuessState, DrawingStroke } from '../model/types';
import { drawingGuessWordBank } from '../model/wordBank';

const prompt: DrawingGuessPrompt = {
  id: 'apple',
  text: 'Apple',
  category: 'food',
  aliases: ['تفاحة'],
};

const createPlayer = (id: string, joinedAt = 1) => ({
  id,
  displayName: id,
  avatarLabel: id.charAt(0).toUpperCase(),
  role: 'player' as const,
  joinedAt,
});

const joinThreePlayers = () => {
  let state = createInitialDrawingGuessState({ roomId: 'room-1' });

  state = drawingGuessReducer(state, { type: 'player-joined', player: createPlayer('p1', 1) });
  state = drawingGuessReducer(state, { type: 'player-joined', player: createPlayer('p2', 2) });
  state = drawingGuessReducer(state, { type: 'player-joined', player: createPlayer('p3', 3) });

  return state;
};

const startDrawingRound = () => {
  let state = joinThreePlayers();
  state = drawingGuessReducer(state, {
    type: 'start-match',
    actorId: 'p1',
    now: 1000,
    matchId: 'match-1',
  });
  state = drawingGuessReducer(state, {
    type: 'select-prompt',
    actorId: 'p1',
    prompt,
    now: 2000,
  });

  return state;
};

describe('Drawing Guess model', () => {
  it('has a showcase-ready safe prompt bank', () => {
    const promptIds = new Set(drawingGuessWordBank.map((item) => item.id));
    const validCategories = new Set([
      'objects',
      'food',
      'places',
      'actions',
      'animals',
      'household',
    ]);

    expect(drawingGuessWordBank.length).toBeGreaterThanOrEqual(60);
    expect(promptIds.size).toBe(drawingGuessWordBank.length);
    drawingGuessWordBank.forEach((item) => {
      expect(item.id.trim()).toBe(item.id);
      expect(item.text.trim()).toBe(item.text);
      expect(validCategories.has(item.category)).toBe(true);
      expect(Array.isArray(item.aliases)).toBe(true);
      expect(item.aliases.length).toBeGreaterThan(0);
    });
  });

  it('creates initial lobby state and handles player join/leave', () => {
    let state = createInitialDrawingGuessState({ roomId: 'room-1' });

    expect(state.phase).toBe('lobby');
    expect(state.players).toEqual([]);
    expect(state.hostId).toBeUndefined();

    state = drawingGuessReducer(state, { type: 'player-joined', player: createPlayer('p1') });
    expect(state.players).toHaveLength(1);
    expect(state.players[0].isConnected).toBe(true);

    state = drawingGuessReducer(state, { type: 'player-left', playerId: 'p1' });
    expect(state.players[0].isConnected).toBe(false);
  });

  it('makes the first player host and transfers host to lowest join order connected player', () => {
    let state = joinThreePlayers();

    expect(state.hostId).toBe('p1');

    state = drawingGuessReducer(state, { type: 'player-left', playerId: 'p1' });
    expect(state.hostId).toBe('p2');
  });

  it('prevents non-host start and exposes host authority permissions', () => {
    let state = joinThreePlayers();
    const authority = createClientHostAuthority(state);

    expect(authority.canStartRound('p1')).toBe(true);
    expect(authority.canStartRound('p2')).toBe(false);
    expect(authority.canScoreGuess('p2')).toBe(false);

    state = drawingGuessReducer(state, {
      type: 'start-match',
      actorId: 'p2',
      now: 1000,
    });

    expect(state.phase).toBe('lobby');
  });

  it('starts match with deterministic turn order and rotates rounds', () => {
    let state = joinThreePlayers();

    state = drawingGuessReducer(state, {
      type: 'start-match',
      actorId: 'p1',
      now: 1000,
      matchId: 'match-1',
    });

    expect(state.phase).toBe('prompt-select');
    expect(state.turnOrder).toEqual(['p1', 'p2', 'p3']);
    expect(state.drawerId).toBe('p1');

    state = drawingGuessReducer(state, {
      type: 'select-prompt',
      actorId: 'p1',
      prompt,
      now: 2000,
    });
    state = drawingGuessReducer(state, { type: 'end-round', actorId: 'p1', now: 3000 });
    state = advanceToNextRound(state, 'p1', 4000);

    expect(state.phase).toBe('prompt-select');
    expect(state.drawerId).toBe('p2');
    expect(state.roundNumber).toBe(2);
  });

  it('hides prompt during drawing and reveals it only in round results', () => {
    let state = startDrawingRound();

    expect(state.phase).toBe('drawing');
    expect(state.promptCommitment).toBe('prompt:apple');
    expect(state.revealedPrompt).toBeUndefined();

    state = drawingGuessReducer(state, { type: 'end-round', actorId: 'p1', now: 3000 });

    expect(state.phase).toBe('round-results');
    expect(state.revealedPrompt?.id).toBe('apple');
  });

  it('allows only the drawer to choose a prompt', () => {
    let state = joinThreePlayers();

    state = drawingGuessReducer(state, {
      type: 'start-match',
      actorId: 'p1',
      now: 1000,
      matchId: 'match-1',
    });
    state = advanceToNextRound(
      drawingGuessReducer(
        drawingGuessReducer(state, {
          type: 'select-prompt',
          actorId: 'p1',
          prompt,
          now: 2000,
        }),
        { type: 'end-round', actorId: 'p1', now: 3000, reason: 'manual' },
      ),
      'p1',
      4000,
    );

    expect(state.drawerId).toBe('p2');

    const hostSelectedState = drawingGuessReducer(state, {
      type: 'select-prompt',
      actorId: 'p1',
      prompt,
      now: 5000,
    });
    const drawerSelectedState = drawingGuessReducer(state, {
      type: 'select-prompt',
      actorId: 'p2',
      prompt,
      now: 5000,
    });

    expect(hostSelectedState.phase).toBe('prompt-select');
    expect(drawerSelectedState.phase).toBe('drawing');
  });

  it('normalizes guesses for English, whitespace, Arabic diacritics, and aliases', () => {
    expect(normalizeGuess('  APPLE   Pie  ')).toBe('apple pie');
    expect(normalizeGuess('تُفَّاحة')).toBe('تفاحة');
    expect(isCorrectGuessForPrompt('  تُفَّاحة ', prompt)).toBe(true);
    expect(isCorrectGuessForPrompt('apple', prompt)).toBe(true);
  });

  it('blocks drawer guesses and scores each correct guesser once', () => {
    let state = startDrawingRound();

    state = drawingGuessReducer(state, {
      type: 'submit-guess',
      actorId: 'p1',
      guessId: 'guess-drawer',
      text: 'apple',
      now: 3000,
    });
    expect(state.guesses).toHaveLength(0);
    expect(state.scores.p1).toBe(0);

    state = drawingGuessReducer(state, {
      type: 'submit-guess',
      actorId: 'p2',
      guessId: 'guess-1',
      text: 'apple',
      now: 3000,
    });
    const scoreAfterFirstCorrectGuess = state.scores.p2;

    state = drawingGuessReducer(state, {
      type: 'submit-guess',
      actorId: 'p2',
      guessId: 'guess-2',
      text: 'تفاحة',
      now: 3500,
    });

    expect(state.correctGuessPlayerIds).toEqual(['p2']);
    expect(state.scores.p2).toBe(scoreAfterFirstCorrectGuess);
  });

  it('ignores whitespace guesses', () => {
    let state = startDrawingRound();

    state = drawingGuessReducer(state, {
      type: 'submit-guess',
      actorId: 'p2',
      guessId: 'guess-empty',
      text: '   ',
      now: 3000,
    });

    expect(state.guesses).toEqual([]);
  });

  it('auto-ends when all eligible guessers are correct', () => {
    let state = startDrawingRound();

    state = drawingGuessReducer(state, {
      type: 'submit-guess',
      actorId: 'p2',
      guessId: 'guess-1',
      text: 'apple',
      now: 3000,
    });

    expect(state.phase).toBe('drawing');
    expect(shouldAutoEndRound(state, 3000)).toEqual({ shouldEnd: false });

    state = drawingGuessReducer(state, {
      type: 'submit-guess',
      actorId: 'p3',
      guessId: 'guess-2',
      text: 'apple',
      now: 3500,
    });

    expect(state.phase).toBe('round-results');
    expect(state.roundEndReason).toBe('all-guessed');
    expect(state.revealedPrompt?.id).toBe('apple');
  });

  it('detects timer auto-end without ending early', () => {
    const state = startDrawingRound();

    expect(shouldAutoEndRound(state, state.roundEndsAt! - 1)).toEqual({ shouldEnd: false });
    expect(shouldAutoEndRound(state, state.roundEndsAt!)).toEqual({
      shouldEnd: true,
      reason: 'timer',
    });
  });

  it('adds drawer bonus only when at least one player guessed correctly', () => {
    let state = startDrawingRound();

    state = drawingGuessReducer(state, {
      type: 'submit-guess',
      actorId: 'p2',
      guessId: 'guess-1',
      text: 'apple',
      now: 3000,
    });
    state = drawingGuessReducer(state, { type: 'end-round', actorId: 'p1', now: 4000 });
    expect(state.scores.p1).toBe(50);
    expect(state.roundScoreDeltas.p1).toBe(50);
    expect(state.roundScoreDeltas.p2).toBeGreaterThan(0);

    let noCorrectGuessState = startDrawingRound();
    noCorrectGuessState = drawingGuessReducer(noCorrectGuessState, {
      type: 'submit-guess',
      actorId: 'p2',
      guessId: 'guess-2',
      text: 'wrong',
      now: 3000,
    });
    noCorrectGuessState = drawingGuessReducer(noCorrectGuessState, {
      type: 'end-round',
      actorId: 'p1',
      now: 4000,
    });

    expect(noCorrectGuessState.scores.p1).toBe(0);
  });

  it('clears canvas by incrementing revision and ignores old or duplicate strokes', () => {
    let state = startDrawingRound();
    const stroke = createStroke(state, 'stroke-1', state.canvasRevision);

    state = drawingGuessReducer(state, {
      type: 'commit-stroke',
      actorId: 'p1',
      stroke,
    });
    state = drawingGuessReducer(state, {
      type: 'commit-stroke',
      actorId: 'p1',
      stroke,
    });

    expect(state.strokes).toHaveLength(1);

    state = drawingGuessReducer(state, { type: 'clear-canvas', actorId: 'p1' });
    expect(state.canvasRevision).toBe(2);
    expect(state.strokes).toEqual([]);

    state = drawingGuessReducer(state, {
      type: 'commit-stroke',
      actorId: 'p1',
      stroke,
    });
    expect(state.strokes).toEqual([]);
  });

  it('undoes only the drawer latest stroke in the current round', () => {
    let state = startDrawingRound();

    state = drawingGuessReducer(state, {
      type: 'commit-stroke',
      actorId: 'p1',
      stroke: createStroke(state, 'stroke-1', state.canvasRevision),
    });
    state = drawingGuessReducer(state, {
      type: 'commit-stroke',
      actorId: 'p1',
      stroke: createStroke(state, 'stroke-2', state.canvasRevision),
    });
    state = drawingGuessReducer(state, {
      type: 'undo-latest-stroke',
      actorId: 'p1',
    });

    expect(state.strokes.map((stroke) => stroke.id)).toEqual(['stroke-1']);
    expect(state.strokeIndex['stroke-2']).toBeUndefined();
  });
});

const createStroke = (
  state: DrawingGuessState,
  id: string,
  revision: number,
): DrawingStroke => ({
  id,
  authorId: state.drawerId ?? 'p1',
  tool: 'brush',
  color: '#111111',
  width: 4,
  points: [
    { x: 0.1, y: 0.1 },
    { x: 0.2, y: 0.2 },
  ],
  createdAt: 2500,
  revision,
});
