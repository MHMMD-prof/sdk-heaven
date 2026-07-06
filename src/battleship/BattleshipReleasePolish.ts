import { GamePhase } from './BattleshipGameTypes';
import { BattleshipSaveState } from './BattleshipPersistence';
import { labels } from './constants';

export type BattleshipConfirmAction =
  | 'clear-setup'
  | 'mode-change'
  | 'new-match'
  | 'reset-battle'
  | 'reset-victory';

export type BattleshipConfirmDialogState = {
  action: BattleshipConfirmAction;
  confirmLabel: string;
  message: string;
  onConfirm: () => void;
  title: string;
};

export type BattleshipSavedMatchSummary = {
  line: string;
  phaseLabel: string;
  savedTimeLabel: string;
};

export type BattleshipPersistenceScreenState = {
  canResumeSavedMatch: boolean;
  canStartNewMatch: boolean;
  isPersistenceLoading: boolean;
};

const minuteMs = 60 * 1000;
const hourMs = 60 * minuteMs;
const dayMs = 24 * hourMs;

export const getSavedPhaseLabel = (phase: GamePhase) => {
  if (phase === 'battle' || phase === 'turn-handoff') {
    return labels.enemyWaters;
  }

  if (phase === 'handoff-to-player-2') {
    return labels.passTitle;
  }

  return labels.setupFleet;
};

export const getSavedTimeLabel = (savedAt: number, now = Date.now()) => {
  const elapsedMs = Math.max(0, now - savedAt);

  if (elapsedMs < minuteMs) {
    return labels.savedJustNow;
  }

  if (elapsedMs < hourMs) {
    return `${Math.floor(elapsedMs / minuteMs)} ${labels.savedMinutesAgo}`;
  }

  if (elapsedMs < dayMs) {
    return `${Math.floor(elapsedMs / hourMs)} ${labels.savedHoursAgo}`;
  }

  return `${Math.floor(elapsedMs / dayMs)} ${labels.savedDaysAgo}`;
};

export const getSavedMatchSummary = (
  savedMatch: BattleshipSaveState | undefined,
  now = Date.now(),
): BattleshipSavedMatchSummary | undefined => {
  if (!savedMatch) {
    return undefined;
  }

  const phaseLabel = getSavedPhaseLabel(savedMatch.phase);
  const savedTimeLabel = getSavedTimeLabel(savedMatch.savedAt, now);

  return {
    line: `${labels.player} ${savedMatch.currentPlayer} - ${phaseLabel} - ${savedTimeLabel}`,
    phaseLabel,
    savedTimeLabel,
  };
};

export const getConfirmCopy = (action: BattleshipConfirmAction) => {
  switch (action) {
    case 'clear-setup':
      return {
        confirmLabel: labels.clear,
        message: labels.confirmClearSetupMessage,
        title: labels.confirmClearSetupTitle,
      };
    case 'mode-change':
      return {
        confirmLabel: labels.confirmContinue,
        message: labels.confirmModeChangeMessage,
        title: labels.confirmModeChangeTitle,
      };
    case 'new-match':
      return {
        confirmLabel: labels.startMatch,
        message: labels.confirmNewMatchMessage,
        title: labels.confirmNewMatchTitle,
      };
    case 'reset-victory':
      return {
        confirmLabel: labels.newRound,
        message: labels.confirmVictoryResetMessage,
        title: labels.confirmVictoryResetTitle,
      };
    case 'reset-battle':
    default:
      return {
        confirmLabel: labels.newRound,
        message: labels.confirmBattleResetMessage,
        title: labels.confirmBattleResetTitle,
      };
  }
};

export const createBattleshipConfirmDialogState = ({
  action,
  onClose,
  onConfirm,
}: {
  action: BattleshipConfirmAction;
  onClose: () => void;
  onConfirm: () => void;
}): BattleshipConfirmDialogState => {
  const copy = getConfirmCopy(action);
  let consumed = false;

  return {
    action,
    ...copy,
    onConfirm: () => {
      if (consumed) {
        return;
      }

      consumed = true;
      onClose();
      onConfirm();
    },
  };
};

export const getBattleshipPersistenceScreenState = ({
  hasSavedMatch,
  persistenceReady,
}: {
  hasSavedMatch: boolean;
  persistenceReady: boolean;
}): BattleshipPersistenceScreenState => ({
  canResumeSavedMatch: persistenceReady && hasSavedMatch,
  canStartNewMatch: persistenceReady,
  isPersistenceLoading: !persistenceReady,
});
