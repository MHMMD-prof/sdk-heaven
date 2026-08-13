import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  DEFAULT_DURATION_MS,
  MAX_DURATION_MS,
  MIN_DISTINCT_GIFTERS_FOR_VALID,
  MIN_DURATION_MS,
  applyPkGiftScore,
  buildCrossRoomPkChallenge,
  buildCrossRoomPkScoreShards,
  buildCrossRoomPkSession,
  clampPkDurationMs,
  createCrossRoomPkChallengeId,
  createCrossRoomPkSessionId,
  createRoomPkSessionId,
  isCrossRoomPkEligibleRoom,
  isCrossRoomPkPairInRollout,
  isPkSessionActive,
  mapRoomPkSession,
  normalizeRoomPkBody,
  resolvePkWinner,
  validateRoomPkRequest,
} = require('./roomPkCore');

const requestId = 'roompk_request_000001';
const roomId = 'room-pk-1';
const nowMs = 2_000_000_000_000;

describe('roomPkCore', () => {
  it('validates commands and requires a team for join', () => {
    expect(validateRoomPkRequest(normalizeRoomPkBody({
      action: 'get-room-pk-status',
      requestId,
      roomId,
    })).ok).toBe(true);

    expect(validateRoomPkRequest(normalizeRoomPkBody({
      action: 'join-room-pk-team',
      requestId,
      roomId,
      team: 'green',
    })).error.code).toBe('INVALID_REQUEST');

    expect(validateRoomPkRequest(normalizeRoomPkBody({
      action: 'join-room-pk-team',
      requestId,
      roomId,
      team: 'blue',
    })).ok).toBe(true);

    expect(validateRoomPkRequest(normalizeRoomPkBody({
      action: 'start-room-pk',
      requestId: 'short',
      roomId,
    })).error.code).toBe('INVALID_REQUEST');
  });

  it('clamps duration between min and max with a default midpoint', () => {
    expect(clampPkDurationMs(undefined)).toBe(DEFAULT_DURATION_MS);
    expect(clampPkDurationMs(1_000)).toBe(MIN_DURATION_MS);
    expect(clampPkDurationMs(999_999_999)).toBe(MAX_DURATION_MS);
    expect(clampPkDurationMs(180_000)).toBe(180_000);

    const normalized = validateRoomPkRequest(normalizeRoomPkBody({
      action: 'start-room-pk',
      durationMs: 5_000,
      requestId,
      roomId,
    }));
    expect(normalized.ok).toBe(true);
    expect(normalized.value.durationMs).toBe(MIN_DURATION_MS);
  });

  it('resolves winners including anti-farm void when distinct gifters are unmet', () => {
    expect(resolvePkWinner({
      blueScore: 10,
      distinctGifters: ['u1'],
      minDistinct: MIN_DISTINCT_GIFTERS_FOR_VALID,
      redScore: 100,
    })).toEqual({
      reason: 'insufficient_distinct_gifters',
      winner: 'void',
    });

    expect(resolvePkWinner({
      blueScore: 40,
      distinctGifters: ['u1', 'u2'],
      redScore: 100,
    })).toEqual({
      reason: 'higher_score',
      winner: 'red',
    });

    expect(resolvePkWinner({
      blueScore: 50,
      distinctGifters: ['u1', 'u2'],
      redScore: 50,
    })).toEqual({
      reason: 'tied_score',
      winner: 'draw',
    });
  });

  it('applies gift scores idempotently and rejects duplicate event ids', () => {
    const session = mapRoomPkSession({
      distinctGifters: [],
      durationMs: DEFAULT_DURATION_MS,
      endsAtMs: nowMs + DEFAULT_DURATION_MS,
      giftEventIds: [],
      hostUid: 'host-1',
      mode: 'in-room-teams',
      pkId: createRoomPkSessionId(requestId, roomId),
      roomId,
      schemaVersion: 1,
      startedAtMs: nowMs,
      status: 'active',
      teams: {
        blue: { labelAr: 'الأزرق', memberUids: ['blue-1'], score: 0 },
        red: { labelAr: 'الأحمر', memberUids: ['red-1'], score: 0 },
      },
      winner: null,
      winnerReason: '',
    });

    expect(isPkSessionActive(session, nowMs)).toBe(true);

    const first = applyPkGiftScore({
      eventId: 'gift-event-1',
      nowMs,
      priceCoins: 25,
      session,
      team: 'red',
      uid: 'gifter-1',
    });
    expect(first).toMatchObject({
      duplicate: false,
      ok: true,
      session: {
        distinctGifters: ['gifter-1'],
        giftEventIds: ['gift-event-1'],
        teams: {
          red: { score: 25 },
        },
      },
    });

    const duplicate = applyPkGiftScore({
      eventId: 'gift-event-1',
      nowMs,
      priceCoins: 25,
      session: { ...session, ...first.session },
      team: 'red',
      uid: 'gifter-1',
    });
    expect(duplicate).toMatchObject({
      duplicate: true,
      ok: true,
      session: null,
    });
  });

  it('builds stable short session ids from request and room', () => {
    const first = createRoomPkSessionId(requestId, roomId);
    const second = createRoomPkSessionId(requestId, roomId);
    expect(first).toBe(second);
    expect(first.startsWith('rpk_')).toBe(true);
    expect(first.length).toBeLessThanOrEqual(28);
  });

  it('normalizes and validates every Wave 1 cross-room command shape', () => {
    expect(validateRoomPkRequest(normalizeRoomPkBody({
      action: 'challenge-cross-room-pk',
      clientVersion: '1.0.0',
      opponentRoomId: 'room-pk-2',
      requestId,
      roomId,
    }))).toMatchObject({ ok: true, value: { mode: 'cross-room' } });
    expect(validateRoomPkRequest(normalizeRoomPkBody({
      action: 'challenge-cross-room-pk',
      clientVersion: '1.0.0',
      opponentRoomId: roomId,
      requestId,
      roomId,
    })).code).toBe('SAME_ROOM_FORBIDDEN');
    for (const action of ['accept-cross-room-pk', 'decline-cross-room-pk', 'cancel-cross-room-pk']) {
      expect(validateRoomPkRequest(normalizeRoomPkBody({
        action,
        challengeId: 'crpkc_challenge_000001',
        clientVersion: '1.0.0',
        requestId,
        roomId,
      })).ok).toBe(true);
    }
    expect(validateRoomPkRequest(normalizeRoomPkBody({
      action: 'surrender-cross-room-pk',
      clientVersion: '1.0.0',
      pkId: 'crpks_session_00000001',
      requestId,
      roomId,
    })).ok).toBe(true);
  });

  it('builds deterministic challenge/session contracts and exactly 32 shards', () => {
    const red = eligibleRoom('room-red-1', 'host-red-1', 'Red Room');
    const blue = eligibleRoom('room-blue-1', 'host-blue-1', 'Blue Room');
    const challenge = buildCrossRoomPkChallenge({
      challengerAuthorityUid: 'host-red-1',
      challengerRoom: red,
      durationMs: 180_000,
      nowMs,
      opponentRoom: blue,
      requestId,
    });
    expect(challenge.challengeId).toBe(createCrossRoomPkChallengeId(requestId, red.id, blue.id));
    const session = buildCrossRoomPkSession({
      acceptedByUid: 'host-blue-1',
      blueAuthorityUid: 'host-blue-1',
      challenge,
      nowMs,
      redAuthorityUid: 'host-red-1',
    });
    expect(session.pkId).toBe(createCrossRoomPkSessionId(challenge.challengeId));
    expect(mapRoomPkSession(session)).toMatchObject({
      mode: 'cross-room', roomIds: ['room-red-1', 'room-blue-1'], schemaVersion: 2,
    });
    const shards = buildCrossRoomPkScoreShards(session);
    expect(shards).toHaveLength(32);
    expect(new Set(shards.map((shard) => shard.shardId)).size).toBe(32);
    expect(shards.every((shard) => shard.score === 0 && shard.giftCount === 0)).toBe(true);
  });

  it('fails room eligibility and rollout closed while keeping pair hashing symmetric', () => {
    const red = eligibleRoom('room-red-1', 'host-red-1', 'Red Room');
    const blue = eligibleRoom('room-blue-1', 'host-blue-1', 'Blue Room');
    expect(isCrossRoomPkEligibleRoom(red)).toBe(true);
    expect(isCrossRoomPkEligibleRoom({ ...red, visibility: 'private' })).toBe(false);
    expect(isCrossRoomPkEligibleRoom({ ...red, activeWatchLeaseId: 'watch-1' })).toBe(false);
    expect(isCrossRoomPkPairInRollout({
      challengerAuthorityUid: 'host-red-1', challengerRoom: red,
      opponentAuthorityUid: 'host-blue-1', opponentRoom: blue,
      policy: { schemaVersion: 1, stage: 'dark' },
    })).toBe(false);
    const publicPolicy = { schemaVersion: 1, stage: 'public', percentageBasisPoints: 5_000 };
    const forward = isCrossRoomPkPairInRollout({
      challengerAuthorityUid: 'host-red-1', challengerRoom: red,
      opponentAuthorityUid: 'host-blue-1', opponentRoom: blue, policy: publicPolicy,
    });
    const reverse = isCrossRoomPkPairInRollout({
      challengerAuthorityUid: 'host-blue-1', challengerRoom: blue,
      opponentAuthorityUid: 'host-red-1', opponentRoom: red, policy: publicPolicy,
    });
    expect(forward).toBe(reverse);
  });
});

function eligibleRoom(id, ownerUid, title) {
  return {
    availability: 'active',
    countryCode: 'IQ',
    hostDisplayName: ownerUid,
    hostId: ownerUid,
    id,
    ownerUid,
    participantCount: 1,
    schemaVersion: 2,
    status: 'active',
    title,
    type: 'voice',
    visibility: 'public',
  };
}
