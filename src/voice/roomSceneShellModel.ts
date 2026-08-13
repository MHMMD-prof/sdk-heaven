export type RoomActivityPage = 'supporters' | 'rocket' | 'target';
export type RoomLiveActivityKind = 'pk' | 'game';

export function formatRoomDisplayId(roomId: string) {
  const normalized = roomId.trim();
  if (normalized.length <= 14) return normalized;
  return `${normalized.slice(0, 6)}…${normalized.slice(-4)}`;
}

export function resolveRoomActivityPages({
  rocketEnabled,
  supportersEnabled,
  targetEnabled,
}: {
  rocketEnabled: boolean;
  supportersEnabled: boolean;
  targetEnabled: boolean;
}): RoomActivityPage[] {
  return [
    ...(supportersEnabled ? ['supporters' as const] : []),
    ...(rocketEnabled ? ['rocket' as const] : []),
    ...(targetEnabled ? ['target' as const] : []),
  ];
}

export function clampRoomActivityPageIndex(index: number, pageCount: number) {
  if (!Number.isFinite(index) || pageCount <= 0) return 0;
  return Math.min(pageCount - 1, Math.max(0, Math.floor(index)));
}

export function nextRoomActivityPageIndex(index: number, pageCount: number) {
  if (pageCount <= 1) return 0;
  return (clampRoomActivityPageIndex(index, pageCount) + 1) % pageCount;
}

export function resolveRoomLiveActivity({
  gameActive,
  pkActive,
}: {
  gameActive: boolean;
  pkActive: boolean;
}): RoomLiveActivityKind | undefined {
  if (pkActive) return 'pk';
  if (gameActive) return 'game';
  return undefined;
}

export function shouldRotateRoomActivity({
  appActive,
  interacting,
  liveActivity,
  pageCount,
  reducedMotion,
  screenReaderEnabled,
  sheetOpen,
}: {
  appActive: boolean;
  interacting: boolean;
  liveActivity: boolean;
  pageCount: number;
  reducedMotion: boolean;
  screenReaderEnabled: boolean;
  sheetOpen: boolean;
}) {
  return pageCount > 1
    && appActive
    && !interacting
    && !liveActivity
    && !reducedMotion
    && !screenReaderEnabled
    && !sheetOpen;
}
