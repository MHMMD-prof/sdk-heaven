import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  CROSS_ROOM_PK_ACTIONS,
  CROSS_ROOM_PK_CHALLENGE_STATUSES,
  CROSS_ROOM_PK_COPY_AR,
  CROSS_ROOM_PK_ERROR_CONTRACT,
  CROSS_ROOM_PK_LIMITS,
  CROSS_ROOM_PK_RETENTION_MS,
  CROSS_ROOM_PK_ROLLBACK_CONTRACT,
  CROSS_ROOM_PK_SCORE_SHARD_COUNT,
  CROSS_ROOM_PK_SESSION_STATUSES,
  CROSS_ROOM_PK_TELEMETRY_KEYS,
  CROSS_ROOM_PK_TIMING_MS,
  canTransitionCrossRoomPkChallenge,
  canTransitionCrossRoomPkSession,
  classifyRoomPkSession,
  getCrossRoomPkErrorContract,
  mapCrossRoomPkChallenge,
  mapCrossRoomPkSession,
  resolveCrossRoomPkTermination,
} = require('./crossRoomPkContract');
const { mapRoomPkSession } = require('./roomPkCore');
const inRoomV1 = require('./fixtures/crossRoomPk/v1-in-room-session.json');
const pendingChallengeV1 = require('./fixtures/crossRoomPk/v1-pending-challenge.json');
const crossRoomV2 = require('./fixtures/crossRoomPk/v2-cross-room-session.json');

describe('cross-room PK Wave 0 product contract', () => {
  it('keeps the existing V1 in-room mapping readable and free of V2 assumptions', () => {
    expect(classifyRoomPkSession(inRoomV1)).toBe('in-room-v1');
    expect(mapRoomPkSession(inRoomV1)).toMatchObject({
      hostUid: 'host-internal-1',
      mode: 'in-room-teams',
      roomId: 'room-internal-1',
      schemaVersion: 1,
      teams: {
        blue: { memberUids: ['member-blue-1'], score: 75 },
        red: { memberUids: ['host-internal-1'], score: 125 },
      },
    });
    expect(mapRoomPkSession(inRoomV1)).not.toHaveProperty('redRoomId');
  });

  it('maps a valid challenge and enforces its 60-second reservation TTL', () => {
    expect(mapCrossRoomPkChallenge(pendingChallengeV1)).toMatchObject({
      challengeId: 'crpk_challenge_fixture_0001',
      challengerRoomId: 'room-red-1',
      expiresAtMs: 2_000_000_060_000,
      opponentRoomId: 'room-blue-1',
      status: 'pending',
    });
    expect(mapCrossRoomPkChallenge({
      ...pendingChallengeV1,
      expiresAtMs: pendingChallengeV1.expiresAtMs + 1,
    })).toBeNull();
  });

  it('maps only strict V2 cross-room sessions with immutable side ordering and shard count', () => {
    expect(classifyRoomPkSession(crossRoomV2)).toBe('cross-room-v2');
    expect(mapCrossRoomPkSession(crossRoomV2)).toMatchObject({
      blueRoomId: 'room-blue-1',
      mode: 'cross-room',
      redRoomId: 'room-red-1',
      roomId: 'room-red-1',
      roomIds: ['room-red-1', 'room-blue-1'],
      schemaVersion: 2,
      scoreShardCount: CROSS_ROOM_PK_SCORE_SHARD_COUNT,
      teams: {
        blue: { authorityUid: 'host-blue-1', roomId: 'room-blue-1' },
        red: { authorityUid: 'host-red-1', roomId: 'room-red-1' },
      },
    });
    expect(mapCrossRoomPkSession(crossRoomV2).teams.red).not.toHaveProperty('memberUids');
    expect(mapCrossRoomPkSession(crossRoomV2).teams.blue).not.toHaveProperty('memberUids');
    expect(mapCrossRoomPkSession({ ...crossRoomV2, roomId: 'room-blue-1' })).toBeNull();
    expect(mapCrossRoomPkSession({ ...crossRoomV2, roomIds: [...crossRoomV2.roomIds].reverse() })).toBeNull();
    expect(mapCrossRoomPkSession({ ...crossRoomV2, scoreShardCount: 8 })).toBeNull();
    expect(mapCrossRoomPkSession({ ...crossRoomV2, purgeAfterMs: 0 })).toBeNull();
    expect(mapCrossRoomPkSession({
      ...crossRoomV2,
      teams: { ...crossRoomV2.teams, red: { ...crossRoomV2.teams.red, score: 1 } },
    })).toBeNull();
  });

  it('rejects V1 unbounded arrays on V2 documents', () => {
    expect(mapCrossRoomPkSession({ ...crossRoomV2, giftEventIds: [] })).toBeNull();
    expect(mapCrossRoomPkSession({ ...crossRoomV2, distinctGifters: [] })).toBeNull();
    expect(mapCrossRoomPkSession({
      ...crossRoomV2,
      teams: { ...crossRoomV2.teams, red: { ...crossRoomV2.teams.red, memberUids: [] } },
    })).toBeNull();
  });

  it('maps an early settlement cutoff without changing the scheduled duration', () => {
    const scoringEndsAtMs = crossRoomV2.startedAtMs + 60_000;
    const mapped = mapCrossRoomPkSession({
      ...crossRoomV2,
      scoringEndsAtMs,
      settleAfterMs: scoringEndsAtMs + CROSS_ROOM_PK_TIMING_MS.ingestionGrace,
      status: 'settling',
    });
    expect(mapped).toMatchObject({
      durationMs: crossRoomV2.durationMs,
      endsAtMs: crossRoomV2.endsAtMs,
      scoringEndsAtMs,
      settleAfterMs: scoringEndsAtMs + CROSS_ROOM_PK_TIMING_MS.ingestionGrace,
    });
    expect(mapCrossRoomPkSession({ ...crossRoomV2, scoringEndsAtMs })).toBeNull();
  });

  it('freezes challenge and session transitions, including idempotent replays', () => {
    for (const terminal of ['accepted', 'declined', 'cancelled', 'expired']) {
      expect(canTransitionCrossRoomPkChallenge('pending', terminal)).toBe(true);
      expect(canTransitionCrossRoomPkChallenge(terminal, terminal)).toBe(true);
      expect(canTransitionCrossRoomPkChallenge(terminal, 'pending')).toBe(false);
    }
    expect(canTransitionCrossRoomPkSession('active', 'settling')).toBe(true);
    expect(canTransitionCrossRoomPkSession('active', 'forfeited')).toBe(true);
    expect(canTransitionCrossRoomPkSession('settling', 'ended')).toBe(true);
    expect(canTransitionCrossRoomPkSession('settling', 'forfeited')).toBe(true);
    expect(canTransitionCrossRoomPkSession('ended', 'active')).toBe(false);
    expect(CROSS_ROOM_PK_CHALLENGE_STATUSES).toHaveLength(5);
    expect(CROSS_ROOM_PK_SESSION_STATUSES).toHaveLength(5);
  });

  it('locks surrender, dual invalidation, and operational termination outcomes', () => {
    expect(resolveCrossRoomPkTermination({ redInvalid: true, reason: 'surrender' })).toEqual({
      endReason: 'surrender', status: 'forfeited', winner: 'blue', winnerReason: 'red_forfeit',
    });
    expect(resolveCrossRoomPkTermination({ blueInvalid: true, reason: 'room_closed' })).toEqual({
      endReason: 'room_closed', status: 'forfeited', winner: 'red', winnerReason: 'blue_forfeit',
    });
    expect(resolveCrossRoomPkTermination({ redInvalid: true, blueInvalid: true })).toEqual({
      endReason: 'both_rooms_invalid', status: 'void', winner: 'void', winnerReason: 'both_rooms_invalid',
    });
    expect(resolveCrossRoomPkTermination({ reason: 'feature_flag_off' })).toEqual({
      endReason: 'feature_flag_off', status: 'settling', winner: null, winnerReason: '',
    });
  });

  it('locks rollback behavior without disabling in-room PK accidentally', () => {
    expect(CROSS_ROOM_PK_ROLLBACK_CONTRACT.crossRoomPkOff).toEqual({
      activeCrossRoom: 'settling',
      activeInRoom: 'preserve',
      pendingCrossRoom: 'cancelled',
      reason: 'feature_flag_off',
    });
    expect(CROSS_ROOM_PK_ROLLBACK_CONTRACT.roomPkOff.activeInRoom).toBe('terminate');
  });

  it('provides stable HTTP and Arabic error copy for every command failure', () => {
    const expectedCodes = [
      'INVALID_REQUEST', 'FEATURE_DISABLED', 'ROOM_NOT_ACTIVE', 'ROOM_NOT_ELIGIBLE',
      'SAME_ROOM_FORBIDDEN', 'MEMBERSHIP_REQUIRED', 'FORBIDDEN', 'BLOCKED_RELATIONSHIP',
      'CHALLENGE_NOT_FOUND', 'CHALLENGE_NOT_PENDING', 'CHALLENGE_EXPIRED',
      'ROOM_ALREADY_RESERVED', 'SESSION_ALREADY_ACTIVE', 'COOLDOWN_ACTIVE',
      'SESSION_NOT_ACTIVE', 'REQUEST_ID_CONFLICT', 'RATE_LIMITED',
    ];
    expect(Object.keys(CROSS_ROOM_PK_ERROR_CONTRACT)).toEqual(expectedCodes);
    for (const code of expectedCodes) {
      const contract = getCrossRoomPkErrorContract(code);
      expect(contract.status).toBeGreaterThanOrEqual(400);
      expect(contract.status).toBeLessThan(600);
      expect(contract.message.length).toBeGreaterThan(3);
      expect(contract.messageAr).toMatch(/[\u0600-\u06ff]/u);
    }
    expect(getCrossRoomPkErrorContract('UNKNOWN')).toBe(CROSS_ROOM_PK_ERROR_CONTRACT.INVALID_REQUEST);
  });

  it('freezes Arabic UI copy, retention, limits, timing, actions, and telemetry names', () => {
    expect(CROSS_ROOM_PK_COPY_AR.settling).toBe('جارٍ اعتماد النتيجة…');
    expect(Object.values(CROSS_ROOM_PK_COPY_AR).every((copy) => /[\u0600-\u06ff]/u.test(copy))).toBe(true);
    expect(CROSS_ROOM_PK_TIMING_MS.ingestionGrace).toBe(15_000);
    expect(CROSS_ROOM_PK_RETENTION_MS.command).toBe(24 * 60 * 60_000);
    expect(CROSS_ROOM_PK_RETENTION_MS.session).toBe(7 * 24 * 60 * 60_000);
    expect(CROSS_ROOM_PK_LIMITS.reconciliationPageSize).toBe(100);
    expect(CROSS_ROOM_PK_LIMITS.maxReconciliationEventsPerRoom).toBe(50_000);
    expect(CROSS_ROOM_PK_ACTIONS).toHaveLength(7);
    const telemetryKeys = Object.values(CROSS_ROOM_PK_TELEMETRY_KEYS);
    expect(new Set(telemetryKeys).size).toBe(telemetryKeys.length);
    expect(telemetryKeys.every((key) => /^cross_room_pk_[a-z0-9_]+$/.test(key))).toBe(true);
    expect(Object.isFrozen(CROSS_ROOM_PK_ERROR_CONTRACT.FEATURE_DISABLED)).toBe(true);
  });
});
