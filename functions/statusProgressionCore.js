'use strict';

const crypto = require('node:crypto');
const {
  MAX_STATUS_POINTS,
  STATUS_SCHEMA_VERSION,
  mapVipAccount,
  mapVipContribution,
  normalizeVipCatalogVersion,
  resolveVipTierForPoints,
} = require('./statusMembershipCore');

const STATUS_SOURCE_KINDS = Object.freeze({
  recharge: 'representative-recharge',
  reversal: 'representative-reversal',
});
const MAX_RECHARGE_COINS = 1_000_000_000;

function representativeRechargeEventId(transferId) {
  const safeId = normalizeSourceId(transferId);
  return safeId ? `representative_${safeId}` : '';
}

function representativeReversalEventId(transferId) {
  const safeId = normalizeSourceId(transferId);
  return safeId ? `representative_reversal_${safeId}` : '';
}

function buildRepresentativeRechargeOutbox({ amount, currency, recipientUid, timestamp, transferId }) {
  if (currency !== 'coins') return null;
  const uid = normalizeUid(recipientUid);
  const sourceId = normalizeSourceId(transferId);
  const eventId = representativeRechargeEventId(sourceId);
  if (!uid || !eventId || !positiveInteger(amount, MAX_RECHARGE_COINS) || !timestamp) return null;
  return {
    refId: eventId,
    data: {
      schemaVersion: STATUS_SCHEMA_VERSION,
      eventId,
      uid,
      sourceKind: STATUS_SOURCE_KINDS.recharge,
      sourceId,
      currency: 'coins',
      amount,
      state: 'queued',
      attempts: 0,
      createdAt: timestamp,
      nextAttemptAt: timestamp,
    },
  };
}

function buildRepresentativeReversalOutbox({ amount, currency, recipientUid, timestamp, transferId }) {
  if (currency !== 'coins') return null;
  const uid = normalizeUid(recipientUid);
  const sourceId = normalizeSourceId(transferId);
  const eventId = representativeReversalEventId(sourceId);
  const reversalOf = representativeRechargeEventId(sourceId);
  if (!uid || !eventId || !reversalOf || !positiveInteger(amount, MAX_RECHARGE_COINS) || !timestamp) return null;
  return {
    refId: eventId,
    data: {
      schemaVersion: STATUS_SCHEMA_VERSION,
      eventId,
      uid,
      sourceKind: STATUS_SOURCE_KINDS.reversal,
      sourceId,
      currency: 'coins',
      amount,
      reversalOf,
      state: 'queued',
      attempts: 0,
      createdAt: timestamp,
      nextAttemptAt: timestamp,
    },
  };
}

function calculateVipPointDelta(amount, sourceKind, pointPolicy) {
  if (!positiveInteger(amount, MAX_RECHARGE_COINS)) return invalid('INVALID_AMOUNT');
  if (!pointPolicy || !positiveInteger(pointPolicy.pointsPerCoinNumerator, 1_000_000)
    || !positiveInteger(pointPolicy.pointsPerCoinDenominator, 1_000_000)) return invalid('INVALID_POINT_POLICY');
  if (!Object.values(STATUS_SOURCE_KINDS).includes(sourceKind)) return invalid('INVALID_SOURCE_KIND');
  const points = (BigInt(amount) * BigInt(pointPolicy.pointsPerCoinNumerator))
    / BigInt(pointPolicy.pointsPerCoinDenominator);
  if (points < 1n) return invalid('ZERO_POINT_EVENT');
  if (points > BigInt(MAX_STATUS_POINTS)) return invalid('POINT_LIMIT_EXCEEDED');
  const value = Number(points);
  return { ok: true, value: sourceKind === STATUS_SOURCE_KINDS.reversal ? -value : value };
}

function buildVipProgressionMutation({ account, catalog, eventId, pointDelta, timestamp, uid }) {
  const normalizedCatalog = normalizeVipCatalogVersion(catalog);
  if (!normalizedCatalog.ok || normalizedCatalog.value.state !== 'published') return invalid('CATALOG_UNAVAILABLE');
  const safeUid = normalizeUid(uid);
  const safeEventId = normalizeEventId(eventId);
  if (!safeUid || !safeEventId || !Number.isSafeInteger(pointDelta) || pointDelta === 0) return invalid('INVALID_MUTATION');
  const mappedAccount = account == null ? null : mapVipAccount(account, safeUid);
  if (account != null && !mappedAccount) return invalid('VIP_AUTHORITY_INVALID');
  if (mappedAccount && mappedAccount.catalogVersion !== normalizedCatalog.value.catalogVersion) {
    return invalid('CATALOG_VERSION_CONFLICT');
  }
  const pointsBefore = mappedAccount?.points || 0;
  const pointsAfter = pointsBefore + pointDelta;
  if (!Number.isSafeInteger(pointsAfter) || pointsAfter < 0 || pointsAfter > MAX_STATUS_POINTS) {
    return invalid(pointsAfter < 0 ? 'OVER_REVERSED' : 'POINT_LIMIT_EXCEEDED');
  }
  const resolved = resolveVipTierForPoints(pointsAfter, normalizedCatalog.value);
  if (!resolved.ok) return resolved;
  const tier = resolved.value.tier;
  const previousOrder = mappedAccount?.order || 0;
  const nextOrder = tier?.order || 0;
  const accountValue = {
    schemaVersion: STATUS_SCHEMA_VERSION,
    uid: safeUid,
    catalogVersion: normalizedCatalog.value.catalogVersion,
    points: pointsAfter,
    levelId: tier?.id || null,
    band: tier?.band || null,
    level: tier?.level || null,
    order: tier?.order || null,
    highestLevelOrder: Math.max(mappedAccount?.highestLevelOrder || 0, nextOrder),
    state: mappedAccount?.state || 'active',
    createdAt: mappedAccount ? account.createdAt : timestamp,
    updatedAt: timestamp,
  };
  const levelChanged = (mappedAccount?.levelId || null) !== (tier?.id || null);
  return {
    ok: true,
    value: {
      account: accountValue,
      pointsBefore,
      pointsAfter,
      transition: levelChanged ? {
        schemaVersion: STATUS_SCHEMA_VERSION,
        transitionId: safeEventId,
        eventId: safeEventId,
        uid: safeUid,
        catalogVersion: normalizedCatalog.value.catalogVersion,
        kind: nextOrder > previousOrder ? 'promotion' : 'demotion',
        fromLevelId: mappedAccount?.levelId || null,
        toLevelId: tier?.id || null,
        pointsBefore,
        pointsAfter,
        createdAt: timestamp,
      } : null,
    },
  };
}

function buildVipMigrationDryRun({ catalog, reversals = [], transfers = [] }) {
  const normalizedCatalog = normalizeVipCatalogVersion(catalog);
  if (!normalizedCatalog.ok || normalizedCatalog.value.state !== 'published') return invalid('CATALOG_UNAVAILABLE');
  const events = [];
  const errors = [];
  const transfersById = new Map();
  for (const row of transfers) {
    const transferId = normalizeSourceId(row?.id);
    const data = row?.data;
    if (!transferId || !validCompletedTransfer(data)) {
      errors.push({ kind: 'invalid-transfer', id: transferId || String(row?.id || '') });
      continue;
    }
    if (transfersById.has(transferId)) {
      errors.push({ kind: 'duplicate-transfer', id: transferId });
      continue;
    }
    transfersById.set(transferId, data);
    if (data.currency !== 'coins') continue;
    const delta = calculateVipPointDelta(data.amount, STATUS_SOURCE_KINDS.recharge, normalizedCatalog.value.pointPolicy);
    if (!delta.ok) {
      errors.push({ kind: 'invalid-transfer-points', id: transferId, code: delta.code });
      continue;
    }
    events.push({
      eventId: representativeRechargeEventId(transferId),
      uid: data.recipientUid,
      sourceId: transferId,
      sourceKind: STATUS_SOURCE_KINDS.recharge,
      amount: data.amount,
      currency: 'coins',
      occurredAtMillis: timestampMillis(data.createdAt),
      pointDelta: delta.value,
    });
  }
  const reversedTransferIds = new Set();
  for (const row of reversals) {
    const transferId = normalizeSourceId(row?.id);
    const data = row?.data;
    const original = transfersById.get(transferId);
    if (!transferId || !validCompletedReversal(data) || !original) {
      errors.push({ kind: original ? 'invalid-reversal' : 'unmatched-reversal', id: transferId || String(row?.id || '') });
      continue;
    }
    if (reversedTransferIds.has(transferId)) {
      errors.push({ kind: 'duplicate-reversal', id: transferId });
      continue;
    }
    if (data.transferId !== transferId || data.amount !== original.amount || data.currency !== original.currency
      || data.recipientUid !== original.recipientUid) {
      errors.push({ kind: 'reversal-mismatch', id: transferId });
      continue;
    }
    reversedTransferIds.add(transferId);
    if (data.currency !== 'coins') continue;
    const delta = calculateVipPointDelta(data.amount, STATUS_SOURCE_KINDS.reversal, normalizedCatalog.value.pointPolicy);
    if (!delta.ok) {
      errors.push({ kind: 'invalid-reversal-points', id: transferId, code: delta.code });
      continue;
    }
    events.push({
      eventId: representativeReversalEventId(transferId),
      uid: data.recipientUid,
      sourceId: transferId,
      sourceKind: STATUS_SOURCE_KINDS.reversal,
      reversalOf: representativeRechargeEventId(transferId),
      amount: data.amount,
      currency: 'coins',
      occurredAtMillis: timestampMillis(data.createdAt),
      pointDelta: delta.value,
    });
  }
  events.sort((left, right) => left.eventId.localeCompare(right.eventId));
  errors.sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`));
  const pointTotals = new Map();
  for (const event of events) pointTotals.set(event.uid, (pointTotals.get(event.uid) || 0) + event.pointDelta);
  const pointsByUid = Object.fromEntries([...pointTotals.entries()].sort(([left], [right]) => left.localeCompare(right)));
  const snapshot = {
    schemaVersion: STATUS_SCHEMA_VERSION,
    catalogVersion: normalizedCatalog.value.catalogVersion,
    eventCount: events.length,
    positiveEventCount: events.filter((event) => event.pointDelta > 0).length,
    reversalEventCount: events.filter((event) => event.pointDelta < 0).length,
    userCount: pointTotals.size,
    signedPointTotal: events.reduce((sum, event) => sum + event.pointDelta, 0),
    pointsByUid,
    errors,
    events,
  };
  return {
    ok: true,
    value: {
      ...snapshot,
      clean: errors.length === 0,
      snapshotHash: crypto.createHash('sha256').update(stableJson(snapshot)).digest('hex'),
    },
  };
}

function buildVipReconciliationReport({ accounts = [], catalog, contributions = [], truncated = false }) {
  const normalizedCatalog = normalizeVipCatalogVersion(catalog);
  if (!normalizedCatalog.ok || normalizedCatalog.value.state !== 'published') return invalid('CATALOG_UNAVAILABLE');
  const errors = [];
  const totals = new Map();
  const reversalLinks = new Set();
  const validContributions = new Map();
  for (const row of contributions) {
    const eventId = normalizeEventId(row?.id);
    const contribution = eventId ? mapVipContribution(row?.data, eventId) : null;
    if (!contribution || contribution.policyVersion !== normalizedCatalog.value.catalogVersion) {
      errors.push({ kind: 'invalid-contribution', id: eventId || String(row?.id || '') });
      continue;
    }
    validContributions.set(eventId, contribution);
    if (contribution.kind === STATUS_SOURCE_KINDS.reversal) {
      if (reversalLinks.has(contribution.reversalOf)) {
        errors.push({ kind: 'duplicate-reversal-link', id: eventId });
        continue;
      }
      reversalLinks.add(contribution.reversalOf);
    }
    totals.set(contribution.uid, (totals.get(contribution.uid) || 0) + contribution.pointDelta);
  }
  for (const contribution of validContributions.values()) {
    if (contribution.kind !== STATUS_SOURCE_KINDS.reversal) continue;
    const original = validContributions.get(contribution.reversalOf);
    if (!original || original.kind !== STATUS_SOURCE_KINDS.recharge || original.uid !== contribution.uid
      || original.sourceId !== contribution.sourceId || original.policyVersion !== contribution.policyVersion
      || original.pointDelta !== Math.abs(contribution.pointDelta)) {
      errors.push({ kind: 'invalid-reversal-link', id: contribution.eventId });
    }
  }
  const accountsByUid = new Map(accounts.map((row) => [row.id, row.data]));
  const uids = [...new Set([...totals.keys(), ...accountsByUid.keys()])].sort();
  const mismatches = [];
  const expectedLevelDistribution = {};
  const currentLevelDistribution = {};
  for (const uid of uids) {
    const points = totals.get(uid) || 0;
    if (!Number.isSafeInteger(points) || points < 0) {
      errors.push({ kind: 'invalid-net-points', uid });
      continue;
    }
    const current = accountsByUid.has(uid) ? mapVipAccount(accountsByUid.get(uid), uid) : null;
    const resolved = resolveVipTierForPoints(points, normalizedCatalog.value);
    const expectedLevelId = resolved.value.tier?.id || 'none';
    expectedLevelDistribution[expectedLevelId] = (expectedLevelDistribution[expectedLevelId] || 0) + 1;
    const currentLevelId = current?.levelId || 'none';
    currentLevelDistribution[currentLevelId] = (currentLevelDistribution[currentLevelId] || 0) + 1;
    const expected = {
      points,
      catalogVersion: normalizedCatalog.value.catalogVersion,
      levelId: resolved.value.tier?.id || null,
      order: resolved.value.tier?.order || null,
    };
    if (!current || current.points !== expected.points || current.catalogVersion !== expected.catalogVersion
      || current.levelId !== expected.levelId || current.order !== expected.order) {
      mismatches.push({ uid, current: current ? {
        points: current.points, catalogVersion: current.catalogVersion, levelId: current.levelId, order: current.order,
      } : null, expected });
    }
  }
  return {
    ok: true,
    value: {
      clean: !truncated && errors.length === 0 && mismatches.length === 0,
      truncated,
      contributionCount: contributions.length,
      accountCount: accounts.length,
      userCount: uids.length,
      signedPointTotal: [...totals.values()].reduce((sum, points) => sum + points, 0),
      expectedLevelDistribution,
      currentLevelDistribution,
      errors,
      mismatches,
    },
  };
}

function validCompletedTransfer(data) {
  return data && data.status === 'completed' && normalizeUid(data.recipientUid)
    && positiveInteger(data.amount, MAX_RECHARGE_COINS) && ['coins', 'diamonds'].includes(data.currency)
    && timestampMillis(data.createdAt) > 0;
}

function validCompletedReversal(data) {
  return data && data.status === 'completed' && normalizeUid(data.recipientUid)
    && normalizeSourceId(data.transferId)
    && positiveInteger(data.amount, MAX_RECHARGE_COINS) && ['coins', 'diamonds'].includes(data.currency)
    && timestampMillis(data.createdAt) > 0;
}

function normalizeUid(value) {
  const uid = typeof value === 'string' ? value.trim() : '';
  return uid.length >= 1 && uid.length <= 128 && !/[\/\u0000-\u001F\u007F]/.test(uid) ? uid : '';
}

function normalizeSourceId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  return safeDocumentId(id, 256) ? id : '';
}

function normalizeEventId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  return safeDocumentId(id, 320) ? id : '';
}

function safeDocumentId(value, maxLength) {
  return value.length >= 3 && value.length <= maxLength && value !== '.' && value !== '..'
    && !/[\/\u0000-\u001F\u007F]/.test(value);
}

function timestampMillis(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value.toDate === 'function') return value.toDate().getTime();
  return Number.NaN;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function positiveInteger(value, max) {
  return Number.isSafeInteger(value) && value >= 1 && value <= max;
}

function invalid(code) {
  return { ok: false, code };
}

module.exports = {
  MAX_RECHARGE_COINS,
  STATUS_SOURCE_KINDS,
  buildRepresentativeRechargeOutbox,
  buildRepresentativeReversalOutbox,
  buildVipMigrationDryRun,
  buildVipProgressionMutation,
  buildVipReconciliationReport,
  calculateVipPointDelta,
  representativeRechargeEventId,
  representativeReversalEventId,
  stableJson,
  validCompletedReversal,
  validCompletedTransfer,
};
