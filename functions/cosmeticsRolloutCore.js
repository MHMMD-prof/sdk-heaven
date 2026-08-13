'use strict';

/**
 * Cosmetics Wave 10 staged rollout matrix.
 *
 * This pass records stage metadata only (`appRuntime/cosmeticsRollout`).
 * Presentation enablement of `appConfig/cosmeticsFeatures` is a later ops gate.
 * The only production-safe write that mutates cosmeticsFeatures in this pass is
 * the dark kill-switch `setCosmeticsRendererFlags` (force false).
 */

const COSMETICS_PRESENTATION_FLAG_KEYS = Object.freeze([
  'cosmetics_animated_avatar_frames',
  'cosmetics_asset_registry',
  'cosmetics_effect_audio',
  'cosmetics_profile_skins',
  'cosmetics_chat_bubbles',
  'cosmetics_nameplates',
  'cosmetics_badges',
  'cosmetics_seat_effects',
  'cosmetics_couple_entrances',
  'cosmetics_couple_effects',
  'cosmetics_lottie',
  'room_entry_animations',
  'room_entry_audio',
  'room_entry_video',
  'room_gift_animations',
  'room_gift_audio',
  'room_gift_global_effects',
  'room_gift_video',
  'room_bottom_effect_stage',
  'room_reactions',
  'room_animated_themes',
  'cosmetics_shared_renderer',
  'cosmetics_unified_avatar_frames',
  'cosmetics_video',
  'cosmetics_custom_submissions',
  'cosmetics_custom_rendering',
]);

const COSMETICS_ROLLOUT_STAGES = Object.freeze([
  Object.freeze({
    name: 'dark',
    prerequisites: Object.freeze([]),
    requiredFlags: Object.freeze(Object.fromEntries(
      COSMETICS_PRESENTATION_FLAG_KEYS.map((key) => [key, false]),
    )),
    stageId: 0,
  }),
  Object.freeze({
    name: 'internal',
    prerequisites: Object.freeze(['owner-allowlist-ready']),
    requiredFlags: Object.freeze({
      cosmetics_asset_registry: true,
      cosmetics_shared_renderer: true,
    }),
    stageId: 1,
  }),
  Object.freeze({
    name: 'static-frames',
    prerequisites: Object.freeze(['internal-observation-passed', 'approved-static-frames']),
    requiredFlags: Object.freeze({
      cosmetics_asset_registry: true,
      cosmetics_shared_renderer: true,
      cosmetics_unified_avatar_frames: true,
    }),
    stageId: 2,
  }),
  Object.freeze({
    name: 'animated-frames',
    prerequisites: Object.freeze(['static-frames-observation-passed']),
    requiredFlags: Object.freeze({
      cosmetics_asset_registry: true,
      cosmetics_shared_renderer: true,
      cosmetics_unified_avatar_frames: true,
      cosmetics_animated_avatar_frames: true,
      cosmetics_lottie: true,
    }),
    stageId: 3,
  }),
  Object.freeze({
    name: 'gift-lottie',
    prerequisites: Object.freeze(['animated-frames-observation-passed', 'approved-gift-lottie-subset']),
    requiredFlags: Object.freeze({
      cosmetics_asset_registry: true,
      cosmetics_shared_renderer: true,
      cosmetics_lottie: true,
      room_gift_animations: true,
    }),
    stageId: 4,
  }),
  Object.freeze({
    name: 'gift-mp4-restricted',
    prerequisites: Object.freeze([
      'gift-lottie-observation-passed',
      'wave0-mp4-gates-passed',
      'wave2-video-gates-passed',
      'single-fullscreen-gift-approved',
    ]),
    requiredFlags: Object.freeze({
      cosmetics_asset_registry: true,
      cosmetics_shared_renderer: true,
      cosmetics_lottie: true,
      cosmetics_video: true,
      room_gift_animations: true,
      room_gift_video: true,
    }),
    stageId: 5,
  }),
  Object.freeze({
    name: 'entry-motion',
    prerequisites: Object.freeze(['gift-stage-observation-passed', 'approved-entry-assets']),
    requiredFlags: Object.freeze({
      cosmetics_asset_registry: true,
      cosmetics_shared_renderer: true,
      cosmetics_lottie: true,
      room_entry_animations: true,
    }),
    stageId: 6,
  }),
  Object.freeze({
    name: 'categories',
    prerequisites: Object.freeze(['entry-motion-observation-passed']),
    requiredFlags: Object.freeze({
      cosmetics_asset_registry: true,
      cosmetics_shared_renderer: true,
      cosmetics_profile_skins: true,
      cosmetics_chat_bubbles: true,
      cosmetics_nameplates: true,
      cosmetics_badges: true,
      cosmetics_seat_effects: true,
    }),
    stageId: 7,
  }),
  Object.freeze({
    name: 'reactions-themes',
    prerequisites: Object.freeze(['categories-observation-passed']),
    requiredFlags: Object.freeze({
      cosmetics_asset_registry: true,
      cosmetics_shared_renderer: true,
      cosmetics_lottie: true,
      room_reactions: true,
      room_animated_themes: true,
    }),
    stageId: 8,
  }),
  Object.freeze({
    name: 'couple',
    prerequisites: Object.freeze(['reactions-themes-observation-passed']),
    requiredFlags: Object.freeze({
      cosmetics_asset_registry: true,
      cosmetics_shared_renderer: true,
      cosmetics_couple_effects: true,
      cosmetics_couple_entrances: true,
    }),
    stageId: 9,
  }),
  Object.freeze({
    name: 'custom',
    prerequisites: Object.freeze(['couple-observation-passed', 'custom-allowlist-ready']),
    requiredFlags: Object.freeze({
      cosmetics_asset_registry: true,
      cosmetics_shared_renderer: true,
      cosmetics_custom_submissions: true,
      cosmetics_custom_rendering: true,
    }),
    stageId: 10,
  }),
]);

function mapCosmeticsPresentationFlags(data = {}) {
  const source = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  return Object.fromEntries(
    COSMETICS_PRESENTATION_FLAG_KEYS.map((key) => [key, source[key] === true]),
  );
}

function resolveCosmeticsRolloutStage(stageId) {
  return COSMETICS_ROLLOUT_STAGES.find((stage) => stage.stageId === stageId);
}

function resolveCosmeticsRolloutStageByName(name) {
  const normalized = typeof name === 'string' ? name.trim() : '';
  return COSMETICS_ROLLOUT_STAGES.find((stage) => stage.name === normalized);
}

function assertCosmeticsDark(flags = {}) {
  const mapped = mapCosmeticsPresentationFlags(flags);
  const enabled = COSMETICS_PRESENTATION_FLAG_KEYS.filter((key) => mapped[key] === true);
  return {
    dark: enabled.length === 0,
    enabledFlags: enabled,
    flags: mapped,
    ok: enabled.length === 0,
  };
}

function summarizeCosmeticsRolloutReadiness({
  flags = {},
  gates = {},
  recordedStageName = '',
} = {}) {
  const mappedFlags = mapCosmeticsPresentationFlags(flags);
  const dark = assertCosmeticsDark(mappedFlags);
  const recorded = resolveCosmeticsRolloutStageByName(recordedStageName)
    || resolveCosmeticsRolloutStage(0);
  const stages = COSMETICS_ROLLOUT_STAGES.map((stage) => {
    const requiredMissing = Object.entries(stage.requiredFlags)
      .filter(([key, expected]) => expected === true && mappedFlags[key] !== true)
      .map(([key]) => key);
    const unexpectedEnabled = stage.stageId === 0 ? dark.enabledFlags : [];
    const missingPrerequisites = stage.prerequisites.filter((gate) => gates[gate] !== true);
    const flagReady = requiredMissing.length === 0;
    const gateReady = missingPrerequisites.length === 0;
    return {
      enablementBlockedInThisPass: stage.stageId > 0,
      flagReady,
      gateReady,
      missingFlags: requiredMissing,
      missingPrerequisites,
      name: stage.name,
      ready: stage.stageId === 0 ? dark.ok : flagReady && gateReady,
      stageId: stage.stageId,
      unexpectedEnabled,
    };
  });
  return {
    dark: dark.ok,
    enablementPolicy: 'metadata-only-this-pass',
    flags: mappedFlags,
    recordedStage: recorded ? { name: recorded.name, stageId: recorded.stageId } : null,
    stages,
  };
}

function validateCosmeticsRolloutStageMetadataTransition({
  currentStageId = 0,
  nextStageId,
}) {
  const current = resolveCosmeticsRolloutStage(currentStageId);
  const next = resolveCosmeticsRolloutStage(nextStageId);
  if (!current || !next) return { ok: false, code: 'STAGE_INVALID' };
  if (nextStageId > currentStageId + 1) return { ok: false, code: 'STAGE_SKIP_FORBIDDEN' };
  return {
    ok: true,
    value: next,
    writesCosmeticsFeatures: false,
  };
}

function parseCosmeticsRolloutStageArguments(argv = []) {
  const allowed = new Set(['--apply', '--actor-uid', '--stage', '--stage-id']);
  for (const argument of argv) {
    if (String(argument).startsWith('--') && !allowed.has(argument)
      && !String(argument).startsWith('--actor-uid=')
      && !String(argument).startsWith('--stage=')
      && !String(argument).startsWith('--stage-id=')) {
      return { ok: false, error: `Unsupported argument: ${argument}` };
    }
  }
  const stageToken = readArg(argv, '--stage') || readArg(argv, '--stage-id');
  let stage = null;
  if (/^\d+$/.test(stageToken)) {
    stage = resolveCosmeticsRolloutStage(Number(stageToken));
  } else if (stageToken) {
    stage = resolveCosmeticsRolloutStageByName(stageToken);
  }
  if (!stage) return { ok: false, error: '--stage must be a known Wave 10 stage name or stage id.' };
  const actorUid = readArg(argv, '--actor-uid');
  const apply = argv.includes('--apply');
  if (apply && !actorUid) return { ok: false, error: '--actor-uid is required with --apply.' };
  return {
    ok: true,
    value: {
      actorUid,
      apply,
      stage,
      writesCosmeticsFeatures: false,
    },
  };
}

function readArg(argv, name) {
  const index = argv.indexOf(name);
  if (index >= 0) return String(argv[index + 1] || '').trim();
  const prefix = `${name}=`;
  const match = argv.find((value) => String(value).startsWith(prefix));
  return match ? String(match).slice(prefix.length).trim() : '';
}

module.exports = {
  COSMETICS_PRESENTATION_FLAG_KEYS,
  COSMETICS_ROLLOUT_STAGES,
  assertCosmeticsDark,
  mapCosmeticsPresentationFlags,
  parseCosmeticsRolloutStageArguments,
  resolveCosmeticsRolloutStage,
  resolveCosmeticsRolloutStageByName,
  summarizeCosmeticsRolloutReadiness,
  validateCosmeticsRolloutStageMetadataTransition,
};
