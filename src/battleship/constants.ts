import { ImageSourcePropType } from 'react-native';

import { MiniGameTarget } from '../types/miniGame';

export type ShipImageKey = NonNullable<MiniGameTarget['imageKey']>;
export type ShipOrientation = 'horizontal' | 'vertical';
export type ShipCrop = {
  height: number;
  width: number;
  x: number;
  y: number;
};
export type ShipSprite = {
  crop: Record<ShipOrientation, ShipCrop>;
  sheet: {
    height: number;
    width: number;
  };
  source: ImageSourcePropType;
};
export type SoundKey = 'hit' | 'invalid' | 'miss' | 'sunk' | 'tap' | 'victory';

export const columnLabels = ['A', 'B', 'C', 'D', 'E', 'F'];
export const rowLabels = ['1', '2', '3', '4', '5', '6'];

export const soundSources: Record<SoundKey, number> = {
  hit: require('../../assets/sounds/hit.wav'),
  invalid: require('../../assets/sounds/invalid.wav'),
  miss: require('../../assets/sounds/miss.wav'),
  sunk: require('../../assets/sounds/sunk.wav'),
  tap: require('../../assets/sounds/tap.wav'),
  victory: require('../../assets/sounds/victory.wav'),
};

export const labels = {
  back: '\u0631\u062c\u0648\u0639',
  clear: '\u0645\u0633\u062d',
  confirmFleet: '\u062a\u0623\u0643\u064a\u062f \u0627\u0644\u0623\u0633\u0637\u0648\u0644',
  attemptsOff: '\u0628\u062f\u0648\u0646 \u062d\u062f \u0644\u0644\u0631\u0645\u064a\u0627\u062a',
  attemptsOn: '\u062d\u062f \u0627\u0644\u0631\u0645\u064a\u0627\u062a',
  draw: '\u062a\u0639\u0627\u062f\u0644',
  enemyWaters: '\u0645\u064a\u0627\u0647 \u0627\u0644\u062e\u0635\u0645',
  hit: '\u0625\u0635\u0627\u0628\u0629',
  hits: '\u0625\u0635\u0627\u0628\u0627\u062a',
  localGame: '\u0644\u0639\u0628\u0629 \u062a\u062c\u0631\u064a\u0628\u064a\u0629 \u0645\u062d\u0644\u064a\u0629',
  miss: '\u0645\u062d\u0627\u0648\u0644\u0629 \u0641\u0627\u0631\u063a\u0629',
  newRound: '\u062c\u0648\u0644\u0629 \u062c\u062f\u064a\u062f\u0629',
  noWinner: '\u0644\u0645 \u064a\u062d\u0633\u0645 \u0623\u062d\u062f \u0627\u0644\u0645\u0639\u0631\u0643\u0629',
  ownFleet: '\u0623\u0633\u0637\u0648\u0644\u0643',
  passReady: '\u0627\u0644\u062c\u0647\u0627\u0632 \u062c\u0627\u0647\u0632',
  passTitle: '\u0633\u0644\u0645 \u0627\u0644\u062c\u0647\u0627\u0632',
  passTurn: '\u062a\u0633\u0644\u064a\u0645 \u0627\u0644\u062f\u0648\u0631',
  passTurnStatus:
    '\u0631\u0627\u062c\u0639 \u0627\u0644\u0646\u062a\u064a\u062c\u0629 \u062b\u0645 \u0633\u0644\u0645 \u0627\u0644\u062f\u0648\u0631',
  placed: '\u0645\u0648\u0636\u0648\u0639\u0629',
  preparePlayer: '\u0627\u0633\u062a\u0639\u062f \u064a\u0627',
  player: '\u0627\u0644\u0644\u0627\u0639\u0628',
  randomize: '\u0639\u0634\u0648\u0627\u0626\u064a',
  remaining: '\u0645\u062a\u0628\u0642\u064a',
  rotate: '\u062a\u062f\u0648\u064a\u0631',
  roundOver: '\u0627\u0646\u062a\u0647\u062a \u0627\u0644\u0645\u062d\u0627\u0648\u0644\u0627\u062a',
  setupFleet: '\u062a\u062c\u0647\u064a\u0632 \u0627\u0644\u0623\u0633\u0637\u0648\u0644',
  shots: '\u0631\u0645\u064a\u0627\u062a',
  shotFlying: '\u0627\u0644\u0631\u0645\u064a\u0629 \u0641\u064a \u0627\u0644\u0637\u0631\u064a\u0642',
  soundOff: '\u0627\u0644\u0635\u0648\u062a \u0645\u0643\u062a\u0648\u0645',
  soundOn: '\u0627\u0644\u0635\u0648\u062a \u0645\u0641\u0639\u0644',
  startMatch: '\u0628\u062f\u0621 \u0627\u0644\u0645\u0628\u0627\u0631\u0627\u0629',
  subtitleSuffix:
    '\u062a\u0645\u0631\u064a\u0631 \u0627\u0644\u062c\u0647\u0627\u0632 \u0628\u064a\u0646 \u0627\u0644\u0644\u0627\u0639\u0628\u064a\u0646 \u062d\u0627\u0644\u064a\u0627.',
  sunk: '\u063a\u0627\u0631\u0642\u0629',
  targetFleet: '\u0623\u0633\u0637\u0648\u0644 \u0627\u0644\u062e\u0635\u0645',
  turn: '\u062f\u0648\u0631',
  unplaced: '\u0642\u064a\u062f \u0627\u0644\u062a\u062c\u0647\u064a\u0632',
  waiting: '\u0642\u064a\u062f \u0627\u0644\u0628\u062d\u062b',
  winner: '\u0641\u0627\u0632',
  victory: '\u0627\u0644\u0646\u0635\u0631',
};

export const shipSprites: Record<ShipImageKey, ShipSprite> = {
  big: {
    source: require('../../assets/battleships/big-ship.png'),
    sheet: { width: 1536, height: 1024 },
    crop: {
      horizontal: { x: 700, y: 62, width: 762, height: 440 },
      vertical: { x: 178, y: 34, width: 430, height: 844 },
    },
  },
  long: {
    source: require('../../assets/battleships/long-ship.png'),
    sheet: { width: 1536, height: 1024 },
    crop: {
      horizontal: { x: 718, y: 260, width: 700, height: 384 },
      vertical: { x: 244, y: 32, width: 306, height: 874 },
    },
  },
  medium: {
    source: require('../../assets/battleships/medium-ship.png'),
    sheet: { width: 1536, height: 1024 },
    crop: {
      horizontal: { x: 676, y: 146, width: 744, height: 350 },
      vertical: { x: 134, y: 18, width: 420, height: 928 },
    },
  },
  small: {
    source: require('../../assets/battleships/small-ship.png'),
    sheet: { width: 809, height: 439 },
    crop: {
      horizontal: { x: 114, y: 40, width: 342, height: 252 },
      vertical: { x: 542, y: 16, width: 218, height: 390 },
    },
  },
};
