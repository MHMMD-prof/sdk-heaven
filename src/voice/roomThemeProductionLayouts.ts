import type {
  RoomThemeId,
  RoomThemeManifestV1,
  RoomThemeSeatPositionV1,
  RoomThemeViewportProfile,
} from './roomThemeContract';

type BuiltInThemeId = 'majlis-default' | 'royal-theater' | 'ruby-constellation';
type SeatCountKey = keyof RoomThemeManifestV1['layouts'];
const SUPPORTED_COUNTS = [5, 10, 15, 20] as const;
type SupportedSeatCount = (typeof SUPPORTED_COUNTS)[number];

const PROFILE_SCALE: Record<RoomThemeViewportProfile, readonly number[]> = {
  compact: [0.84, 0.72, 0.7, 0.7, 0.7],
  standard: [0.98, 0.86, 0.82, 0.8, 0.78],
  tall: [1.08, 0.94, 0.9, 0.88, 0.86],
};

const MAJLIS_LAYOUT_POINTS: Record<SupportedSeatCount, readonly (readonly [number, number])[]> = {
  5: [
    [0.5, 0.35],
    [0.2, 0.52], [0.3, 0.78], [0.7, 0.78], [0.8, 0.52],
  ],
  10: [
    [0.5, 0.34],
    [0.25, 0.42], [0.12, 0.58], [0.1, 0.74], [0.28, 0.86],
    [0.5, 0.9], [0.72, 0.86], [0.9, 0.74], [0.88, 0.58], [0.75, 0.42],
  ],
  15: [
    [0.5, 0.1],
    [0.18, 0.25], [0.08, 0.44], [0.1, 0.68], [0.25, 0.86],
    [0.5, 0.92], [0.75, 0.86], [0.9, 0.68], [0.92, 0.44],
    [0.34, 0.31], [0.24, 0.52], [0.35, 0.72],
    [0.65, 0.72], [0.76, 0.52], [0.66, 0.31],
  ],
  20: [
    [0.5, 0.09],
    [0.2, 0.22], [0.08, 0.38], [0.08, 0.58], [0.12, 0.76],
    [0.28, 0.88], [0.5, 0.93], [0.72, 0.88], [0.88, 0.76],
    [0.92, 0.58], [0.92, 0.38], [0.8, 0.22],
    [0.35, 0.29], [0.24, 0.45], [0.23, 0.64], [0.36, 0.76],
    [0.64, 0.76], [0.77, 0.64], [0.76, 0.45], [0.65, 0.29],
  ],
};

const MAJLIS_SCALE: Record<RoomThemeViewportProfile, Record<SupportedSeatCount, number>> = {
  compact: { 5: 0.82, 10: 0.68, 15: 0.58, 20: 0.5 },
  standard: { 5: 0.94, 10: 0.8, 15: 0.7, 20: 0.62 },
  tall: { 5: 1.02, 10: 0.86, 15: 0.76, 20: 0.68 },
};

const THEME_Y: Record<BuiltInThemeId, Record<SupportedSeatCount, readonly number[]>> = {
  'majlis-default': {
    5: [0.2, 0.62],
    10: [0.15, 0.43, 0.76],
    15: [0.12, 0.34, 0.57, 0.81],
    20: [0.11, 0.3, 0.49, 0.68, 0.87],
  },
  'royal-theater': {
    5: [0.21, 0.58],
    10: [0.16, 0.4, 0.72],
    15: [0.12, 0.32, 0.54, 0.78],
    20: [0.11, 0.3, 0.49, 0.68, 0.87],
  },
  'ruby-constellation': {
    5: [0.18, 0.57],
    10: [0.14, 0.4, 0.72],
    15: [0.11, 0.31, 0.53, 0.78],
    20: [0.1, 0.29, 0.48, 0.67, 0.86],
  },
};

const THEME_X: Record<BuiltInThemeId, readonly (readonly number[])[]> = {
  'majlis-default': [
    [0.5],
    [0.2, 0.4, 0.6, 0.8],
    [0.12, 0.31, 0.5, 0.69, 0.88],
    [0.1, 0.3, 0.5, 0.7, 0.9],
    [0.14, 0.32, 0.5, 0.68, 0.86],
  ],
  'royal-theater': [
    [0.5],
    [0.18, 0.39, 0.61, 0.82],
    [0.1, 0.3, 0.5, 0.7, 0.9],
    [0.1, 0.3, 0.5, 0.7, 0.9],
    [0.1, 0.3, 0.5, 0.7, 0.9],
  ],
  'ruby-constellation': [
    [0.5],
    [0.16, 0.39, 0.61, 0.84],
    [0.1, 0.3, 0.5, 0.7, 0.9],
    [0.1, 0.3, 0.5, 0.7, 0.9],
    [0.1, 0.3, 0.5, 0.7, 0.9],
  ],
};

export function createProductionRoomThemeLayouts(
  themeId: RoomThemeId,
  profile: RoomThemeViewportProfile,
): RoomThemeManifestV1['layouts'] {
  const builtInThemeId = isBuiltInThemeId(themeId) ? themeId : 'majlis-default';
  return Object.fromEntries(SUPPORTED_COUNTS.map((count) => [
    String(count),
    buildSeats(builtInThemeId, profile, count),
  ])) as RoomThemeManifestV1['layouts'];
}

export function validateProductionRoomThemeLayoutGeometry(
  layouts: RoomThemeManifestV1['layouts'],
): string[] {
  const errors: string[] = [];
  for (const count of SUPPORTED_COUNTS) {
    const key = String(count) as SeatCountKey;
    const seats = layouts[key];
    if (seats.length !== count) errors.push(`${key} must contain ${count} seats.`);
    const seen = new Set<number>();
    for (const seat of seats) {
      if (seen.has(seat.seatNumber)) errors.push(`${key} repeats seat ${seat.seatNumber}.`);
      seen.add(seat.seatNumber);
      if (seat.x < 0.04 || seat.x > 0.96 || seat.y < 0.04 || seat.y > 0.96) {
        errors.push(`${key} seat ${seat.seatNumber} is out of bounds.`);
      }
    }
    for (let left = 0; left < seats.length; left += 1) {
      for (let right = left + 1; right < seats.length; right += 1) {
        const a = seats[left];
        const b = seats[right];
        if (Math.hypot(a.x - b.x, a.y - b.y) < 0.072 * (a.scale + b.scale)) {
          errors.push(`${key} seats ${a.seatNumber} and ${b.seatNumber} overlap.`);
        }
      }
    }
  }
  return errors;
}

function buildSeats(
  themeId: BuiltInThemeId,
  profile: RoomThemeViewportProfile,
  count: SupportedSeatCount,
) {
  if (themeId === 'majlis-default') return buildMajlisSeats(profile, count);
  const seats: RoomThemeSeatPositionV1[] = [];
  let seatNumber = 1;
  const tierCount = THEME_Y[themeId][count].length;
  THEME_X[themeId].slice(0, tierCount).forEach((tier, tierIndex) => {
    tier.forEach((x, index) => {
      if (seatNumber > count) return;
      seats.push({
        seatNumber,
        x,
        y: profileAdjustedY(THEME_Y[themeId][count][tierIndex], profile),
        scale: PROFILE_SCALE[profile][tierIndex],
        z: 100 - tierIndex * 10 + index,
      });
      seatNumber += 1;
    });
  });
  return seats;
}

function buildMajlisSeats(profile: RoomThemeViewportProfile, count: SupportedSeatCount) {
  const baseScale = MAJLIS_SCALE[profile][count];
  return MAJLIS_LAYOUT_POINTS[count].map(([x, y], index) => ({
    seatNumber: index + 1,
    x,
    y: profileAdjustedY(y, profile),
    scale: index === 0 ? Math.min(1.08, baseScale + 0.12) : baseScale,
    z: 100 - index,
  }));
}

function profileAdjustedY(value: number, profile: RoomThemeViewportProfile) {
  if (profile === 'compact') return round(0.5 + (value - 0.5) * 0.94);
  if (profile === 'tall') return round(0.5 + (value - 0.5) * 1.03);
  return value;
}

function isBuiltInThemeId(value: RoomThemeId): value is BuiltInThemeId {
  return value === 'majlis-default' || value === 'royal-theater' || value === 'ruby-constellation';
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}
