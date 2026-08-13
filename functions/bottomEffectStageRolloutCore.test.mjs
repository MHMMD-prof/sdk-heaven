import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildPreviousConfigSnapshot,
  hashTesterUid,
  parseBottomEffectStageRolloutArguments,
} = require('./bottomEffectStageRolloutCore');

describe('bottom effect stage rollout controls', () => {
  it('builds independent tester, room, global, and rollback patches', () => {
    expect(parseBottomEffectStageRolloutArguments([
      '--mode', 'testers', '--test-uid', 'owner-1', '--test-uid', 'test-2',
    ])).toMatchObject({
      ok: true,
      value: { patch: {
        room_bottom_effect_stage: true,
        room_bottom_effect_stage_rollout: 'testers',
        room_bottom_effect_stage_test_uid_hashes: [
          hashTesterUid('owner-1'),
          hashTesterUid('test-2'),
        ],
        room_bottom_effect_stage_test_uids: [],
      } },
    });
    expect(parseBottomEffectStageRolloutArguments([
      '--mode', 'rooms', '--room-id', 'room-1', '--test-uid', 'owner-1',
    ])).toMatchObject({
      ok: true,
      value: { patch: {
        room_bottom_effect_stage: true,
        room_bottom_effect_stage_rollout: 'rooms',
        room_bottom_effect_stage_room_ids: ['room-1'],
      } },
    });
    expect(parseBottomEffectStageRolloutArguments(['--mode', 'global'])).toMatchObject({
      ok: true,
      value: { patch: { room_bottom_effect_stage: true } },
    });
    expect(parseBottomEffectStageRolloutArguments(['--mode', 'off'])).toMatchObject({
      ok: true,
      value: { patch: {
        room_bottom_effect_stage: false,
        room_bottom_effect_stage_test_uid_hashes: [],
        room_bottom_effect_stage_room_ids: [],
        room_bottom_effect_stage_test_uids: [],
      } },
    });
  });

  it('stores domain-separated tester hashes instead of readable UIDs', () => {
    const result = parseBottomEffectStageRolloutArguments([
      '--mode', 'testers', '--test-uid', 'owner-1',
    ]);
    expect(result.value.patch.room_bottom_effect_stage_test_uid_hashes).toEqual([
      hashTesterUid('owner-1'),
    ]);
    expect(hashTesterUid('owner-1')).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result.value.patch)).not.toContain('owner-1');
  });

  it('fails closed for missing targets, invalid values, and unaudited apply', () => {
    expect(parseBottomEffectStageRolloutArguments(['--mode', 'testers']).ok).toBe(false);
    expect(parseBottomEffectStageRolloutArguments(['--mode', 'rooms']).ok).toBe(false);
    expect(parseBottomEffectStageRolloutArguments(['--mode', 'wide']).ok).toBe(false);
    expect(parseBottomEffectStageRolloutArguments([
      '--mode', 'testers', '--test-uid', 'bad uid',
    ]).ok).toBe(false);
    expect(parseBottomEffectStageRolloutArguments([
      '--mode', 'off', '--apply',
    ]).ok).toBe(false);
  });

  it('serializes missing prior config as null for Firestore audit records', () => {
    expect(buildPreviousConfigSnapshot(
      { room_bottom_effect_stage: false },
      {
        room_bottom_effect_stage: true,
        room_bottom_effect_stage_rollout: 'global',
      },
    )).toEqual({
      room_bottom_effect_stage: false,
      room_bottom_effect_stage_rollout: null,
    });
  });
});
