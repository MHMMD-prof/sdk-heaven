'use strict';

const COSMETICS_RENDERER_OFF_PATCH = Object.freeze({
  cosmetics_animated_avatar_frames: false,
  cosmetics_asset_registry: false,
  cosmetics_effect_audio: false,
  cosmetics_profile_skins: false,
  cosmetics_chat_bubbles: false,
  cosmetics_nameplates: false,
  cosmetics_badges: false,
  cosmetics_seat_effects: false,
  cosmetics_couple_entrances: false,
  cosmetics_couple_effects: false,
  cosmetics_lottie: false,
  room_entry_animations: false,
  room_entry_audio: false,
  room_entry_video: false,
  room_gift_animations: false,
  room_gift_audio: false,
  room_gift_global_effects: false,
  room_gift_video: false,
  room_bottom_effect_stage: false,
  room_reactions: false,
  room_animated_themes: false,
  cosmetics_shared_renderer: false,
  cosmetics_unified_avatar_frames: false,
  cosmetics_video: false,
  cosmetics_custom_submissions: false,
  cosmetics_custom_rendering: false,
});

/** Dev/testing enable-all patch. Inverse of the dark kill-switch. */
const COSMETICS_RENDERER_ON_PATCH = Object.freeze(
  Object.fromEntries(Object.keys(COSMETICS_RENDERER_OFF_PATCH).map((key) => [key, true])),
);

const BOTTOM_EFFECT_STAGE_ROLLOUT_OFF_PATCH = Object.freeze({
  room_bottom_effect_stage_rollout: 'off',
  room_bottom_effect_stage_room_ids: Object.freeze([]),
  room_bottom_effect_stage_test_uid_hashes: Object.freeze([]),
  room_bottom_effect_stage_test_uids: Object.freeze([]),
});

const BOTTOM_EFFECT_STAGE_ROLLOUT_GLOBAL_PATCH = Object.freeze({
  room_bottom_effect_stage_rollout: 'global',
  room_bottom_effect_stage_room_ids: Object.freeze([]),
  room_bottom_effect_stage_test_uid_hashes: Object.freeze([]),
  room_bottom_effect_stage_test_uids: Object.freeze([]),
});

function parseCosmeticsRendererOffArguments(argv = []) {
  const allowed = new Set(['--apply', '--actor-uid']);
  for (const argument of argv) {
    if (String(argument).startsWith('--') && !allowed.has(argument)) {
      return { ok: false, error: 'Cosmetics renderers are dark-only. This command cannot enable them.' };
    }
  }
  const actorIndex = argv.indexOf('--actor-uid');
  const actorUid = actorIndex >= 0 ? String(argv[actorIndex + 1] || '').trim() : '';
  const apply = argv.includes('--apply');
  if (apply && !actorUid) return { ok: false, error: '--actor-uid is required with --apply.' };
  return {
    ok: true,
    value: {
      actorUid,
      apply,
      patch: { ...COSMETICS_RENDERER_OFF_PATCH },
      rolloutPatch: { ...BOTTOM_EFFECT_STAGE_ROLLOUT_OFF_PATCH },
    },
  };
}

function parseCosmeticsRendererOnArguments(argv = []) {
  const allowed = new Set(['--apply', '--actor-uid', '--enable-all']);
  for (const argument of argv) {
    if (String(argument).startsWith('--') && !allowed.has(argument)) {
      return { ok: false, error: 'Unknown argument. Use --enable-all --apply --actor-uid <ownerUid>.' };
    }
  }
  if (!argv.includes('--enable-all')) {
    return { ok: false, error: 'Refusing to enable without --enable-all.' };
  }
  const actorIndex = argv.indexOf('--actor-uid');
  const actorUid = actorIndex >= 0 ? String(argv[actorIndex + 1] || '').trim() : '';
  const apply = argv.includes('--apply');
  if (apply && !actorUid) return { ok: false, error: '--actor-uid is required with --apply.' };
  return {
    ok: true,
    value: {
      actorUid,
      apply,
      patch: { ...COSMETICS_RENDERER_ON_PATCH },
      rolloutPatch: { ...BOTTOM_EFFECT_STAGE_ROLLOUT_GLOBAL_PATCH },
    },
  };
}

module.exports = {
  COSMETICS_RENDERER_OFF_PATCH,
  COSMETICS_RENDERER_ON_PATCH,
  BOTTOM_EFFECT_STAGE_ROLLOUT_GLOBAL_PATCH,
  BOTTOM_EFFECT_STAGE_ROLLOUT_OFF_PATCH,
  parseCosmeticsRendererOffArguments,
  parseCosmeticsRendererOnArguments,
};
