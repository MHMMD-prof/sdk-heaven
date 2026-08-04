const { readPublicAvatarFrameProjection } = require('./avatarFrameProjectionCore');
const {
  applyRoomSupportAggregate,
  applyRoomSupportShard,
  buildRoomSupportExpectedState,
  createRoomGiftSourceFingerprint,
  createLeaderboardRefreshId,
  createRoomSupportLeaderboard,
  createRoomSupportPeriod,
  createRoomSupportProjectionFact,
  createRoomSupportShardId,
  sumRoomSupportShards,
} = require('./roomSupportProjectionCore');
const { timestampToMillis } = require('./weeklyIncentiveCore');
const { retentionDeadlineMillis } = require('./weeklyIncentiveIntegrityCore');

const PROJECTION_BATCH_LIMIT = 200;
const LEADERBOARD_REFRESH_LIMIT = 100;
const RECONCILIATION_PERIOD_LIMIT = 5;
const RECONCILIATION_FACT_LIMIT = 5000;

async function projectCommittedRoomGift({
  clock,
  db,
  event,
  fieldValue,
  roomId,
  timeZone,
}) {
  if (!event || event.roomId !== roomId || !event.eventId) return { errorCode: 'INVALID_GIFT_FACT' };
  const sourceFingerprint = createRoomGiftSourceFingerprint(event);
  if (!sourceFingerprint) return { errorCode: 'INVALID_GIFT_FACT' };
  return db.runTransaction(async (transaction) => {
    const featureRef = db.doc('appConfig/voiceRoomFeatures');
    const roomRef = db.doc(`rooms/${roomId}`);
    const factRef = db.doc(`canonicalRoomGiftFacts/${event.eventId}`);
    const [featureSnapshot, roomSnapshot, existingFact] = await Promise.all([
      transaction.get(featureRef),
      transaction.get(roomRef),
      transaction.get(factRef),
    ]);
    if (existingFact.exists) {
      const previous = existingFact.data();
      return previous.eventId === event.eventId
        && previous.roomId === roomId
        && previous.sourceFingerprint === sourceFingerprint
        ? { fact: previous, replayed: true }
        : { errorCode: 'PROJECTION_CONFLICT' };
    }
    if (
      featureSnapshot.data()?.voice_room_supporter_rankings !== true
      && featureSnapshot.data()?.voice_room_owner_targets !== true
    ) {
      return { skipped: true, reason: 'feature-disabled' };
    }
    const projection = createRoomSupportProjectionFact(event, {
      roomFallback: roomSnapshot.exists ? roomSnapshot.data() : undefined,
      ...(timeZone ? { timeZone } : {}),
    });
    if (!projection.ok) return { skipped: true, reason: projection.code };
    const fact = { ...projection.value, timeZone: timeZone || 'Asia/Baghdad' };
    const periods = ['day', 'week'].map((periodType) => createRoomSupportPeriod({ fact, periodType }));
    if (periods.some((period) => !period)) return { errorCode: 'INVALID_PERIOD' };

    const shardId = createRoomSupportShardId(fact.eventId);
    const periodRefs = periods.map((period) => ({
      aggregate: db.doc(`rooms/${roomId}/supportPeriods/${period.periodId}/supporters/${fact.senderUid}`),
      metadata: db.doc(`roomSupportPeriods/${period.periodKey}`),
      period,
      refresh: db.doc(`roomSupportLeaderboardRefreshes/${createLeaderboardRefreshId(fact.eventId, period.periodKey)}`),
      shard: db.doc(`rooms/${roomId}/supportPeriods/${period.periodId}/shards/${shardId}`),
    }));
    const periodSnapshots = await Promise.all(periodRefs.flatMap((refs) => [
      transaction.get(refs.metadata),
      transaction.get(refs.aggregate),
      transaction.get(refs.shard),
    ]));
    const timestamp = fieldValue.serverTimestamp();
    const occurredAt = clock.timestampFromMillis(fact.occurredAtMillis);
    transaction.create(factRef, {
      ...fact,
      dayEndAt: clock.timestampFromMillis(fact.dayEndAtMillis),
      dayStartAt: clock.timestampFromMillis(fact.dayStartAtMillis),
      occurredAt,
      periodIds: [fact.dayId, fact.weekId],
      projectedAt: timestamp,
      purgeAfter: clock.timestampFromMillis(retentionDeadlineMillis(
        'canonicalRoomGiftFacts',
        fact.occurredAtMillis,
      )),
      sourceFingerprint,
      weekEndAt: clock.timestampFromMillis(fact.weekEndAtMillis),
      weekStartAt: clock.timestampFromMillis(fact.weekStartAtMillis),
    });

    for (let index = 0; index < periodRefs.length; index += 1) {
      const refs = periodRefs[index];
      const metadataSnapshot = periodSnapshots[index * 3];
      const aggregateSnapshot = periodSnapshots[index * 3 + 1];
      const shardSnapshot = periodSnapshots[index * 3 + 2];
      const aggregate = applyRoomSupportAggregate(
        aggregateSnapshot.exists ? aggregateSnapshot.data() : undefined,
        fact,
        refs.period,
      );
      const shard = applyRoomSupportShard(
        shardSnapshot.exists ? shardSnapshot.data() : undefined,
        fact,
        refs.period,
        shardId,
      );
      if (!aggregate.ok || !shard.ok) return { errorCode: aggregate.code || shard.code };
      if (!metadataSnapshot.exists) {
        transaction.create(refs.metadata, {
          createdAt: timestamp,
          endAt: clock.timestampFromMillis(refs.period.endAtMillis),
          periodId: refs.period.periodId,
          periodKey: refs.period.periodKey,
          periodType: refs.period.periodType,
          projectionVersion: fact.projectionVersion,
          roomId,
          startAt: clock.timestampFromMillis(refs.period.startAtMillis),
          state: 'active',
          timeZone: refs.period.timeZone,
          updatedAt: timestamp,
        });
      }
      transaction.set(refs.aggregate, {
        ...aggregate.value,
        firstContributionAt: clock.timestampFromMillis(aggregate.value.firstContributionAtMillis),
        lastContributionAt: clock.timestampFromMillis(aggregate.value.lastContributionAtMillis),
        updatedAt: timestamp,
      });
      transaction.set(refs.shard, { ...shard.value, updatedAt: timestamp });
      transaction.create(refs.refresh, {
        createdAt: timestamp,
        eventId: fact.eventId,
        periodId: refs.period.periodId,
        periodKey: refs.period.periodKey,
        refreshId: refs.refresh.id,
        roomId,
        state: 'queued',
        updatedAt: timestamp,
      });
    }
    return { fact, replayed: false };
  });
}

async function materializeRoomSupportLeaderboard({
  clock,
  db,
  fieldValue,
  periodKey,
}) {
  const periodSnapshot = await db.doc(`roomSupportPeriods/${periodKey}`).get();
  if (!periodSnapshot.exists) return { errorCode: 'PERIOD_NOT_FOUND' };
  const periodData = periodSnapshot.data();
  const period = mapStoredPeriod(periodData);
  if (!period) return { errorCode: 'PERIOD_INVALID' };
  const periodPath = `rooms/${period.roomId}/supportPeriods/${period.periodId}`;
  const [supporterSnapshot, shardSnapshot] = await Promise.all([
    db.collection(`${periodPath}/supporters`)
      .orderBy('eligibleSpendCoins', 'desc')
      .orderBy('firstContributionAt', 'asc')
      .orderBy('uid', 'asc')
      .limit(20)
      .get(),
    db.collection(`${periodPath}/shards`).get(),
  ]);
  const profiles = supporterSnapshot.docs.length
    ? await db.getAll(...supporterSnapshot.docs.map((document) => db.doc(`publicProfiles/${document.id}`)))
    : [];
  const candidates = supporterSnapshot.docs.map((document, index) => {
    const profile = profiles[index]?.exists ? profiles[index].data() : undefined;
    return {
      ...document.data(),
      avatarLabel: profile?.avatarLabel,
      avatarFrame: readPublicAvatarFrameProjection(profile),
      avatarUrl: profile?.avatarUrl,
      displayName: profile?.displayName || document.data().displayNameSnapshot,
    };
  });
  const totals = sumRoomSupportShards(shardSnapshot.docs.map((document) => document.data()));
  const leaderboard = createRoomSupportLeaderboard(candidates, {
    generatedAtMillis: clock.nowMillis(),
    period,
    totals,
  });
  if (!leaderboard.ok) return { errorCode: leaderboard.code };
  const timestamp = fieldValue.serverTimestamp();
  await db.doc(`rooms/${period.roomId}/supportLeaderboards/${period.periodId}`).set({
    ...leaderboard.value,
    entries: leaderboard.value.entries.map((entry) => ({
      ...entry,
      firstContributionAt: clock.timestampFromMillis(entry.firstContributionAtMillis),
    })),
    generatedAt: timestamp,
    purgeAfter: clock.timestampFromMillis(retentionDeadlineMillis(
      'roomSupportLeaderboards',
      period.endAtMillis,
    )),
  });
  return { leaderboard: leaderboard.value };
}

async function processRoomSupportLeaderboardRefreshes({
  clock,
  db,
  fieldValue,
  limit = LEADERBOARD_REFRESH_LIMIT,
}) {
  const feature = await db.doc('appConfig/voiceRoomFeatures').get();
  if (feature.data()?.voice_room_supporter_rankings !== true) {
    return { processed: 0, reason: 'feature-disabled', scanned: 0 };
  }
  const snapshot = await db.collection('roomSupportLeaderboardRefreshes')
    .where('state', '==', 'queued')
    .orderBy('refreshId')
    .limit(Math.min(Math.max(limit, 1), LEADERBOARD_REFRESH_LIMIT))
    .get();
  const groups = new Map();
  for (const document of snapshot.docs) {
    const data = document.data();
    if (!groups.has(data.periodKey)) groups.set(data.periodKey, []);
    groups.get(data.periodKey).push(document);
  }
  let processed = 0;
  const failures = [];
  for (const [periodKey, documents] of groups) {
    const result = await materializeRoomSupportLeaderboard({ clock, db, fieldValue, periodKey });
    if (result.errorCode) {
      failures.push({ errorCode: result.errorCode, periodKey });
      continue;
    }
    const batch = db.batch();
    for (const document of documents) {
      batch.update(document.ref, {
        processedAt: fieldValue.serverTimestamp(),
        state: 'processed',
        updatedAt: fieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    processed += documents.length;
  }
  return { failures, processed, scanned: snapshot.size };
}

async function reconcileRoomGiftProjectionBatch({
  clock,
  cursor = '',
  db,
  documentIdField = '__name__',
  fieldValue,
  limit = PROJECTION_BATCH_LIMIT,
  projectFact,
}) {
  let query = db.collectionGroup('giftEvents').orderBy(documentIdField);
  if (cursor) query = query.startAfter(cursor);
  const snapshot = await query.limit(Math.min(Math.max(limit, 1), PROJECTION_BATCH_LIMIT)).get();
  const results = [];
  for (const document of snapshot.docs) {
    const event = document.data();
    const roomId = event.roomId || document.ref.parent.parent?.id || '';
    const result = await projectCommittedRoomGift({ clock, db, event, fieldValue, roomId });
    if (result.fact && typeof projectFact === 'function') {
      const secondary = await projectFact(result.fact);
      if (secondary?.errorCode) result.secondaryErrorCode = secondary.errorCode;
    }
    results.push({ eventId: document.id, ...result });
  }
  return {
    nextCursor: snapshot.docs.length === limit ? snapshot.docs.at(-1).ref.path : '',
    projected: results.filter((result) => result.replayed === false).length,
    replayed: results.filter((result) => result.replayed === true).length,
    results,
    scanned: snapshot.size,
  };
}

async function reconcileRoomSupportPeriod({
  apply = false,
  clock,
  db,
  fieldValue,
  periodKey,
}) {
  const periodSnapshot = await db.doc(`roomSupportPeriods/${periodKey}`).get();
  const period = periodSnapshot.exists ? mapStoredPeriod(periodSnapshot.data()) : undefined;
  if (!period) return { errorCode: 'PERIOD_NOT_FOUND' };
  const factsSnapshot = await db.collection('canonicalRoomGiftFacts')
    .where('roomId', '==', period.roomId)
    .where('periodIds', 'array-contains', period.periodId)
    .limit(RECONCILIATION_FACT_LIMIT)
    .get();
  if (factsSnapshot.size === RECONCILIATION_FACT_LIMIT) {
    return { errorCode: 'PERIOD_TOO_LARGE', incomplete: true };
  }
  const periodPath = `rooms/${period.roomId}/supportPeriods/${period.periodId}`;
  const [supportersSnapshot, shardsSnapshot] = await Promise.all([
    db.collection(`${periodPath}/supporters`).get(),
    db.collection(`${periodPath}/shards`).get(),
  ]);
  const expected = buildRoomSupportExpectedState(
    factsSnapshot.docs.map((document) => document.data()),
    period,
  );
  if (!expected.ok) return { errorCode: expected.code };
  const supporterDrift = compareProjectionMaps(
    expected.value.supporters,
    new Map(supportersSnapshot.docs.map((document) => [document.id, document.data()])),
    ['eligibleSpendCoins', 'firstContributionAtMillis', 'giftCount', 'lastContributionAtMillis', 'supportPoints'],
  );
  const shardDrift = compareProjectionMaps(
    expected.value.shards,
    new Map(shardsSnapshot.docs.map((document) => [document.id, document.data()])),
    ['eligibleSpendCoins', 'giftCount', 'supportPoints'],
  );
  const report = {
    balanced: supporterDrift.length === 0 && shardDrift.length === 0,
    factCount: factsSnapshot.size,
    periodKey,
    shardDrift,
    supporterDrift,
    totals: expected.value.totals,
  };
  if (!apply) return report;
  if (report.balanced) {
    await db.doc(`roomSupportPeriods/${periodKey}`).set({
      lastReconciledAt: fieldValue.serverTimestamp(),
      lastReconciliationFactCount: factsSnapshot.size,
      updatedAt: fieldValue.serverTimestamp(),
    }, { merge: true });
    return { ...report, reconciled: true };
  }

  const operations = [];
  const expectedSupporterIds = new Set(expected.value.supporters.keys());
  const expectedShardIds = new Set(expected.value.shards.keys());
  for (const [uid, aggregate] of expected.value.supporters) {
    operations.push({
      data: {
        ...aggregate,
        firstContributionAt: clock.timestampFromMillis(aggregate.firstContributionAtMillis),
        lastContributionAt: clock.timestampFromMillis(aggregate.lastContributionAtMillis),
        reconciledAt: fieldValue.serverTimestamp(),
      },
      kind: 'set',
      ref: db.doc(`${periodPath}/supporters/${uid}`),
    });
  }
  for (const [shardId, shard] of expected.value.shards) {
    operations.push({
      data: { ...shard, reconciledAt: fieldValue.serverTimestamp() },
      kind: 'set',
      ref: db.doc(`${periodPath}/shards/${shardId}`),
    });
  }
  for (const document of supportersSnapshot.docs) {
    if (!expectedSupporterIds.has(document.id)) operations.push({ kind: 'delete', ref: document.ref });
  }
  for (const document of shardsSnapshot.docs) {
    if (!expectedShardIds.has(document.id)) operations.push({ kind: 'delete', ref: document.ref });
  }
  for (let offset = 0; offset < operations.length; offset += 400) {
    const batch = db.batch();
    for (const operation of operations.slice(offset, offset + 400)) {
      if (operation.kind === 'delete') batch.delete(operation.ref);
      else batch.set(operation.ref, operation.data);
    }
    await batch.commit();
  }
  await db.doc(`roomSupportPeriods/${periodKey}`).set({
    lastReconciledAt: fieldValue.serverTimestamp(),
    lastReconciliationFactCount: factsSnapshot.size,
    updatedAt: fieldValue.serverTimestamp(),
  }, { merge: true });
  await materializeRoomSupportLeaderboard({ clock, db, fieldValue, periodKey });
  return { ...report, repaired: true };
}

async function reconcileRoomSupportPeriodsBatch({
  clock,
  cursor = '',
  db,
  fieldValue,
  limit = RECONCILIATION_PERIOD_LIMIT,
}) {
  let query = db.collection('roomSupportPeriods').orderBy('periodKey');
  if (cursor) query = query.startAfter(cursor);
  const snapshot = await query.limit(Math.min(Math.max(limit, 1), RECONCILIATION_PERIOD_LIMIT)).get();
  const reports = [];
  for (const document of snapshot.docs) {
    reports.push(await reconcileRoomSupportPeriod({
      apply: timestampToMillis(document.data()?.endAt) + 60_000 <= clock.nowMillis(),
      clock,
      db,
      fieldValue,
      periodKey: document.id,
    }));
  }
  return {
    nextCursor: snapshot.docs.length === limit ? snapshot.docs.at(-1).id : '',
    reports,
    scanned: snapshot.size,
  };
}

function mapStoredPeriod(data) {
  if (
    !data
    || !data.periodId
    || !data.periodKey
    || !['day', 'week'].includes(data.periodType)
    || !data.roomId
  ) return undefined;
  return {
    endAtMillis: timestampToMillis(data.endAt),
    periodId: data.periodId,
    periodKey: data.periodKey,
    periodType: data.periodType,
    roomId: data.roomId,
    startAtMillis: timestampToMillis(data.startAt),
    timeZone: data.timeZone,
  };
}

function compareProjectionMaps(expected, actual, numericFields) {
  const drift = [];
  for (const [id, value] of expected) {
    const current = actual.get(id);
    if (!current || numericFields.some((field) => readComparable(current, field) !== readComparable(value, field))) {
      drift.push({ id, kind: current ? 'mismatch' : 'missing' });
    }
  }
  for (const id of actual.keys()) if (!expected.has(id)) drift.push({ id, kind: 'extra' });
  return drift;
}

function readComparable(value, field) {
  if (field.endsWith('AtMillis')) {
    const timestampField = field.replace('Millis', '');
    return timestampToMillis(value?.[timestampField]) || value?.[field] || 0;
  }
  return value?.[field] || 0;
}

module.exports = {
  LEADERBOARD_REFRESH_LIMIT,
  PROJECTION_BATCH_LIMIT,
  RECONCILIATION_FACT_LIMIT,
  RECONCILIATION_PERIOD_LIMIT,
  materializeRoomSupportLeaderboard,
  processRoomSupportLeaderboardRefreshes,
  projectCommittedRoomGift,
  reconcileRoomGiftProjectionBatch,
  reconcileRoomSupportPeriod,
  reconcileRoomSupportPeriodsBatch,
};
