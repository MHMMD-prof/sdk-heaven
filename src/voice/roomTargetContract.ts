import type { AvatarFrameProjection } from '../cosmetics/avatarFrameProjection';
import { readProjectedAvatarFrame } from '../cosmetics/avatarFrameProjection';

export type RoomTargetPayoutCurrency = 'coins' | 'diamonds';

export type RoomTargetPublicMemberV1 = {
  avatarLabel: string;
  avatarFrame?: AvatarFrameProjection;
  avatarUrl: string;
  displayName: string;
  eligibleSpendCoins: number;
  estimatedReturn: number;
  finalEligible?: boolean;
  finalReturn?: number;
  role: 'owner' | 'selected';
  supportPoints: number;
  uid: string;
};

export type RoomTargetPublicCycleV1 = {
  conversion: {
    denominator: number;
    numerator: number;
    payoutCurrency: RoomTargetPayoutCurrency;
  };
  cycleId: string;
  endAtMillis: number;
  perRoomReturnCap: number;
  perUserReturnCap: number;
  returnBps: number;
  roomId: string;
  roster: RoomTargetPublicMemberV1[];
  startAtMillis: number;
  state: 'active' | 'unlocked' | 'ready' | 'settling' | 'settled' | 'missed' | 'held';
  supportPoints: number;
  targetSupportPoints: number;
  templateRevision: number;
};

export type RoomTargetRosterPreviewV1 = {
  cycleId: string;
  endAtMillis: number;
  maxSelectedUsers: number;
  ownerUid: string;
  roomId: string;
  roster: Array<Pick<RoomTargetPublicMemberV1, 'avatarFrame' | 'avatarLabel' | 'avatarUrl' | 'displayName' | 'role' | 'uid'>>;
  startAtMillis: number;
};

export function mapRoomTargetPublicCycleV1(
  input: unknown,
  expectedRoomId: string,
): RoomTargetPublicCycleV1 | undefined {
  const value = record(input);
  const conversion = record(value?.conversion);
  const roster = Array.isArray(value?.roster)
    ? value.roster.map(mapPublicMember).filter((entry): entry is RoomTargetPublicMemberV1 => Boolean(entry))
    : [];
  const state = string(value?.state);
  if (
    !value
    || string(value.roomId) !== expectedRoomId
    || !id(value.cycleId)
    || !['active', 'unlocked', 'ready', 'settling', 'settled', 'missed', 'held'].includes(state)
    || !conversion
    || !['coins', 'diamonds'].includes(string(conversion.payoutCurrency))
    || !positive(conversion.numerator)
    || !positive(conversion.denominator)
    || !nonNegative(value.supportPoints)
    || !positive(value.targetSupportPoints)
    || roster.length > 21
  ) return undefined;
  return {
    conversion: {
      denominator: conversion.denominator as number,
      numerator: conversion.numerator as number,
      payoutCurrency: conversion.payoutCurrency as RoomTargetPayoutCurrency,
    },
    cycleId: value.cycleId as string,
    endAtMillis: timestampMillis(value.endAt),
    perRoomReturnCap: safeNumber(value.perRoomReturnCap),
    perUserReturnCap: safeNumber(value.perUserReturnCap),
    returnBps: safeNumber(value.returnBps),
    roomId: expectedRoomId,
    roster,
    startAtMillis: timestampMillis(value.startAt),
    state: state as RoomTargetPublicCycleV1['state'],
    supportPoints: value.supportPoints as number,
    targetSupportPoints: value.targetSupportPoints as number,
    templateRevision: safeNumber(value.templateRevision),
  };
}

export function mapRoomTargetRosterPreviewV1(
  input: unknown,
  expectedRoomId: string,
  expectedOwnerUid: string,
): RoomTargetRosterPreviewV1 | undefined {
  const value = record(input);
  const rules = record(value?.rules);
  const roster = Array.isArray(value?.roster)
    ? value.roster.map(mapRosterIdentity).filter((entry): entry is RoomTargetRosterPreviewV1['roster'][number] => Boolean(entry))
    : [];
  if (
    !value
    || string(value.roomId) !== expectedRoomId
    || string(value.ownerUid) !== expectedOwnerUid
    || !id(value.cycleId)
    || !rules
    || !nonNegative(rules.maxSelectedUsers)
    || roster.length > 21
  ) return undefined;
  return {
    cycleId: value.cycleId as string,
    endAtMillis: timestampMillis(value.endAt),
    maxSelectedUsers: rules.maxSelectedUsers as number,
    ownerUid: expectedOwnerUid,
    roomId: expectedRoomId,
    roster,
    startAtMillis: timestampMillis(value.startAt),
  };
}

function mapPublicMember(input: unknown): RoomTargetPublicMemberV1 | undefined {
  const value = record(input);
  const identity = mapRosterIdentity(value);
  if (!value || !identity || !nonNegative(value.eligibleSpendCoins) || !nonNegative(value.estimatedReturn) || !nonNegative(value.supportPoints)) {
    return undefined;
  }
  return {
    ...identity,
    eligibleSpendCoins: value.eligibleSpendCoins as number,
    estimatedReturn: value.estimatedReturn as number,
    ...(typeof value.finalEligible === 'boolean' ? { finalEligible: value.finalEligible } : {}),
    ...(nonNegative(value.finalReturn) ? { finalReturn: value.finalReturn as number } : {}),
    supportPoints: value.supportPoints as number,
  };
}

function mapRosterIdentity(input: unknown) {
  const value = record(input);
  const role = string(value?.role);
  if (!value || !id(value.uid) || !['owner', 'selected'].includes(role)) return undefined;
  return {
    ...(readProjectedAvatarFrame(value.avatarFrame) ? { avatarFrame: readProjectedAvatarFrame(value.avatarFrame) } : {}),
    avatarLabel: string(value.avatarLabel).slice(0, 3),
    avatarUrl: string(value.avatarUrl).slice(0, 2048),
    displayName: string(value.displayName).slice(0, 60) || 'User',
    role: role as 'owner' | 'selected',
    uid: value.uid as string,
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function string(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function id(value: unknown) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function nonNegative(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function positive(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function safeNumber(value: unknown) {
  return nonNegative(value) ? value : 0;
}

function timestampMillis(value: unknown) {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') {
    const result = value.toMillis();
    return Number.isSafeInteger(result) ? result : 0;
  }
  return 0;
}
