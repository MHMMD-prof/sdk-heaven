import { colors } from '../theme';
import { CarromCoinKind, CarromGameState, CarromPlayer } from '../types/carrom';

export type CarromSparkleTone = 'queen' | 'coin' | 'striker';
export type CarromEventTone = 'neutral' | 'success' | 'foul' | 'queen';
export type ShotHistoryTone = CarromEventTone | 'win';

export type ShotHistoryItem = {
  id: string;
  message: string;
  player: CarromPlayer;
  tone: ShotHistoryTone;
};

export function createShotHistoryItem(
  game: CarromGameState,
  shotPlayer: CarromPlayer,
): ShotHistoryItem {
  const tone = getHistoryTone(game);
  const pocketSummary = getPocketSummary(game, shotPlayer);
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

export function getPocketSummary(game: CarromGameState, shotPlayer: CarromPlayer) {
  const pocketed = game.pocketedThisTurn;

  if (pocketed.length === 0) {
    return 'لا توجد قطع داخلة';
  }

  const ownKind = game.playerCoins[shotPlayer];
  const ownCount = pocketed.filter((disc) => disc.kind === ownKind).length;
  const opponentCount = pocketed.filter(
    (disc) => disc.owner && disc.kind !== ownKind,
  ).length;
  const queenCount = pocketed.filter((disc) => disc.kind === 'queen').length;
  const strikerCount = pocketed.filter((disc) => disc.kind === 'striker').length;
  const parts = [
    ownCount > 0 ? `${ownCount} من قطع اللاعب` : undefined,
    opponentCount > 0 ? `${opponentCount} من قطع الخصم` : undefined,
    queenCount > 0 ? 'الملكة' : undefined,
    strikerCount > 0 ? 'حجر الضربة' : undefined,
  ].filter(Boolean);

  return parts.join('، ');
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
    return ['rgba(126,53,174,0.94)', 'rgba(184,41,75,0.92)'] as const;
  }

  if (tone === 'success') {
    return ['rgba(43,203,136,0.92)', 'rgba(12,80,68,0.92)'] as const;
  }

  return ['rgba(8,5,15,0.92)', 'rgba(58,29,103,0.88)'] as const;
}

export function getSparkleColor(tone: CarromSparkleTone) {
  if (tone === 'queen') {
    return '#F6D991';
  }

  if (tone === 'striker') {
    return '#FF8E9F';
  }

  return '#63F4C4';
}

export function getPowerTone(powerPercent: number) {
  if (powerPercent > 0.72) {
    return '#FF7B6E';
  }

  if (powerPercent > 0.42) {
    return colors.goldSoft;
  }

  return '#63F4C4';
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
