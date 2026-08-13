export const ROOM_REACTION_TOPIC = 'sdk-heaven.room-reaction.v1';
export const ROOM_REACTION_ENVELOPE_VERSION = 1 as const;
export const MAX_AMBIENT_REACTION_GROUPS = 4;
export const MAX_AMBIENT_REACTION_COUNT = 99;

export type RoomReactionEnvelope = {
  assetId: string;
  assetVersionId: string;
  checksum: string;
  count: number;
  createdAtMs: number;
  eventId: string;
  expiresAtMs: number;
  format: 'png' | 'lottie-json' | 'legacy-webp';
  roomId: string;
  senderUid: string;
  type: 'room-reaction';
  version: typeof ROOM_REACTION_ENVELOPE_VERSION;
};

export type AmbientReactionGroup = RoomReactionEnvelope & {
  receivedAtMs: number;
};

const ASSET_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,79}$/;
const VERSION_ID_PATTERN = /^v[1-9][0-9]{0,8}-[a-f0-9]{12}$/;
const FIRESTORE_ID_PATTERN = /^[^/]{1,128}$/;
const EVENT_ID_PATTERN = /^rr_[a-f0-9]{24}$/;
const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/i;

export function decodeRoomReactionEnvelope(
  payload: Uint8Array,
  expectedRoomId: string,
  nowMs = Date.now(),
): RoomReactionEnvelope | undefined {
  try {
    if (!(payload instanceof Uint8Array) || payload.byteLength < 2 || payload.byteLength > 2_048) {
      return undefined;
    }
    const value = JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>;
    const expectedKeys = [
      'assetId',
      'assetVersionId',
      'checksum',
      'count',
      'createdAtMs',
      'eventId',
      'expiresAtMs',
      'format',
      'roomId',
      'senderUid',
      'type',
      'version',
    ];
    if (
      !value
      || typeof value !== 'object'
      || Array.isArray(value)
      || Object.keys(value).length !== expectedKeys.length
      || Object.keys(value).some((key) => !expectedKeys.includes(key))
      || value.type !== 'room-reaction'
      || value.version !== ROOM_REACTION_ENVELOPE_VERSION
      || value.roomId !== expectedRoomId
      || !FIRESTORE_ID_PATTERN.test(String(value.roomId || ''))
      || !FIRESTORE_ID_PATTERN.test(String(value.senderUid || ''))
      || !ASSET_ID_PATTERN.test(String(value.assetId || ''))
      || !VERSION_ID_PATTERN.test(String(value.assetVersionId || ''))
      || !EVENT_ID_PATTERN.test(String(value.eventId || ''))
      || !CHECKSUM_PATTERN.test(String(value.checksum || ''))
      || !['png', 'lottie-json', 'legacy-webp'].includes(String(value.format || ''))
      || !Number.isSafeInteger(value.count)
      || Number(value.count) < 1
      || Number(value.count) > MAX_AMBIENT_REACTION_COUNT
      || !Number.isSafeInteger(value.createdAtMs)
      || !Number.isSafeInteger(value.expiresAtMs)
      || Number(value.createdAtMs) > nowMs + 5_000
      || Number(value.createdAtMs) < nowMs - 15_000
      || Number(value.expiresAtMs) <= nowMs
      || Number(value.expiresAtMs) - Number(value.createdAtMs) > 5_000
    ) {
      return undefined;
    }
    return value as RoomReactionEnvelope;
  } catch {
    return undefined;
  }
}

export function aggregateAmbientReaction(
  groups: AmbientReactionGroup[],
  envelope: RoomReactionEnvelope,
  nowMs = Date.now(),
): AmbientReactionGroup[] {
  const active = groups.filter((group) => group.expiresAtMs > nowMs && group.roomId === envelope.roomId);
  const matchIndex = active.findIndex((group) => (
    group.assetId === envelope.assetId
    && group.assetVersionId === envelope.assetVersionId
    && nowMs - group.receivedAtMs <= 800
  ));
  if (matchIndex >= 0) {
    const match = active[matchIndex];
    active[matchIndex] = {
      ...envelope,
      count: Math.min(MAX_AMBIENT_REACTION_COUNT, match.count + envelope.count),
      receivedAtMs: nowMs,
    };
    return active;
  }
  return [
    ...active,
    { ...envelope, receivedAtMs: nowMs },
  ].slice(-MAX_AMBIENT_REACTION_GROUPS);
}
