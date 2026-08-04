import { RoomMusicNowPlaying } from './requestRoomMusicCommand';

export const ROOM_MUSIC_SYNC_TOLERANCE_MS = 1_200;

export function estimateRoomMusicServerNowMs(
  clientNowMs: number,
  serverClockOffsetMs: number,
) {
  return clientNowMs - serverClockOffsetMs;
}

export function resolveRoomMusicTargetPositionMs(
  nowPlaying: RoomMusicNowPlaying,
  serverNowMs: number,
) {
  const basePositionMs = clampPosition(nowPlaying.positionMs, nowPlaying.durationMs);
  if (nowPlaying.playbackState !== 'playing' || !nowPlaying.updatedAtMs) {
    return basePositionMs;
  }
  const elapsedMs = Math.max(0, serverNowMs - nowPlaying.updatedAtMs);
  return clampPosition(basePositionMs + elapsedMs, nowPlaying.durationMs);
}

export function shouldSeekRoomMusic(
  currentPositionMs: number,
  targetPositionMs: number,
  toleranceMs = ROOM_MUSIC_SYNC_TOLERANCE_MS,
) {
  return Math.abs(currentPositionMs - targetPositionMs) > toleranceMs;
}

function clampPosition(positionMs: number, durationMs: number) {
  const safeDuration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  const safePosition = Number.isFinite(positionMs) ? Math.max(0, positionMs) : 0;
  return safeDuration > 0 ? Math.min(safePosition, safeDuration) : safePosition;
}
