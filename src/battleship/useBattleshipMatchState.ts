import { MiniGameTarget } from '../types/miniGame';
import {
  MAX_ATTEMPTS,
  countHits,
  getFleetCellCount,
  isFleetPlaced,
} from '../utils/miniGameEngine';
import { labels } from './constants';
import { GamePhase, ShotAnimation } from './BattleshipGameTypes';

type UseBattleshipMatchStateOptions = {
  attemptsEnabled: boolean;
  currentPlayer: 1 | 2;
  pendingTurnPass: boolean;
  phase: GamePhase;
  playerOneGuesses: Set<string>;
  playerOneTargets: MiniGameTarget[];
  playerTwoGuesses: Set<string>;
  playerTwoTargets: MiniGameTarget[];
  selectedTargetId?: string;
  shotAnimation?: ShotAnimation;
};

export function useBattleshipMatchState({
  attemptsEnabled,
  currentPlayer,
  pendingTurnPass,
  phase,
  playerOneGuesses,
  playerOneTargets,
  playerTwoGuesses,
  playerTwoTargets,
  selectedTargetId,
  shotAnimation,
}: UseBattleshipMatchStateOptions) {
  const isSetupPhase = phase === 'setup-player-1' || phase === 'setup-player-2';
  const setupPlayer: 1 | 2 = phase === 'setup-player-2' ? 2 : 1;
  const setupTargets = setupPlayer === 1 ? playerOneTargets : playerTwoTargets;
  const selectedTarget = setupTargets.find((target) => target.id === selectedTargetId);
  const setupFleetReady = isFleetPlaced(setupTargets);
  const activeTargets = currentPlayer === 1 ? playerTwoTargets : playerOneTargets;
  const activeGuesses = currentPlayer === 1 ? playerOneGuesses : playerTwoGuesses;
  const ownTargets = currentPlayer === 1 ? playerOneTargets : playerTwoTargets;
  const ownIncomingGuesses = currentPlayer === 1 ? playerTwoGuesses : playerOneGuesses;
  const playerOneHits = countHits(playerOneGuesses, playerTwoTargets);
  const playerTwoHits = countHits(playerTwoGuesses, playerOneTargets);
  const totalTargetCells = getFleetCellCount(playerOneTargets);
  const playerOneAttemptsLeft = attemptsEnabled ? MAX_ATTEMPTS - playerOneGuesses.size : Infinity;
  const playerTwoAttemptsLeft = attemptsEnabled ? MAX_ATTEMPTS - playerTwoGuesses.size : Infinity;
  const playerOneWon = playerOneHits === totalTargetCells;
  const playerTwoWon = playerTwoHits === totalTargetCells;
  const attemptsLeft = currentPlayer === 1 ? playerOneAttemptsLeft : playerTwoAttemptsLeft;
  const attemptsLeftText = attemptsEnabled ? String(attemptsLeft) : '\u221e';
  const hits = currentPlayer === 1 ? playerOneHits : playerTwoHits;
  const shotsTaken = activeGuesses.size;
  const winner: 1 | 2 | undefined = playerOneWon ? 1 : playerTwoWon ? 2 : undefined;
  const bothOutOfAttempts =
    attemptsEnabled && playerOneAttemptsLeft === 0 && playerTwoAttemptsLeft === 0;
  const isGameOver = phase === 'battle' && (Boolean(winner) || bothOutOfAttempts);
  const statusText = isSetupPhase
    ? `${labels.setupFleet} - ${labels.player} ${setupPlayer}`
    : phase === 'turn-handoff'
      ? `${labels.preparePlayer} ${labels.player} ${currentPlayer === 1 ? 2 : 1}`
      : shotAnimation
        ? labels.shotFlying
        : winner
          ? `${labels.winner} ${labels.player} ${winner}`
          : bothOutOfAttempts
            ? labels.roundOver
            : pendingTurnPass
              ? labels.passTurnStatus
              : `${labels.turn} ${labels.player} ${currentPlayer}`;

  return {
    activeGuesses,
    activeTargets,
    attemptsLeftText,
    bothOutOfAttempts,
    hits,
    isGameOver,
    isSetupPhase,
    ownIncomingGuesses,
    ownTargets,
    playerOneHits,
    playerTwoHits,
    setupFleetReady,
    setupPlayer,
    setupTargets,
    selectedTarget,
    shotsTaken,
    statusText,
    totalTargetCells,
    winner,
  };
}
