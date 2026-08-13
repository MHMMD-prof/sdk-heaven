import type { QueuedRoomEffect, RoomEffectViewerMode } from './roomEffectsQueue';
import { buildRoomEffectCopy } from './roomEffectPresentation';
import { layers } from '../theme';
import {
  BOTTOM_EFFECT_DOCK_GAP,
  BOTTOM_EFFECT_DOCK_HEIGHT,
  BOTTOM_EFFECT_PARENT_HORIZONTAL_INSET,
  resolveBottomEffectStageGeometry as resolveSharedBottomEffectStageGeometry,
  type BottomEffectStageGeometry as SharedBottomEffectStageGeometry,
} from './bottomEffectStageContract';

export {
  BOTTOM_EFFECT_DOCK_GAP,
  BOTTOM_EFFECT_DOCK_HEIGHT,
  BOTTOM_EFFECT_PARENT_HORIZONTAL_INSET,
} from './bottomEffectStageContract';

export const BOTTOM_EFFECT_STAGE_LAYER = layers.bottomEffectStage;
export const ROOM_INTERACTIVE_LAYER = layers.roomInteractive;
export const ROOM_SAFETY_LAYER = layers.roomSafety;
export const ROOM_DOCK_LAYER = layers.fixedDock;
export const BOTTOM_EFFECT_POINTER_EVENTS = 'none' as const;

export type BottomEffectStageMedia = 'motion' | 'static' | 'none';
export type BottomEffectStagePresentation = 'visual' | 'static' | 'compact';
export type BottomEffectStageAssetSource = 'primary' | 'fallback' | 'compatibility' | 'none';
export type BottomEffectStageIdentityRole = 'entrant' | 'sender' | 'recipient';

export type BottomEffectStageIdentity = {
  key: string;
  initial: string;
  name: string;
  role: BottomEffectStageIdentityRole;
};

export type BottomEffectStageGeometry = SharedBottomEffectStageGeometry & { zIndex: number };

export type BottomEffectCompletionState = {
  eventId?: string;
  settled: boolean;
};

export type BottomEffectStageOutcomeState = {
  eventId?: string;
  recorded: Set<'shown' | 'fallback' | 'failed'>;
};

export type BottomEffectStageAssetSelection = {
  media: BottomEffectStageMedia;
  source: BottomEffectStageAssetSource;
};

export function resolveBottomEffectStageGeometry(input: {
  parentHorizontalInset?: number;
  safeAreaBottom: number;
  viewportHeight: number;
  viewportWidth: number;
}): BottomEffectStageGeometry {
  return {
    ...resolveSharedBottomEffectStageGeometry(input),
    zIndex: BOTTOM_EFFECT_STAGE_LAYER,
  };
}

export function resolveBottomEffectStagePresentation(
  viewerMode: RoomEffectViewerMode,
  media: BottomEffectStageMedia,
): BottomEffectStagePresentation {
  if (viewerMode !== 'full') return 'compact';
  return media === 'motion' ? 'visual' : 'static';
}

export function resolveBottomEffectStageAssetSelection(input: {
  hasCompatibility: boolean;
  hasFallback: boolean;
  motionAllowed: boolean;
  primaryFormat?: string;
}): BottomEffectStageAssetSelection {
  const primaryIsStatic = ['png', 'jpeg', 'legacy-webp'].includes(input.primaryFormat || '');
  if (input.motionAllowed && input.primaryFormat) {
    return {
      media: primaryIsStatic ? 'static' : 'motion',
      source: 'primary',
    };
  }
  if (primaryIsStatic) return { media: 'static', source: 'primary' };
  if (input.hasFallback) return { media: 'static', source: 'fallback' };
  if (input.hasCompatibility) return { media: 'static', source: 'compatibility' };
  return { media: 'none', source: 'none' };
}

export function resolveBottomEffectStageCopy(effect: QueuedRoomEffect) {
  if (effect.copy) return buildRoomEffectCopy(effect.copy, 'ar');
  return cleanName(effect.label, 220) || 'حدث في الغرفة';
}

export function resolveBottomEffectStageIdentities(
  effect: QueuedRoomEffect,
): BottomEffectStageIdentity[] {
  if (effect.copy?.kind === 'gift') {
    return [
      identity('sender', effect.copy.senderDisplayName, 'sender'),
      identity('recipient', effect.copy.recipientDisplayName, 'recipient'),
    ];
  }
  if (effect.copy?.kind === 'entry' || effect.copy?.kind === 'couple-entry') {
    return effect.copy.entrantDisplayNames.slice(0, 2).map((name, index) => (
      identity(`entrant-${index}`, name, 'entrant')
    ));
  }
  if (effect.kind === 'room-gift') {
    return [
      identity('sender', effect.senderDisplayName, 'sender'),
      identity('recipient', effect.recipientDisplayName, 'recipient'),
    ];
  }
  if (effect.kind === 'room-entry') {
    return [identity('entrant-0', effect.senderDisplayName, 'entrant')];
  }
  return [];
}

export function resolveBottomEffectCompletionDelay(input: {
  durationMs: number;
  expiresAtMs: number;
  nowMs: number;
}) {
  const durationMs = Math.max(0, finiteNonNegative(input.durationMs));
  const remainingLifetimeMs = Math.max(0, finiteNonNegative(input.expiresAtMs - input.nowMs));
  return Math.min(durationMs, remainingLifetimeMs);
}

export function claimBottomEffectCompletion(
  state: BottomEffectCompletionState,
  eventId: string,
) {
  if (state.eventId !== eventId) {
    state.eventId = eventId;
    state.settled = false;
  }
  if (state.settled) return false;
  state.settled = true;
  return true;
}

export function claimBottomEffectStageOutcome(
  state: BottomEffectStageOutcomeState,
  eventId: string,
  outcome: 'shown' | 'fallback' | 'failed',
) {
  if (state.eventId !== eventId) {
    state.eventId = eventId;
    state.recorded.clear();
  }
  if (state.recorded.has(outcome)) return false;
  state.recorded.add(outcome);
  return true;
}

function identity(
  key: string,
  value: string | undefined,
  role: BottomEffectStageIdentityRole,
): BottomEffectStageIdentity {
  const name = cleanName(value, 80) || 'عضو';
  return {
    initial: Array.from(name)[0] || '•',
    key,
    name,
    role,
  };
}

function cleanName(value: unknown, maximum: number) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';
}

function finiteNonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
