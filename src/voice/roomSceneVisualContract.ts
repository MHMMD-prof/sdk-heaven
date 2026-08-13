import type { RoomThemeId, RoomThemeViewportProfile } from './roomThemeContract';

export type RoomSceneViewportClass = RoomThemeViewportProfile;

export type NormalizedRoomSceneRect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type RoomSceneRegions = Readonly<{
  header: NormalizedRoomSceneRect;
  announcement: NormalizedRoomSceneRect;
  stage: NormalizedRoomSceneRect;
  activityDock: NormalizedRoomSceneRect;
  dock: NormalizedRoomSceneRect;
}>;

export type RoomThemeCompositionKind = 'horseshoe-majlis' | 'curved-theater' | 'modular-grid';

export type RoomThemeVisualTarget = Readonly<{
  composition: RoomThemeCompositionKind;
  currentCapture: string;
  referenceCapture: string;
  focalSeatNumber: 1;
  seatTopology: Readonly<Record<5 | 10 | 15 | 20, readonly number[]>>;
}>;

/**
 * Regions are measured against the usable room viewport after native
 * safe-area insets. The activity dock is a sibling below the stage so room
 * controls and messages can never occupy the themed seat canvas.
 */
export const ROOM_SCENE_REGIONS: Readonly<Record<RoomSceneViewportClass, RoomSceneRegions>> = Object.freeze({
  compact: Object.freeze({
    header: rect(0.03, 0.02, 0.94, 0.09),
    announcement: rect(0.03, 0.12, 0.94, 0.045),
    stage: rect(0.03, 0.175, 0.94, 0.515),
    activityDock: rect(0.03, 0.70, 0.94, 0.17),
    dock: rect(0.03, 0.88, 0.94, 0.10),
  }),
  standard: Object.freeze({
    header: rect(0.03, 0.018, 0.94, 0.085),
    announcement: rect(0.03, 0.112, 0.94, 0.043),
    stage: rect(0.03, 0.165, 0.94, 0.52),
    activityDock: rect(0.03, 0.695, 0.94, 0.18),
    dock: rect(0.03, 0.885, 0.94, 0.095),
  }),
  tall: Object.freeze({
    header: rect(0.03, 0.016, 0.94, 0.08),
    announcement: rect(0.03, 0.105, 0.94, 0.04),
    stage: rect(0.03, 0.155, 0.94, 0.565),
    activityDock: rect(0.03, 0.73, 0.94, 0.15),
    dock: rect(0.03, 0.89, 0.94, 0.09),
  }),
});

const SHARED_SEAT_TOPOLOGY = Object.freeze({
  5: Object.freeze([1, 4]),
  10: Object.freeze([1, 4, 5]),
  15: Object.freeze([1, 4, 5, 5]),
  20: Object.freeze([1, 4, 5, 5, 5]),
});

/**
 * The groups describe visual tiers from the focal seat outward. They never
 * reserve behavior or grant authority: seat identity remains server-owned.
 */
export const ROOM_THEME_VISUAL_TARGETS: Readonly<Record<RoomThemeId, RoomThemeVisualTarget>> = Object.freeze({
  'majlis-default': Object.freeze({
    composition: 'horseshoe-majlis',
    currentCapture: 'codex-clipboard-bc622215-f540-41a0-8f1b-1ec0d5fa9106.png',
    referenceCapture: 'codex-clipboard-123785ea-6d0f-4e51-aa4a-ed98ff9b4934.png',
    focalSeatNumber: 1,
    seatTopology: SHARED_SEAT_TOPOLOGY,
  }),
  'royal-theater': Object.freeze({
    composition: 'curved-theater',
    currentCapture: 'codex-clipboard-425c75b5-9fc8-4f8d-8c6e-22117db03381.png',
    referenceCapture: 'call_7JXnuSQbZMwWYSnpfgMzeA7K.png',
    focalSeatNumber: 1,
    seatTopology: SHARED_SEAT_TOPOLOGY,
  }),
  'ruby-constellation': Object.freeze({
    composition: 'modular-grid',
    currentCapture: 'codex-clipboard-0a6c9f47-777d-4f94-a0dc-3f84bfadc9d9.png',
    referenceCapture: 'codex-clipboard-a64a904e-cdb1-41a1-a0bf-2a7e5e8d8875.png',
    focalSeatNumber: 1,
    seatTopology: SHARED_SEAT_TOPOLOGY,
  }),
});

export const ROOM_SCENE_VISUAL_INVARIANTS = Object.freeze({
  occupiedAvatarBorderSource: 'user-cosmetic' as const,
  roomThemeMayStyleOccupiedAvatarBorder: false,
  supportHubPageOrder: Object.freeze(['supporters', 'rocket', 'target'] as const),
  seatAccessibilityOrder: 'seat-number' as const,
  themeMayChangeSeatBehavior: false,
});

export function classifyRoomSceneViewport(width: number, height: number): RoomSceneViewportClass {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 'standard';
  }
  const aspect = height / width;
  if (aspect < 1.9) return 'compact';
  if (aspect < 2.12) return 'standard';
  return 'tall';
}

export function normalizedRectContains(outer: NormalizedRoomSceneRect, inner: NormalizedRoomSceneRect) {
  return inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

export function normalizedRectsOverlap(left: NormalizedRoomSceneRect, right: NormalizedRoomSceneRect) {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

export function validateRoomSceneRegions(regions: RoomSceneRegions): string[] {
  const errors: string[] = [];
  for (const [name, region] of Object.entries(regions)) {
    if (!isNormalizedRect(region)) errors.push(`${name} is outside the normalized viewport.`);
  }
  const ordered = [regions.header, regions.announcement, regions.stage, regions.activityDock, regions.dock];
  for (let index = 0; index < ordered.length - 1; index += 1) {
    if (normalizedRectsOverlap(ordered[index], ordered[index + 1])) {
      errors.push(`Primary room regions ${index} and ${index + 1} overlap.`);
    }
  }
  return errors;
}

function rect(x: number, y: number, width: number, height: number): NormalizedRoomSceneRect {
  return Object.freeze({ x, y, width, height });
}

function isNormalizedRect(value: NormalizedRoomSceneRect) {
  return value.x >= 0
    && value.y >= 0
    && value.width > 0
    && value.height > 0
    && value.x + value.width <= 1
    && value.y + value.height <= 1;
}
