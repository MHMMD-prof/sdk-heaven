const crypto = require('node:crypto');

const INTEGRITY_SCHEMA_VERSION = 1;
const RAPID_PASS_THROUGH_WINDOW_MS = 10 * 60 * 1000;
const MAX_ANALYSIS_FACTS = 500;
const RISK_SEVERITY_SCORE = Object.freeze({
  low: 10,
  medium: 35,
  high: 70,
  critical: 100,
});
const RETENTION_POLICY_V1 = Object.freeze({
  adminAuditEvents: { days: 365, mode: 'delete' },
  attendanceDeviceEnrollments: { days: 180, mode: 'inactive-only' },
  canonicalRoomGiftFacts: { days: 730, mode: 'delete' },
  incentiveReconciliationReports: { days: 730, mode: 'delete' },
  roomAttendanceIntervals: { days: 180, mode: 'delete' },
  roomSupportLeaderboards: { days: 90, mode: 'delete' },
  rewardEntitlementTransactions: { days: 2555, mode: 'delete' },
  rewardSettlements: { days: 2555, mode: 'delete' },
  walletTransactions: { days: 2555, mode: 'delete' },
});

function analyzeWeeklyIncentiveRisk(input = {}) {
  const uid = normalizeId(input.uid, 128);
  const cycleId = normalizeId(input.cycleId, 120);
  if (!uid || !cycleId || !Array.isArray(input.facts) || input.facts.length > MAX_ANALYSIS_FACTS) {
    return { ok: false, code: 'INVALID_INTEGRITY_INPUT' };
  }
  const facts = input.facts.map(normalizeGiftFact).filter(Boolean)
    .sort((left, right) => left.occurredAtMillis - right.occurredAtMillis || left.eventId.localeCompare(right.eventId));
  const signals = [];
  if (facts.some((fact) => fact.senderUid === fact.recipientUid)) {
    signals.push(signal('SELF_GIFT', 'critical', { count: facts.filter((fact) => fact.senderUid === fact.recipientUid).length }));
  }

  const sentByTarget = groupAmounts(facts.filter((fact) => fact.senderUid === uid), 'recipientUid');
  const receivedBySource = groupAmounts(facts.filter((fact) => fact.recipientUid === uid), 'senderUid');
  for (const [otherUid, sent] of sentByTarget) {
    const received = receivedBySource.get(otherUid);
    if (!received) continue;
    const combinedCoins = sent.amount + received.amount;
    const combinedCount = sent.count + received.count;
    if (combinedCount >= 2 && combinedCoins >= 1_000) {
      signals.push(signal('CIRCULAR_GIFTING', 'high', { combinedCoins, combinedCount, relatedUid: otherUid }));
    }
  }

  const incoming = facts.filter((fact) => fact.recipientUid === uid);
  const outgoing = facts.filter((fact) => fact.senderUid === uid);
  for (const received of incoming) {
    const passed = outgoing.find((sent) => (
      sent.occurredAtMillis >= received.occurredAtMillis
      && sent.occurredAtMillis - received.occurredAtMillis <= RAPID_PASS_THROUGH_WINDOW_MS
      && sent.debitedCoins >= 1_000
      && sent.debitedCoins * 100 >= received.debitedCoins * 80
    ));
    if (passed) {
      signals.push(signal('RAPID_PASS_THROUGH', 'high', {
        receivedCoins: received.debitedCoins,
        sentCoins: passed.debitedCoins,
        windowMillis: passed.occurredAtMillis - received.occurredAtMillis,
      }));
      break;
    }
  }

  const refundCount = nonNegative(input.refundCount);
  const reversalCount = nonNegative(input.reversalCount);
  if (refundCount + reversalCount >= 2) {
    signals.push(signal('REFUND_REVERSAL_PATTERN', 'high', { refundCount, reversalCount }));
  }
  if (nonNegative(input.relatedInstallationCount) > 1) {
    signals.push(signal('RELATED_ACCOUNT_CLUSTER', 'high', {
      accountCount: input.relatedInstallationCount,
    }));
  }
  if (nonNegative(input.rosterChangeCount) >= 3) {
    signals.push(signal('SELECTED_MEMBER_CHURN', input.rosterChangeCount >= 6 ? 'high' : 'medium', {
      changeCount: input.rosterChangeCount,
    }));
  }
  if (input.muteGraceCycling?.flagged === true) {
    signals.push(signal('MUTE_GRACE_CYCLING', 'high', {
      resetCount: nonNegative(input.muteGraceCycling.resetCount),
      windowMillis: nonNegative(input.muteGraceCycling.windowMillis),
    }));
  }
  const retainedCommissionCoins = nonNegative(input.retainedCommissionCoins);
  const stackedLiabilityCoins = nonNegative(input.stackedLiabilityCoins);
  if (stackedLiabilityCoins > retainedCommissionCoins && stackedLiabilityCoins > 0) {
    signals.push(signal('ABNORMAL_REWARD_STACKING', 'critical', {
      retainedCommissionCoins,
      stackedLiabilityCoins,
    }));
  }
  if (input.incomplete === true) {
    signals.push(signal('ANALYSIS_TRUNCATED', 'medium', { factLimit: MAX_ANALYSIS_FACTS }));
  }

  const deduplicated = [...new Map(signals.map((entry) => [entry.code, entry])).values()];
  const riskScore = Math.min(100, deduplicated.reduce((total, entry) => total + RISK_SEVERITY_SCORE[entry.severity], 0));
  const hold = deduplicated.some((entry) => ['high', 'critical'].includes(entry.severity));
  return {
    ok: true,
    value: {
      cycleId,
      hold,
      riskScore,
      schemaVersion: INTEGRITY_SCHEMA_VERSION,
      signals: deduplicated,
      state: hold ? 'held' : deduplicated.length ? 'review' : 'clear',
      uid,
    },
  };
}

function reconcileGiftEconomyShape({ event, platformLedger, recipientLedger, senderLedger }) {
  if (!event || typeof event !== 'object' || event.status !== 'committed') {
    return { balanced: false, discrepancies: ['GIFT_NOT_COMMITTED'] };
  }
  const discrepancies = [];
  if (
    event.senderUid === event.recipientUid
    || !positive(event.price)
    || !nonNegative(event.recipientCredit)
    || !nonNegative(event.platformShare)
    || event.recipientCredit + event.platformShare !== event.price
  ) discrepancies.push('GIFT_SPLIT_INVALID');
  if (
    !senderLedger
    || senderLedger.uid !== event.senderUid
    || senderLedger.amount !== event.price
    || senderLedger.currency !== 'coins'
    || senderLedger.referenceId !== event.eventId
    || senderLedger.type !== 'purchase'
  ) discrepancies.push('SENDER_DEBIT_LEDGER');
  if (event.recipientCredit > 0 && (
    !recipientLedger
    || recipientLedger.uid !== event.recipientUid
    || recipientLedger.amount !== event.recipientCredit
    || recipientLedger.currency !== 'giftEarnings'
    || recipientLedger.referenceId !== event.eventId
    || recipientLedger.type !== 'credit'
  )) discrepancies.push('RECIPIENT_CREDIT_LEDGER');
  if (event.platformShare > 0 && (
    !platformLedger
    || platformLedger.amount !== event.platformShare
    || platformLedger.currency !== 'coins'
    || platformLedger.referenceId !== event.eventId
    || platformLedger.type !== 'credit'
  )) discrepancies.push('PLATFORM_COMMISSION_LEDGER');
  return { balanced: discrepancies.length === 0, discrepancies };
}

function createIntegrityDocumentId(prefix, values) {
  const normalizedPrefix = typeof prefix === 'string' && /^[a-z]{2,12}$/.test(prefix) ? prefix : '';
  if (!normalizedPrefix || !Array.isArray(values) || values.some((value) => !String(value || ''))) return '';
  return `${normalizedPrefix}_${crypto.createHash('sha256').update(values.join('|')).digest('hex').slice(0, 40)}`;
}

function retentionDeadlineMillis(collection, createdAtMillis) {
  const policy = RETENTION_POLICY_V1[collection];
  if (!policy || !Number.isSafeInteger(createdAtMillis) || createdAtMillis < 0) return 0;
  return createdAtMillis + policy.days * 86_400_000;
}

function signal(code, severity, details) {
  return { code, details, severity };
}

function groupAmounts(facts, key) {
  const result = new Map();
  for (const fact of facts) {
    const id = fact[key];
    const current = result.get(id) || { amount: 0, count: 0 };
    current.amount += fact.debitedCoins;
    current.count += 1;
    result.set(id, current);
  }
  return result;
}

function normalizeGiftFact(value) {
  if (!value || typeof value !== 'object') return undefined;
  const eventId = normalizeId(value.eventId, 160);
  const senderUid = normalizeId(value.senderUid, 128);
  const recipientUid = normalizeId(value.recipientUid, 128);
  if (!eventId || !senderUid || !recipientUid || !positive(value.debitedCoins) || !Number.isSafeInteger(value.occurredAtMillis)) {
    return undefined;
  }
  return {
    debitedCoins: value.debitedCoins,
    eventId,
    occurredAtMillis: value.occurredAtMillis,
    recipientUid,
    senderUid,
  };
}

function normalizeId(value, maxLength) {
  const result = typeof value === 'string' ? value.trim() : '';
  return result && result.length <= maxLength && !result.includes('/') ? result : '';
}

function nonNegative(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function positive(value) {
  return Number.isSafeInteger(value) && value > 0;
}

module.exports = {
  INTEGRITY_SCHEMA_VERSION,
  MAX_ANALYSIS_FACTS,
  RAPID_PASS_THROUGH_WINDOW_MS,
  RETENTION_POLICY_V1,
  analyzeWeeklyIncentiveRisk,
  createIntegrityDocumentId,
  reconcileGiftEconomyShape,
  retentionDeadlineMillis,
};
