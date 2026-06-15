export type CarromPlayer = 1 | 2;

export type CarromCoinKind = 'white' | 'black';
export type CarromDiscKind = 'striker' | CarromCoinKind | 'queen';

export type CarromQueenState = {
  coveredBy?: CarromPlayer;
  pendingBy?: CarromPlayer;
  pocketed: boolean;
};

export type CarromDisc = {
  id: string;
  kind: CarromDiscKind;
  owner?: CarromPlayer;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  mass: number;
  restitution: number;
  rollingDrag: number;
  pocketed?: boolean;
  sleepFrames?: number;
};

export type CarromShotGuide = {
  x: number;
  y: number;
  power: number;
};

export type CarromGameState = {
  currentPlayer: CarromPlayer;
  discs: CarromDisc[];
  pocketedThisTurn: CarromDisc[];
  playerCoins: Record<CarromPlayer, CarromCoinKind>;
  queen: CarromQueenState;
  scores: Record<CarromPlayer, number>;
  status: 'placing' | 'aiming' | 'moving' | 'turnComplete' | 'gameOver';
  message: string;
  winner?: CarromPlayer;
};
