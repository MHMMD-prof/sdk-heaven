import type { AdminRoomThemeManifest, AdminRoomThemeSeat } from './adminDashboardApi';

export const ROOM_THEME_EDITOR_PROFILES = ['compact', 'standard', 'tall'] as const;
export const ROOM_THEME_EDITOR_COUNTS = [5, 10, 15, 20] as const;
export const ROOM_THEME_INCENTIVE_PREVIEWS = ['room', 'rocket-week', 'rocket-today', 'target'] as const;
export const BUILT_IN_ROOM_THEME_IDS = ['majlis-default', 'royal-theater', 'ruby-constellation'] as const;

export type RoomThemeEditorProfile = (typeof ROOM_THEME_EDITOR_PROFILES)[number];
export type RoomThemeEditorSeatCount = (typeof ROOM_THEME_EDITOR_COUNTS)[number];
export type RoomThemeIncentivePreview = (typeof ROOM_THEME_INCENTIVE_PREVIEWS)[number];

export function roomThemeIncentiveCoverageMatrix() {
  return BUILT_IN_ROOM_THEME_IDS.flatMap((themeId) => (
    ROOM_THEME_EDITOR_COUNTS.flatMap((seatCount) => (
      ROOM_THEME_INCENTIVE_PREVIEWS.map((preview) => ({ preview, seatCount, themeId }))
    ))
  ));
}

export const ROOM_THEME_EDITOR_VIEWPORTS: Record<RoomThemeEditorProfile, {
  height: number;
  label: string;
  width: number;
}> = {
  compact: { height: 640, label: 'هاتف مدمج', width: 360 },
  standard: { height: 780, label: 'هاتف قياسي', width: 390 },
  tall: { height: 844, label: 'هاتف طويل', width: 390 },
};

export const ROOM_THEME_EDITOR_REGIONS = {
  compact: {
    activityDock: { height: 0.17, width: 0.94, x: 0.03, y: 0.7 },
    announcement: { height: 0.045, width: 0.94, x: 0.03, y: 0.12 },
    dock: { height: 0.1, width: 0.94, x: 0.03, y: 0.88 },
    header: { height: 0.09, width: 0.94, x: 0.03, y: 0.02 },
    stage: { height: 0.515, width: 0.94, x: 0.03, y: 0.175 },
  },
  standard: {
    activityDock: { height: 0.18, width: 0.94, x: 0.03, y: 0.695 },
    announcement: { height: 0.043, width: 0.94, x: 0.03, y: 0.112 },
    dock: { height: 0.095, width: 0.94, x: 0.03, y: 0.885 },
    header: { height: 0.085, width: 0.94, x: 0.03, y: 0.018 },
    stage: { height: 0.52, width: 0.94, x: 0.03, y: 0.165 },
  },
  tall: {
    activityDock: { height: 0.15, width: 0.94, x: 0.03, y: 0.73 },
    announcement: { height: 0.04, width: 0.94, x: 0.03, y: 0.105 },
    dock: { height: 0.09, width: 0.94, x: 0.03, y: 0.89 },
    header: { height: 0.08, width: 0.94, x: 0.03, y: 0.016 },
    stage: { height: 0.565, width: 0.94, x: 0.03, y: 0.155 },
  },
} as const;

export function upgradeRoomThemeManifestToV3(manifest: AdminRoomThemeManifest): AdminRoomThemeManifest {
  if (manifest.manifestVersion === 3 && manifest.scene) return manifest;
  const layouts = cloneLayouts(manifest.layouts);
  return {
    ...manifest,
    manifestVersion: 3,
    motion: manifest.motion || { ambient: [], background: null },
    scene: {
      background: { fit: 'cover', focalX: 0.5, focalY: 0.5 },
      stage: { fit: 'contain', focalX: 0.5, focalY: 0.5 },
      profiles: {
        compact: { layouts: cloneLayouts(layouts) },
        standard: { layouts: cloneLayouts(layouts) },
        tall: { layouts: cloneLayouts(layouts) },
      },
    },
  };
}

export function roomThemePreviewKey(profile: RoomThemeEditorProfile, count: RoomThemeEditorSeatCount) {
  return `${profile}:${count}`;
}

export function requiredRoomThemePreviewKeys() {
  return ROOM_THEME_EDITOR_PROFILES.flatMap((profile) => (
    ROOM_THEME_EDITOR_COUNTS.map((count) => roomThemePreviewKey(profile, count))
  ));
}

export function validateRoomThemeEditorManifest(manifest: AdminRoomThemeManifest): string[] {
  const issues: string[] = [];
  if (manifest.manifestVersion !== 3 || !manifest.scene) {
    return ['يجب ترقية السمة إلى Manifest V3 قبل النشر.'];
  }
  for (const profile of ROOM_THEME_EDITOR_PROFILES) {
    for (const count of ROOM_THEME_EDITOR_COUNTS) {
      const seats = manifest.scene.profiles[profile].layouts[String(count) as '5' | '10' | '15' | '20'];
      issues.push(...validateLayout(seats, count).map((issue) => (
        `${ROOM_THEME_EDITOR_VIEWPORTS[profile].label} · ${count}: ${issue}`
      )));
    }
  }
  return issues;
}

function validateLayout(seats: AdminRoomThemeSeat[], count: number): string[] {
  if (!Array.isArray(seats) || seats.length !== count) return ['عدد المقاعد غير مكتمل.'];
  const seen = new Set<number>();
  for (const seat of seats) {
    if (!Number.isInteger(seat.seatNumber) || seat.seatNumber < 1 || seat.seatNumber > count || seen.has(seat.seatNumber)) {
      return ['أرقام المقاعد مكررة أو غير صالحة.'];
    }
    if (seat.x < 0.04 || seat.x > 0.96 || seat.y < 0.04 || seat.y > 0.96) {
      return [`المقعد ${seat.seatNumber} خارج حدود المنصة.`];
    }
    if (seat.scale < 0.7 || seat.scale > 1.3 || !Number.isInteger(seat.z) || seat.z < 0 || seat.z > 100) {
      return [`حجم أو طبقة المقعد ${seat.seatNumber} غير صالحة.`];
    }
    seen.add(seat.seatNumber);
  }
  for (let left = 0; left < seats.length; left += 1) {
    for (let right = left + 1; right < seats.length; right += 1) {
      const first = seats[left]!;
      const second = seats[right]!;
      if (Math.hypot(first.x - second.x, first.y - second.y) < 0.072 * (first.scale + second.scale)) {
        return [`المقعدان ${first.seatNumber} و${second.seatNumber} متداخلان.`];
      }
    }
  }
  return [];
}

function cloneLayouts(layouts: AdminRoomThemeManifest['layouts']): AdminRoomThemeManifest['layouts'] {
  return {
    '5': layouts['5'].map((seat) => ({ ...seat })),
    '10': layouts['10'].map((seat) => ({ ...seat })),
    '15': layouts['15'].map((seat) => ({ ...seat })),
    '20': layouts['20'].map((seat) => ({ ...seat })),
  };
}
