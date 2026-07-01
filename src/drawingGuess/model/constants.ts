export const DRAWING_GUESS_PROTOCOL_VERSION = 1;

export const DRAWING_GUESS_TOPICS = {
  strokePreview: 'dg.v1.stroke.preview',
  strokeCommit: 'dg.v1.stroke.commit',
  chat: 'dg.v1.chat',
  control: 'dg.v1.control',
  snapshot: 'dg.v1.snapshot',
} as const;

export const DRAWING_GUESS_RULES = {
  minPlayers: 2,
  maxPlayers: 8,
  roundDurationMs: 60_000,
  guessBasePoints: 100,
  guessSpeedBonusPoints: 100,
  drawerCorrectRoundBonus: 50,
  promptOptionCount: 3,
} as const;

export const DRAWING_GUESS_SNAPSHOT = {
  maxChunkPayloadLength: 2_000,
  incompleteSnapshotTtlMs: 15_000,
} as const;

export const DRAWING_GUESS_STROKES = {
  minPointDistance: 0.004,
} as const;
