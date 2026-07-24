import { CarromCoinKind, CarromDisc, CarromGameState, CarromPlayer } from '../types/carrom';

export type CarromSparkleTone = 'queen' | 'coin' | 'striker';
export type CarromEventTone = 'neutral' | 'success' | 'foul' | 'queen';
export type ShotHistoryTone = CarromEventTone | 'win';
export type CarromRemainingCounts = Record<CarromPlayer, number>;
export type CarromPocketSparklePayload = {
  id: string;
  tone: CarromSparkleTone;
  x: number;
  y: number;
};

export type ShotHistoryItem = {
  id: string;
  message: string;
  player: CarromPlayer;
  tone: ShotHistoryTone;
};

const MAX_SHOT_HISTORY_ITEMS = 8;

export function createShotHistoryItem(
  game: CarromGameState,
  shotPlayer: CarromPlayer,
  pocketedOverride?: CarromDisc[],
): ShotHistoryItem {
  const tone = getHistoryTone(game);
  const pocketSummary = getPocketSummary(game, shotPlayer, pocketedOverride);
  const message =
    game.status === 'gameOver' && game.winner
      ? `اللاعب ${game.winner} فاز - ضربة اللاعب ${shotPlayer} - ${pocketSummary}`
      : `ضربة اللاعب ${shotPlayer}: ${game.message} - ${pocketSummary} - الدور للاعب ${game.currentPlayer}`;

  return {
    id: `${Date.now()}-${shotPlayer}-${game.currentPlayer}-${game.message}`,
    message,
    player: shotPlayer,
    tone,
  };
}

export function prependShotHistoryItem(
  current: ShotHistoryItem[],
  nextItem: ShotHistoryItem,
  maxItems = MAX_SHOT_HISTORY_ITEMS,
) {
  const nextLength = Math.min(maxItems, current.length + 1);
  const nextHistory: ShotHistoryItem[] = new Array(nextLength);
  nextHistory[0] = nextItem;

  for (let index = 1; index < nextLength; index += 1) {
    nextHistory[index] = current[index - 1];
  }

  return nextHistory;
}

export function createPocketSparkles(discs: CarromDisc[]): CarromPocketSparklePayload[] {
  if (discs.length === 0) {
    return [];
  }

  const sparkles: CarromPocketSparklePayload[] = new Array(discs.length);

  for (let index = 0; index < discs.length; index += 1) {
    const disc = discs[index]!;
    sparkles[index] = {
      id: disc.id,
      tone: disc.kind === 'queen' ? 'queen' : disc.kind === 'striker' ? 'striker' : 'coin',
      x: disc.x,
      y: disc.y,
    };
  }

  return sparkles;
}

export function getPocketSummary(
  game: CarromGameState,
  shotPlayer: CarromPlayer,
  pocketedOverride?: CarromDisc[],
) {
  const pocketed = pocketedOverride ?? game.pocketedThisTurn;

  if (pocketed.length === 0) {
    return 'لا توجد قطع داخلة';
  }

  const ownKind = game.playerCoins[shotPlayer];
  let ownCount = 0;
  let opponentCount = 0;
  let queenCount = 0;
  let strikerCount = 0;

  for (const disc of pocketed) {
    if (disc.kind === ownKind) {
      ownCount += 1;
    } else if (disc.owner) {
      opponentCount += 1;
    } else if (disc.kind === 'queen') {
      queenCount += 1;
    } else if (disc.kind === 'striker') {
      strikerCount += 1;
    }
  }
  const parts: string[] = [];
  if (ownCount > 0) {
    parts.push(`${ownCount} من قطع اللاعب`);
  }

  if (opponentCount > 0) {
    parts.push(`${opponentCount} من قطع الخصم`);
  }

  if (queenCount > 0) {
    parts.push('الملكة');
  }

  if (strikerCount > 0) {
    parts.push('حجر الضربة');
  }

  return parts.join('، ');
}

export function getRemainingCoinCounts(game: CarromGameState): CarromRemainingCounts {
  const remaining: CarromRemainingCounts = {
    1: 0,
    2: 0,
  };

  for (const disc of game.discs) {
    if (disc.pocketed) {
      continue;
    }

    if (disc.kind === game.playerCoins[1]) {
      remaining[1] += 1;
    } else if (disc.kind === game.playerCoins[2]) {
      remaining[2] += 1;
    }
  }

  return remaining;
}

export function getHistoryTone(game: CarromGameState): ShotHistoryTone {
  if (game.status === 'gameOver') {
    return 'win';
  }

  const eventTone = getEventTone(game.message, game.status);

  return eventTone === 'success' ? 'success' : eventTone;
}

export function getHistoryToneStyle(tone: ShotHistoryTone) {
  if (tone === 'foul') {
    return 'historyDotFoul' as const;
  }

  if (tone === 'queen') {
    return 'historyDotQueen' as const;
  }

  if (tone === 'success' || tone === 'win') {
    return 'historyDotSuccess' as const;
  }

  return 'historyDotNeutral' as const;
}

export function getCoinLabel(kind: CarromCoinKind) {
  return kind === 'white' ? 'الأبيض' : 'الأسود';
}

export function getQueenLabel(game: CarromGameState) {
  if (game.queen.coveredBy) {
    return `الملكة مغطاة للاعب ${game.queen.coveredBy}`;
  }

  if (game.queen.pendingBy) {
    return `الملكة تنتظر تغطية اللاعب ${game.queen.pendingBy}`;
  }

  return 'أدخل كل قطعك وغطِّ الملكة';
}

export function getEndGameQueenLabel(game: CarromGameState) {
  if (game.queen.coveredBy) {
    return `الملكة مغطاة للاعب ${game.queen.coveredBy}`;
  }

  return 'انتهت الجولة';
}

export function shouldShowEventBanner(game: CarromGameState) {
  if (game.status === 'moving') {
    return false;
  }

  return ![
    'حرّك حجر الضربة على الخط',
    'اسحب للخلف ثم اترك للتصويب',
  ].includes(game.message);
}

export function getEventTone(
  message: string,
  status: CarromGameState['status'],
): CarromEventTone {
  if (status === 'gameOver') {
    return 'success';
  }

  if (message.includes('خطأ')) {
    return 'foul';
  }

  if (message.includes('الملكة')) {
    return 'queen';
  }

  if (message.includes('ناجح') || message.includes('تغطية') || message.includes('مجدداً')) {
    return 'success';
  }

  return 'neutral';
}

export function getEventGradient(tone: CarromEventTone) {
  if (tone === 'foul') {
    return ['rgba(184,41,75,0.95)', 'rgba(58,15,30,0.92)'] as const;
  }

  if (tone === 'queen') {
    return ['rgba(157,29,36,0.96)', 'rgba(72,10,14,0.94)'] as const;
  }

  if (tone === 'success') {
    return ['rgba(176,123,38,0.95)', 'rgba(75,31,9,0.94)'] as const;
  }

  return ['rgba(23,10,8,0.94)', 'rgba(73,11,15,0.92)'] as const;
}

export function getSparkleColor(tone: CarromSparkleTone) {
  if (tone === 'queen') {
    return '#F6D991';
  }

  if (tone === 'striker') {
    return '#E08077';
  }

  return '#F0C45C';
}

export function getStatusText(game: CarromGameState) {
  if (game.status === 'gameOver' && game.winner) {
    return `فاز اللاعب ${game.winner}`;
  }

  if (game.status === 'placing') {
    return 'حرّك حجر الضربة';
  }

  if (game.status === 'moving') {
    return 'الضربة تتحرك';
  }

  return 'اسحب للخلف للتصويب';
}

export function getStatusSubtitle(game: CarromGameState) {
  if (game.status === 'placing') {
    return 'حرّك المؤشر يميناً ويساراً لضبط موضع الحجر، ثم اسحب على اللوح للتصويب.';
  }

  if (game.status === 'aiming') {
    return 'اسحب على اللوح للخلف ثم اترك. لا توجد مراهنة أو أموال حقيقية.';
  }

  if (game.status === 'gameOver') {
    return 'اضغط إعادة للعب جولة محلية جديدة.';
  }

  return 'انتظر حتى تتوقف كل القطع.';
}
