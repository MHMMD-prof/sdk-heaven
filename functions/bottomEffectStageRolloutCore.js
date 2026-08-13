'use strict';

const { createHash } = require('node:crypto');

const MODES = Object.freeze(['off', 'testers', 'rooms', 'global']);
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{1,127}$/;
const TESTER_HASH_DOMAIN = 'bottom-effect-stage-v1';

function parseBottomEffectStageRolloutArguments(argv = []) {
  const valueArguments = new Set(['--mode', '--test-uid', '--room-id', '--actor-uid']);
  const flagArguments = new Set(['--apply']);
  const values = { '--test-uid': [], '--room-id': [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = String(argv[index]);
    if (flagArguments.has(argument)) continue;
    if (!valueArguments.has(argument)) {
      return { ok: false, error: `Unknown argument: ${argument}` };
    }
    const next = String(argv[index + 1] || '').trim();
    if (!next || next.startsWith('--')) {
      return { ok: false, error: `${argument} requires a value.` };
    }
    if (argument === '--test-uid' || argument === '--room-id') values[argument].push(next);
    else values[argument] = next;
    index += 1;
  }
  const mode = values['--mode'];
  if (!MODES.includes(mode)) {
    return { ok: false, error: '--mode must be off, testers, rooms, or global.' };
  }
  const actorUid = String(values['--actor-uid'] || '');
  const apply = argv.includes('--apply');
  if (apply && !actorUid) return { ok: false, error: '--actor-uid is required with --apply.' };
  const testUids = uniqueIdentifiers(values['--test-uid']);
  const roomIds = uniqueIdentifiers(values['--room-id']);
  if (!testUids.ok) return testUids;
  if (!roomIds.ok) return roomIds;
  if (mode === 'testers' && testUids.value.length === 0) {
    return { ok: false, error: 'Testers mode requires at least one --test-uid.' };
  }
  if (mode === 'rooms' && roomIds.value.length === 0) {
    return { ok: false, error: 'Rooms mode requires at least one --room-id.' };
  }
  return {
    ok: true,
    value: {
      actorUid,
      apply,
      mode,
      patch: {
        room_bottom_effect_stage: mode !== 'off',
        room_bottom_effect_stage_rollout: mode,
        room_bottom_effect_stage_room_ids: mode === 'rooms' ? roomIds.value : [],
        room_bottom_effect_stage_test_uid_hashes: mode === 'testers' || mode === 'rooms'
          ? testUids.value.map(hashTesterUid)
          : [],
        room_bottom_effect_stage_test_uids: [],
      },
    },
  };
}

function hashTesterUid(uid) {
  return createHash('sha256').update(`${TESTER_HASH_DOMAIN}\0${uid}`, 'utf8').digest('hex');
}

function uniqueIdentifiers(values) {
  if (values.length > 100) return { ok: false, error: 'A rollout list cannot exceed 100 entries.' };
  const unique = [...new Set(values)];
  const invalid = unique.find((value) => !IDENTIFIER_PATTERN.test(value));
  return invalid
    ? { ok: false, error: `Invalid rollout identifier: ${invalid}` }
    : { ok: true, value: unique };
}

function buildPreviousConfigSnapshot(before, patch) {
  const source = before && typeof before === 'object' && !Array.isArray(before) ? before : {};
  return Object.fromEntries(Object.keys(patch).map((key) => [
    key,
    source[key] === undefined ? null : source[key],
  ]));
}

module.exports = {
  MODES,
  TESTER_HASH_DOMAIN,
  buildPreviousConfigSnapshot,
  hashTesterUid,
  parseBottomEffectStageRolloutArguments,
};
