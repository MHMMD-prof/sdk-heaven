import type { RoomSupportLeaderboardEntryV1 } from './roomSupportLeaderboardContract';
import type { RoomRocketData } from './useRoomRocketData';
import type { RoomTargetData } from './useRoomTargetData';

export type RoomRocketRailSummary = {
  progress: number;
  progressPercent: number;
  supporters: RoomSupportLeaderboardEntryV1[];
  supportPoints: number;
};

export type RoomTargetRailSummary = {
  currency: 'coins' | 'diamonds';
  progress: number;
  progressPercent: number;
  projectedReturn: number;
  projectedReturnLabel: string;
};

export function resolveRoomRocketRailSummary(data: RoomRocketData): RoomRocketRailSummary {
  const supportPoints = data.cycle?.supportPoints || 0;
  const target = data.cycle?.targetSupportPoints || data.template?.targetSupportPoints || 1;
  const progress = boundedProgress(supportPoints, target);
  return {
    progress,
    progressPercent: Math.round(progress * 100),
    supporters: (data.week?.entries || []).slice(0, 3),
    supportPoints,
  };
}

export function resolveRoomTargetRailSummary(data: RoomTargetData): RoomTargetRailSummary {
  const current = data.cycle?.supportPoints || 0;
  const target = data.cycle?.targetSupportPoints || 1;
  const progress = boundedProgress(current, target);
  const projectedReturn = (data.cycle?.roster || []).reduce(
    (total, member) => total + (member.finalReturn ?? member.estimatedReturn),
    0,
  );
  const currency = data.cycle?.conversion.payoutCurrency || 'coins';
  return {
    currency,
    progress,
    progressPercent: Math.round(progress * 100),
    projectedReturn,
    projectedReturnLabel: `${currency === 'diamonds' ? '◆' : '●'} ${formatCompactIncentiveAmount(projectedReturn)}`,
  };
}

export function formatCompactIncentiveAmount(value: number) {
  const safe = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  if (safe >= 1_000_000) return `${trimDecimal(safe / 1_000_000)}M`;
  if (safe >= 1_000) return `${trimDecimal(safe / 1_000)}K`;
  return String(safe);
}

function boundedProgress(current: number, target: number) {
  if (!Number.isFinite(current) || !Number.isFinite(target) || target <= 0) return 0;
  return Math.min(1, Math.max(0, current / target));
}

function trimDecimal(value: number) {
  return value >= 100 || Number.isInteger(value) ? String(Math.floor(value)) : value.toFixed(1).replace(/\.0$/, '');
}
