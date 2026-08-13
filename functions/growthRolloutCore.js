'use strict';

/**
 * Competitive Social Growth — Wave 0 rollout stages.
 *
 * Stage metadata lives at `appRuntime/growthRollout`.
 * Applying a stage also patches a bounded set of existing flags so closed-beta
 * can turn on push + room gifts + supporter rankings + Wave 1 match/lucky bag
 * + Wave 2 boards/VIP + Wave 3 in-room PK without enabling cross-room PK
 * (those reserved growth flags stay false until later waves).
 */

const GROWTH_RESERVED_FLAG_KEYS = Object.freeze([
  'quickMatch',
  'luckyBag',
  'maskedMatch',
  'leaderboards',
  'vipTiers',
  'roomPk',
  'crossRoomPk',
  'roomGameEconomy',
  'giftCombos',
  'luckyGifts',
  'magicGiftTemplates',
  'families',
  'opsEvents',
  'dailyMissions',
  'watchTogether',
  'softOneToOneMatch',
]);

const GROWTH_SOCIAL_FLAG_KEYS = Object.freeze(['pushNotifications']);
const GROWTH_VOICE_FLAG_KEYS = Object.freeze([
  'voice_room_gifts',
  'voice_room_supporter_rankings',
  'voice_room_shared_music',
]);

const GROWTH_ROLLOUT_STAGES = Object.freeze([
  Object.freeze({
    id: 0,
    name: 'dark',
    description: 'All growth-controlled flags forced off. Rollback target.',
    growthFeatures: Object.freeze(Object.fromEntries(
      GROWTH_RESERVED_FLAG_KEYS.map((key) => [key, false]),
    )),
    socialFeatures: Object.freeze({ pushNotifications: false }),
    voiceRoomFeatures: Object.freeze({
      voice_room_gifts: false,
      voice_room_supporter_rankings: false,
      voice_room_shared_music: false,
    }),
  }),
  Object.freeze({
    id: 1,
    name: 'closed-beta',
    description: 'Wave 0–10 closed cohort: match, boards, VIP, PK, room games, gift theater, families, ops missions, watch-together, soft voice 1:1. No cross-room PK.',
    growthFeatures: Object.freeze({
      ...Object.fromEntries(GROWTH_RESERVED_FLAG_KEYS.map((key) => [key, false])),
      dailyMissions: true,
      families: true,
      giftCombos: true,
      leaderboards: true,
      luckyBag: true,
      luckyGifts: true,
      magicGiftTemplates: true,
      opsEvents: true,
      quickMatch: true,
      roomGameEconomy: true,
      roomPk: true,
      softOneToOneMatch: true,
      vipTiers: true,
      watchTogether: true,
    }),
    socialFeatures: Object.freeze({ pushNotifications: true }),
    voiceRoomFeatures: Object.freeze({
      voice_room_gifts: true,
      voice_room_supporter_rankings: true,
      voice_room_shared_music: false,
    }),
  }),
  Object.freeze({
    id: 2,
    name: 'public-partial',
    description: 'Closed-beta + shared music + masked match + families + ops missions + watch + soft 1:1. Still no cross-room PK.',
    growthFeatures: Object.freeze({
      ...Object.fromEntries(GROWTH_RESERVED_FLAG_KEYS.map((key) => [key, false])),
      dailyMissions: true,
      families: true,
      giftCombos: true,
      leaderboards: true,
      luckyBag: true,
      luckyGifts: true,
      magicGiftTemplates: true,
      maskedMatch: true,
      opsEvents: true,
      quickMatch: true,
      roomGameEconomy: true,
      roomPk: true,
      softOneToOneMatch: true,
      vipTiers: true,
      watchTogether: true,
    }),
    socialFeatures: Object.freeze({ pushNotifications: true }),
    voiceRoomFeatures: Object.freeze({
      voice_room_gifts: true,
      voice_room_supporter_rankings: true,
      voice_room_shared_music: true,
    }),
  }),
  Object.freeze({
    id: 3,
    name: 'public',
    description: 'Wave 10 public ceiling including soft voice 1:1. Cross-room PK stays dark.',
    growthFeatures: Object.freeze({
      ...Object.fromEntries(GROWTH_RESERVED_FLAG_KEYS.map((key) => [key, false])),
      dailyMissions: true,
      families: true,
      giftCombos: true,
      leaderboards: true,
      luckyBag: true,
      luckyGifts: true,
      magicGiftTemplates: true,
      maskedMatch: true,
      opsEvents: true,
      quickMatch: true,
      roomGameEconomy: true,
      roomPk: true,
      softOneToOneMatch: true,
      vipTiers: true,
      watchTogether: true,
    }),
    socialFeatures: Object.freeze({ pushNotifications: true }),
    voiceRoomFeatures: Object.freeze({
      voice_room_gifts: true,
      voice_room_supporter_rankings: true,
      voice_room_shared_music: true,
    }),
  }),
]);

function resolveGrowthRolloutStage(value) {
  const id = typeof value === 'number' ? value : Number(value);
  if (Number.isInteger(id)) {
    return GROWTH_ROLLOUT_STAGES.find((stage) => stage.id === id) || null;
  }
  return null;
}

function resolveGrowthRolloutStageByName(name) {
  const normalized = typeof name === 'string' ? name.trim() : '';
  return GROWTH_ROLLOUT_STAGES.find((stage) => stage.name === normalized) || null;
}

function validateGrowthRolloutStageTransition({ currentStageId = 0, nextStageId }) {
  const current = resolveGrowthRolloutStage(currentStageId);
  const next = resolveGrowthRolloutStage(nextStageId);
  if (!current || !next) return { ok: false, code: 'STAGE_INVALID' };
  // Allow rollback to dark from any stage, or sequential +1, or same stage.
  if (next.id === current.id) return { ok: true, value: next, noop: true };
  if (next.id === 0) return { ok: true, value: next, rollback: true };
  if (next.id !== current.id + 1) return { ok: false, code: 'NON_SEQUENTIAL_STAGE' };
  return { ok: true, value: next };
}

function mapGrowthFeatures(data = {}) {
  const source = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  return Object.fromEntries(
    GROWTH_RESERVED_FLAG_KEYS.map((key) => [key, source[key] === true]),
  );
}

function summarizeGrowthRolloutReadiness({
  growthFeatures = {},
  recordedStageName = 'dark',
  socialFeatures = {},
  voiceRoomFeatures = {},
} = {}) {
  const recorded = resolveGrowthRolloutStageByName(recordedStageName)
    || resolveGrowthRolloutStage(0);
  const mappedGrowth = mapGrowthFeatures(growthFeatures);
  const stages = GROWTH_ROLLOUT_STAGES.map((stage) => {
    const socialMissing = Object.entries(stage.socialFeatures)
      .filter(([key, expected]) => expected === true && socialFeatures[key] !== true)
      .map(([key]) => key);
    const voiceMissing = Object.entries(stage.voiceRoomFeatures)
      .filter(([key, expected]) => expected === true && voiceRoomFeatures[key] !== true)
      .map(([key]) => key);
    const growthMissing = Object.entries(stage.growthFeatures)
      .filter(([key, expected]) => expected === true && mappedGrowth[key] !== true)
      .map(([key]) => key);
    const growthLeak = GROWTH_RESERVED_FLAG_KEYS.filter((key) => {
      if (mappedGrowth[key] !== true) return false;
      return stage.growthFeatures[key] !== true;
    });
    const ready = socialMissing.length === 0
      && voiceMissing.length === 0
      && growthMissing.length === 0
      && growthLeak.length === 0;
    return {
      growthLeak,
      missingGrowthFlags: growthMissing,
      missingSocialFlags: socialMissing,
      missingVoiceFlags: voiceMissing,
      name: stage.name,
      ready,
      stageId: stage.id,
    };
  });
  return {
    flags: {
      growthFeatures: mappedGrowth,
      socialFeatures: Object.fromEntries(
        GROWTH_SOCIAL_FLAG_KEYS.map((key) => [key, socialFeatures[key] === true]),
      ),
      voiceRoomFeatures: Object.fromEntries(
        GROWTH_VOICE_FLAG_KEYS.map((key) => [key, voiceRoomFeatures[key] === true]),
      ),
    },
    recordedStage: recorded
      ? { id: recorded.id, name: recorded.name, description: recorded.description }
      : null,
    stages,
  };
}

function buildGrowthStageFlagPatches(stage) {
  if (!stage) return null;
  return {
    growthFeatures: { ...stage.growthFeatures },
    socialFeatures: { ...stage.socialFeatures },
    voiceRoomFeatures: { ...stage.voiceRoomFeatures },
  };
}

function parseGrowthRolloutStageArguments(argv = []) {
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
  if (/^\d+$/.test(stageToken)) stage = resolveGrowthRolloutStage(Number(stageToken));
  else if (stageToken) stage = resolveGrowthRolloutStageByName(stageToken);
  if (!stage) return { ok: false, error: '--stage must be dark|closed-beta|public-partial|public or 0-3.' };
  const actorUid = readArg(argv, '--actor-uid');
  const apply = argv.includes('--apply');
  if (apply && !actorUid) return { ok: false, error: '--actor-uid is required with --apply.' };
  return { ok: true, value: { actorUid, apply, stage } };
}

function readArg(argv, name) {
  const index = argv.indexOf(name);
  if (index >= 0) return String(argv[index + 1] || '').trim();
  const prefix = `${name}=`;
  const match = argv.find((value) => String(value).startsWith(prefix));
  return match ? String(match).slice(prefix.length).trim() : '';
}

module.exports = {
  GROWTH_RESERVED_FLAG_KEYS,
  GROWTH_ROLLOUT_STAGES,
  GROWTH_SOCIAL_FLAG_KEYS,
  GROWTH_VOICE_FLAG_KEYS,
  buildGrowthStageFlagPatches,
  mapGrowthFeatures,
  parseGrowthRolloutStageArguments,
  resolveGrowthRolloutStage,
  resolveGrowthRolloutStageByName,
  summarizeGrowthRolloutReadiness,
  validateGrowthRolloutStageTransition,
};
