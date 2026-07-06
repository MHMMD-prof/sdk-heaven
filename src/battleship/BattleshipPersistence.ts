import AsyncStorage from '@react-native-async-storage/async-storage';

import { MiniGameModeId, MiniGameTarget } from '../types/miniGame';
import { createBoardCells, isFleetPlaced } from '../utils/miniGameEngine';
import { GamePhase, LastShot } from './BattleshipGameTypes';

export const BATTLESHIP_SAVE_KEY = 'sdk-heaven:battleship:v1';

export type BattleshipSaveState = {
  attemptsEnabled: boolean;
  currentPlayer: 1 | 2;
  lastShot?: LastShot;
  modeId: MiniGameModeId;
  pendingTurnPass: boolean;
  phase: GamePhase;
  playerOneGuesses: string[];
  playerOneTargets: MiniGameTarget[];
  playerTwoGuesses: string[];
  playerTwoTargets: MiniGameTarget[];
  savedAt: number;
  selectedTargetId?: string;
};

type BattleshipSaveEnvelope = {
  game: BattleshipSaveState;
  version: 1;
};

const validPhases: GamePhase[] = [
  'setup-player-1',
  'handoff-to-player-2',
  'setup-player-2',
  'battle',
  'turn-handoff',
];

const boardCellSet = new Set(createBoardCells());

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const hasValidTargets = (value: unknown): value is MiniGameTarget[] =>
  Array.isArray(value) &&
  value.every((target) => {
    if (!target || typeof target !== 'object') {
      return false;
    }

    const candidate = target as Partial<MiniGameTarget>;

    return (
      typeof candidate.id === 'string' &&
      typeof candidate.name === 'string' &&
      typeof candidate.isPlaced === 'boolean' &&
      Array.isArray(candidate.cells) &&
      candidate.cells.every((cell) => typeof cell === 'string' && boardCellSet.has(cell)) &&
      Boolean(candidate.footprint) &&
      typeof candidate.footprint?.columns === 'number' &&
      typeof candidate.footprint?.rows === 'number'
    );
  });

const canRestorePhase = (game: Partial<BattleshipSaveState>) => {
  if (!hasValidTargets(game.playerOneTargets) || !hasValidTargets(game.playerTwoTargets)) {
    return false;
  }

  if (game.phase === 'handoff-to-player-2' || game.phase === 'setup-player-2') {
    return isFleetPlaced(game.playerOneTargets);
  }

  if (game.phase === 'battle' || game.phase === 'turn-handoff') {
    return isFleetPlaced(game.playerOneTargets) && isFleetPlaced(game.playerTwoTargets);
  }

  return game.phase === 'setup-player-1';
};

export const encodeBattleshipSave = (game: BattleshipSaveState) =>
  JSON.stringify({ game, version: 1 } satisfies BattleshipSaveEnvelope);

export const decodeBattleshipSave = (rawValue: string | null) => {
  if (!rawValue) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<BattleshipSaveEnvelope>;
    const game = parsed.game;

    if (
      parsed.version !== 1 ||
      !game ||
      !validPhases.includes(game.phase as GamePhase) ||
      (game.modeId !== 'naval' && game.modeId !== 'farm') ||
      (game.currentPlayer !== 1 && game.currentPlayer !== 2) ||
      typeof game.attemptsEnabled !== 'boolean' ||
      typeof game.pendingTurnPass !== 'boolean' ||
      typeof game.savedAt !== 'number' ||
      !isStringArray(game.playerOneGuesses) ||
      !isStringArray(game.playerTwoGuesses) ||
      !game.playerOneGuesses.every((cell) => boardCellSet.has(cell)) ||
      !game.playerTwoGuesses.every((cell) => boardCellSet.has(cell)) ||
      !canRestorePhase(game)
    ) {
      return undefined;
    }

    return game as BattleshipSaveState;
  } catch {
    return undefined;
  }
};

export const loadSavedBattleshipMatch = async () => {
  try {
    const rawValue = await AsyncStorage.getItem(BATTLESHIP_SAVE_KEY);
    const savedMatch = decodeBattleshipSave(rawValue);

    if (rawValue && !savedMatch) {
      await clearSavedBattleshipMatch();
    }

    return savedMatch;
  } catch {
    return undefined;
  }
};

export const saveBattleshipMatch = async (game: BattleshipSaveState) => {
  try {
    await AsyncStorage.setItem(BATTLESHIP_SAVE_KEY, encodeBattleshipSave(game));
    return true;
  } catch {
    return false;
  }
};

export const clearSavedBattleshipMatch = async () => {
  try {
    await AsyncStorage.removeItem(BATTLESHIP_SAVE_KEY);
    return true;
  } catch {
    return false;
  }
};
