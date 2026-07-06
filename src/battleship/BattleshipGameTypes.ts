export type GamePhase =
  | 'pre-match'
  | 'setup-player-1'
  | 'handoff-to-player-2'
  | 'setup-player-2'
  | 'battle'
  | 'turn-handoff';

export type LastShot = {
  result: 'hit' | 'miss';
  text: string;
};

export type ShotAnimation = {
  cellId: string;
  result: 'hit' | 'miss';
};
