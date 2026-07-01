import { Dispatch, SetStateAction } from 'react';

import { MiniGameTarget } from '../types/miniGame';
import { MAX_ATTEMPTS, countHits, findTargetAtCell } from '../utils/miniGameEngine';
import { labels } from './constants';
import { GamePhase, LastShot, ShotAnimation } from './BattleshipGameTypes';

type UseBattleshipBattleActionsOptions = {
  activeGuesses: Set<string>;
  activeTargets: MiniGameTarget[];
  attemptsEnabled: boolean;
  currentPlayer: 1 | 2;
  defendingPlayer: 1 | 2;
  handleSetupCellPress: (cellId: string) => void;
  impactHeavy: () => void;
  impactLight: () => void;
  isCellDisabled: (cellId: string) => boolean;
  isSetupPhase: boolean;
  playHitSound: () => void;
  playMissSound: () => void;
  playTapSound: () => void;
  scheduleShotResolution: (onResolve: () => void) => void;
  setCurrentPlayer: Dispatch<SetStateAction<1 | 2>>;
  setLastShot: Dispatch<SetStateAction<LastShot | undefined>>;
  setPendingTurnPass: Dispatch<SetStateAction<boolean>>;
  setPhase: Dispatch<SetStateAction<GamePhase>>;
  setPlayerOneGuesses: Dispatch<SetStateAction<Set<string>>>;
  setPlayerTwoGuesses: Dispatch<SetStateAction<Set<string>>>;
  setShotAnimation: Dispatch<SetStateAction<ShotAnimation | undefined>>;
  totalTargetCells: number;
  triggerSunkEffect: (effectKey: string) => void;
};

export function useBattleshipBattleActions({
  activeGuesses,
  activeTargets,
  attemptsEnabled,
  currentPlayer,
  defendingPlayer,
  handleSetupCellPress,
  impactHeavy,
  impactLight,
  isCellDisabled,
  isSetupPhase,
  playHitSound,
  playMissSound,
  playTapSound,
  scheduleShotResolution,
  setCurrentPlayer,
  setLastShot,
  setPendingTurnPass,
  setPhase,
  setPlayerOneGuesses,
  setPlayerTwoGuesses,
  setShotAnimation,
  totalTargetCells,
  triggerSunkEffect,
}: UseBattleshipBattleActionsOptions) {
  const handleCellPress = (cellId: string) => {
    if (isSetupPhase) {
      handleSetupCellPress(cellId);
      return;
    }

    if (isCellDisabled(cellId)) {
      return;
    }

    const nextGuesses = new Set(activeGuesses).add(cellId);
    const target = findTargetAtCell(cellId, activeTargets);
    const isHit = Boolean(target);
    const nextHits = countHits(nextGuesses, activeTargets);
    const nextAttemptsLeft = attemptsEnabled ? MAX_ATTEMPTS - nextGuesses.size : Infinity;
    const nextPlayerWon = nextHits === totalTargetCells;
    const sunkTarget = target?.cells.every((cell) => nextGuesses.has(cell));

    playTapSound();
    impactLight();
    setShotAnimation({ cellId, result: isHit ? 'hit' : 'miss' });

    scheduleShotResolution(() => {
      if (currentPlayer === 1) {
        setPlayerOneGuesses(nextGuesses);
      } else {
        setPlayerTwoGuesses(nextGuesses);
      }

      setLastShot({
        result: isHit ? 'hit' : 'miss',
        text: isHit ? labels.hit : labels.miss,
      });

      if (isHit) {
        playHitSound();
        impactHeavy();
      } else {
        playMissSound();
        impactLight();
      }

      if (target && sunkTarget) {
        triggerSunkEffect(`${defendingPlayer}-${target.id}`);
      }

      if (!isHit && !nextPlayerWon && nextAttemptsLeft > 0) {
        setPendingTurnPass(true);
      }
    });
  };

  const passTurn = () => {
    playTapSound();
    impactLight();
    setPhase('turn-handoff');
  };

  const continueTurnHandoff = () => {
    playTapSound();
    impactLight();
    setCurrentPlayer(currentPlayer === 1 ? 2 : 1);
    setPendingTurnPass(false);
    setLastShot(undefined);
    setPhase('battle');
  };

  return {
    continueTurnHandoff,
    handleCellPress,
    passTurn,
  };
}
