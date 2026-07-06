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
  cancel: 'إلغاء',
  clear: '\u0645\u0633\u062d',
  confirmFleet: '\u062a\u0623\u0643\u064a\u062f \u0627\u0644\u0623\u0633\u0637\u0648\u0644',
  confirmBattleResetMessage: 'سيتم إنهاء المباراة الحالية والعودة إلى بداية محلية جديدة.',
  confirmBattleResetTitle: 'إنهاء المباراة؟',
  confirmCancelHint: 'يغلق التأكيد ويحافظ على المباراة الحالية.',
  confirmClearSetupMessage: 'سيتم مسح أماكن سفن هذا اللاعب فقط لتجهيزها من جديد.',
  confirmClearSetupTitle: 'مسح الأسطول؟',
  confirmContinue: 'متابعة',
  confirmModeChangeMessage: 'تغيير النوع يبدأ تجهيز مباراة جديدة ويمسح التقدم الحالي.',
  confirmModeChangeTitle: 'تغيير نوع المباراة؟',
  confirmNewMatchMessage: 'سيتم استبدال المباراة المحفوظة والبدء من تجهيز اللاعب الأول.',
  confirmNewMatchTitle: 'بدء مباراة جديدة؟',
  confirmProceedHint: 'ينفذ الإجراء المحدد.',
  confirmVictoryResetMessage: 'سيتم إغلاق نتيجة المباراة والبدء من جديد.',
  confirmVictoryResetTitle: 'مباراة جديدة؟',
  attemptsOff: '\u0628\u062f\u0648\u0646 \u062d\u062f \u0644\u0644\u0631\u0645\u064a\u0627\u062a',
  attemptsOn: '\u062d\u062f \u0627\u0644\u0631\u0645\u064a\u0627\u062a',
  attemptsHint: 'يبدل بين عدد رميات محدود ورميات غير محدودة.',
  backHint: 'يرجع إلى شاشة الألعاب.',
  draw: '\u062a\u0639\u0627\u062f\u0644',
  enemyWaters: '\u0645\u064a\u0627\u0647 \u0627\u0644\u062e\u0635\u0645',
  fireCellHint: 'يرمي على هذه الخانة إذا كانت متاحة.',
  hit: '\u0625\u0635\u0627\u0628\u0629',
  hits: '\u0625\u0635\u0627\u0628\u0627\u062a',
  helpTitle: '\u0643\u064a\u0641 \u062a\u0644\u0639\u0628',
  helpSetup: '\u062c\u0647\u0632 \u0623\u0633\u0637\u0648\u0644\u0643 \u0628\u0627\u0644\u0633\u062d\u0628 \u0623\u0648 \u0627\u0644\u0646\u0642\u0631\u060c \u0648\u0627\u0633\u062a\u062e\u062f\u0645 \u0627\u0644\u062a\u062f\u0648\u064a\u0631 \u0644\u062a\u063a\u064a\u064a\u0631 \u0627\u062a\u062c\u0627\u0647 \u0627\u0644\u0633\u0641\u0646.',
  helpPrivacy: '\u0633\u0644\u0645 \u0627\u0644\u062c\u0647\u0627\u0632 \u0628\u0639\u062f \u0643\u0644 \u0645\u0631\u062d\u0644\u0629 \u062d\u062a\u0649 \u0644\u0627 \u064a\u0631\u0649 \u0627\u0644\u0644\u0627\u0639\u0628 \u0627\u0644\u0622\u062e\u0631 \u0623\u0633\u0637\u0648\u0644\u0643.',
  helpFire: '\u0641\u064a \u0627\u0644\u0645\u0639\u0631\u0643\u0629\u060c \u0627\u062e\u062a\u0631 \u062e\u0627\u0646\u0629 \u0648\u0627\u062d\u062f\u0629 \u0644\u0644\u0631\u0645\u064a. \u0628\u0639\u062f \u0627\u0644\u0625\u062e\u0641\u0627\u0642 \u0633\u0644\u0645 \u0627\u0644\u062f\u0648\u0631.',
  localGame: '\u0645\u0628\u0627\u0631\u0632\u0629 \u0645\u062d\u0644\u064a\u0629',
  miss: '\u0645\u062d\u0627\u0648\u0644\u0629 \u0641\u0627\u0631\u063a\u0629',
  modeHint: 'يغير نوع المباراة ويبدأ تجهيز مباراة جديدة.',
  newRound: '\u062c\u0648\u0644\u0629 \u062c\u062f\u064a\u062f\u0629',
  newRoundHint: 'يطلب تأكيد بدء مباراة جديدة.',
  noWinner: '\u0644\u0645 \u064a\u062d\u0633\u0645 \u0623\u062d\u062f \u0627\u0644\u0645\u0639\u0631\u0643\u0629',
  ownFleet: '\u0623\u0633\u0637\u0648\u0644\u0643',
  passConfirm: '\u0623\u0643\u062f \u0623\u0646 \u0627\u0644\u062c\u0647\u0627\u0632 \u0645\u0639 \u0627\u0644\u0644\u0627\u0639\u0628 \u0627\u0644\u0635\u062d\u064a\u062d',
  passConfirmHint: 'يجب تفعيله قبل كشف شاشة اللاعب التالي.',
  passSetupReady: 'عرض تجهيز اللاعب',
  passReady: '\u0627\u0644\u062c\u0647\u0627\u0632 \u062c\u0627\u0647\u0632',
  passPrivacy:
    '\u0623\u0628\u0639\u062f \u0627\u0644\u062c\u0647\u0627\u0632 \u0639\u0646 \u0627\u0644\u0644\u0627\u0639\u0628 \u0627\u0644\u0622\u062e\u0631 \u0642\u0628\u0644 \u0627\u0644\u0645\u062a\u0627\u0628\u0639\u0629.',
  passSetupText: 'مرر الجهاز للاعب التالي حتى يجهز أسطوله بدون كشف أسطولك.',
  passTitle: '\u0633\u0644\u0645 \u0627\u0644\u062c\u0647\u0627\u0632',
  passTurn: '\u062a\u0633\u0644\u064a\u0645 \u0627\u0644\u062f\u0648\u0631',
  passTurnHint: 'ينقل إلى شاشة التسليم قبل دور اللاعب التالي.',
  passTurnReady: 'عرض دور اللاعب',
  passTurnText: 'مرر الجهاز للاعب التالي قبل كشف مياه الخصم والرميات السابقة.',
  passTurnStatus:
    '\u0631\u0627\u062c\u0639 \u0627\u0644\u0646\u062a\u064a\u062c\u0629 \u062b\u0645 \u0633\u0644\u0645 \u0627\u0644\u062f\u0648\u0631',
  placed: '\u0645\u0648\u0636\u0648\u0639\u0629',
  preparePlayer: '\u0627\u0633\u062a\u0639\u062f \u064a\u0627',
  player: '\u0627\u0644\u0644\u0627\u0639\u0628',
  randomize: '\u0639\u0634\u0648\u0627\u0626\u064a',
  randomizeHint: 'يوزع سفن اللاعب الحالي تلقائيا.',
  remaining: '\u0645\u062a\u0628\u0642\u064a',
  resumeMatch: '\u0645\u062a\u0627\u0628\u0639\u0629 \u0627\u0644\u0645\u0628\u0627\u0631\u0627\u0629',
  resumeMatchHint: 'يفتح المباراة المحفوظة على هذا الجهاز.',
  resumeMatchPrompt: '\u0644\u062f\u064a\u0643 \u0645\u0628\u0627\u0631\u0627\u0629 \u0645\u062d\u0641\u0648\u0638\u0629.',
  rotate: '\u062a\u062f\u0648\u064a\u0631',
  rotateHint: 'يغير اتجاه السفينة المحددة.',
  roundOver: '\u0627\u0646\u062a\u0647\u062a \u0627\u0644\u0645\u062d\u0627\u0648\u0644\u0627\u062a',
  savedDaysAgo: 'يوم مضى',
  savedHoursAgo: 'ساعة مضت',
  savedJustNow: 'محفوظة الآن',
  savedMinutesAgo: 'دقيقة مضت',
  setupFleet: '\u062a\u062c\u0647\u064a\u0632 \u0627\u0644\u0623\u0633\u0637\u0648\u0644',
  selectedShip: '\u0627\u0644\u0633\u0641\u064a\u0646\u0629 \u0627\u0644\u0645\u062d\u062f\u062f\u0629',
  setupShipHint: 'يحدد هذه السفينة لوضعها أو تعديل مكانها.',
  shots: '\u0631\u0645\u064a\u0627\u062a',
  shotFlying: '\u0627\u0644\u0631\u0645\u064a\u0629 \u0641\u064a \u0627\u0644\u0637\u0631\u064a\u0642',
  soundOff: '\u0627\u0644\u0635\u0648\u062a \u0645\u0643\u062a\u0648\u0645',
  soundHint: 'يشغل أو يكتم مؤثرات المباراة.',
  soundOn: '\u0627\u0644\u0635\u0648\u062a \u0645\u0641\u0639\u0644',
  startMatch: '\u0628\u062f\u0621 \u0627\u0644\u0645\u0628\u0627\u0631\u0627\u0629',
  startMatchHint: 'يبدأ تجهيز مباراة محلية على هذا الجهاز.',
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
