export const BOTTOM_EFFECT_DOCK_HEIGHT = 76;
export const BOTTOM_EFFECT_DOCK_GAP = 16;
export const BOTTOM_EFFECT_PARENT_HORIZONTAL_INSET = 16;

export type BottomEffectStageGeometry = {
  bottom: number;
  height: number;
  left: number;
  right: number;
  width: number;
};

export function resolveBottomEffectStageGeometry(input: {
  parentHorizontalInset?: number;
  safeAreaBottom: number;
  viewportHeight: number;
  viewportWidth: number;
}): BottomEffectStageGeometry {
  const viewportWidth = finitePositive(input.viewportWidth, 360);
  const viewportHeight = finitePositive(input.viewportHeight, 720);
  const safeAreaBottom = Math.max(8, finiteNonNegative(input.safeAreaBottom));
  const parentInset = finiteNonNegative(
    input.parentHorizontalInset ?? BOTTOM_EFFECT_PARENT_HORIZONTAL_INSET,
  );
  const bottom = safeAreaBottom + BOTTOM_EFFECT_DOCK_HEIGHT + BOTTOM_EFFECT_DOCK_GAP;
  const maximumHeight = Math.max(180, Math.min(360, viewportHeight * 0.44));
  const targetHeight = viewportWidth * 0.72;
  const height = Math.round(Math.min(maximumHeight, Math.max(220, targetHeight)));

  return {
    bottom: Math.round(bottom),
    height,
    left: -parentInset,
    right: -parentInset,
    width: Math.round(viewportWidth),
  };
}

function finiteNonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function finitePositive(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
