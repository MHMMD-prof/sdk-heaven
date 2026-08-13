const { timestampToMillis } = require('./directChatPolicyCore');
const { DIRECT_CHAT_EVIDENCE_RETENTION_MS } = require('./directChatReportCore');
const { DIRECT_CHAT_LEGAL_HOLD_RETENTION_MS } = require('./directChatModerationCore');

const DAY_MS = 24 * 60 * 60 * 1_000;
const DIRECT_CHAT_RETENTION_POLICY_PATH = 'directChatRetention/current';
const DIRECT_CHAT_RETENTION_SWEEP_PATH = 'directChatRetention/sweepState';
const DIRECT_CHAT_RETENTION_POLICY_VERSION = 1;

// Hard bounds are platform caps. Configuration may move within them but never past them,
// so a mis-set policy document cannot delete a conversation the day after it happens or
// keep private messages effectively forever.
const DIRECT_CHAT_MESSAGE_RETENTION_BOUNDS = { fallbackDays: 365, maxDays: 730, minDays: 30 };
const DIRECT_CHAT_EVIDENCE_RETENTION_BOUNDS = {
  fallbackDays: DIRECT_CHAT_EVIDENCE_RETENTION_MS / DAY_MS,
  maxDays: 365,
  minDays: 30,
};
const DIRECT_CHAT_LEGAL_HOLD_RETENTION_BOUNDS = {
  fallbackDays: DIRECT_CHAT_LEGAL_HOLD_RETENTION_MS / DAY_MS,
  maxDays: 730,
  minDays: 90,
};

const DIRECT_CHAT_EVIDENCE_MEDIA_STATES = ['copied', 'missing', 'none', 'pending'];
const DIRECT_CHAT_EVIDENCE_ASSET_NAMES = ['image.webp', 'voice.aac', 'voice.m4a'];
const REPORT_ID_PATTERN = /^dmr_[a-f0-9]{40}$/;
const MESSAGE_ID_PATTERN = /^dm[ms]_[a-f0-9]{40}$/;

function mapDirectChatRetentionPolicy(value) {
  const source = value && typeof value === 'object' ? value : undefined;
  return {
    evidenceRetentionDays: clampDays(source?.evidenceRetentionDays, DIRECT_CHAT_EVIDENCE_RETENTION_BOUNDS),
    legalHoldRetentionDays: clampDays(source?.legalHoldRetentionDays, DIRECT_CHAT_LEGAL_HOLD_RETENTION_BOUNDS),
    messageRetentionDays: clampDays(source?.messageRetentionDays, DIRECT_CHAT_MESSAGE_RETENTION_BOUNDS),
    policyVersion: Number.isSafeInteger(source?.policyVersion) && source.policyVersion > 0
      ? source.policyVersion
      : DIRECT_CHAT_RETENTION_POLICY_VERSION,
    source: source ? 'document' : 'default',
  };
}

// Cutoffs are derived at sweep time from createdAt rather than from a per-message expireAt
// written at send time. A precomputed field would freeze the policy that was in force when
// the message was sent, so lowering retention would never reach existing messages.
function resolveDirectChatRetentionCutoffs({ nowMs, policy }) {
  const resolved = mapDirectChatRetentionPolicy(policy);
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : 0;
  return {
    evidenceRetentionMs: resolved.evidenceRetentionDays * DAY_MS,
    legalHoldRetentionMs: resolved.legalHoldRetentionDays * DAY_MS,
    messageCutoffMs: safeNowMs - (resolved.messageRetentionDays * DAY_MS),
    policy: resolved,
  };
}

// Messages are sequenced monotonically, so everything past retention forms a prefix of the
// thread. Stopping at the first message that is not provably expired keeps that prefix
// contiguous, which is what lets a single watermark stand in for all of the deleted rows.
function resolveDirectChatMessagePurge({ conversation, cutoffMs, memberFloors = {}, messages, uploads }) {
  const ordered = (Array.isArray(messages) ? messages : [])
    .filter((message) => message && typeof message.id === 'string' && Number.isSafeInteger(message.sequence))
    .sort((first, second) => first.sequence - second.sequence);
  const purged = [];
  for (const message of ordered) {
    const createdAtMs = timestampToMillis(message.createdAt);
    if (!Number.isFinite(createdAtMs) || createdAtMs > cutoffMs) break;
    // The message row is the only pointer to its media object, so a row whose reported bytes are
    // still awaiting isolation is left in place instead of deleted. Deleting it would orphan the
    // object with nothing left to revisit it. The next sweep retries once the copy lands.
    if (isAwaitingEvidenceCopy(message, uploads)) break;
    purged.push(message);
  }
  const lastSequence = safeSequence(conversation?.lastSequence);
  const previousWatermark = safeSequence(conversation?.retentionPurgedThroughSequence);
  const purgedThroughSequence = purged.length > 0
    ? Math.min(lastSequence, Math.max(previousWatermark, purged.at(-1).sequence))
    : previousWatermark;
  return {
    lastMessagePurged: purged.some((message) => message.id === conversation?.lastMessageId),
    purged,
    purgedThroughSequence,
    unreadDecrements: resolveUnreadDecrements({ memberFloors, purged }),
  };
}

function isAwaitingEvidenceCopy(message, uploads) {
  const attachmentId = typeof message.attachmentId === 'string' ? message.attachmentId : '';
  if (!attachmentId || !(uploads instanceof Map)) return false;
  const upload = uploads.get(attachmentId);
  if (upload?.evidenceHold !== true) return false;
  return !Number.isFinite(timestampToMillis(upload.evidenceCopiedAt));
}

function resolveUnreadDecrements({ memberFloors, purged }) {
  const decrements = {};
  for (const message of purged) {
    if (message.visibilityState !== 'visible') continue;
    const unreadForUids = Array.isArray(message.unreadForUids) ? message.unreadForUids : [];
    for (const uid of unreadForUids) {
      if (typeof uid !== 'string' || !uid) continue;
      if (message.sequence <= safeSequence(memberFloors[uid])) continue;
      decrements[uid] = (decrements[uid] || 0) + 1;
    }
  }
  return decrements;
}

// A held upload is only released once its bytes exist under the report's own evidence prefix.
// Deleting the live object before the copy lands would destroy the only copy of the evidence.
function resolveDirectChatMediaPurge({ purged, uploads }) {
  const purgeable = [];
  const retained = [];
  for (const message of purged) {
    const attachmentId = typeof message.attachmentId === 'string' ? message.attachmentId : '';
    if (!attachmentId) continue;
    const upload = uploads instanceof Map ? uploads.get(attachmentId) : undefined;
    const held = upload?.evidenceHold === true;
    const copied = Number.isFinite(timestampToMillis(upload?.evidenceCopiedAt));
    const mediaPath = readText(upload?.mediaPath, 512) || readText(message.mediaPath, 512);
    const entry = { attachmentId, held, mediaPath, uid: readText(upload?.uid, 128) };
    if (held && !copied) {
      retained.push(entry);
      continue;
    }
    purgeable.push(entry);
  }
  return { purgeable, retained };
}

function resolveDirectChatEvidenceExpiry({ evidenceCase, nowMs }) {
  if (!evidenceCase) return false;
  if (evidenceCase.legalHold === true) return false;
  if (evidenceCase.status === 'expired') return false;
  const retentionUntilMs = Number(evidenceCase.retentionUntilMs);
  return Number.isFinite(retentionUntilMs) && retentionUntilMs <= nowMs;
}

// retentionUntilMs is removed rather than left in the past. A document missing the ordered field
// drops out of the expiry range query, so tombstoned cases cannot sit at the head of every
// subsequent sweep and starve cases that are only now coming due.
function buildDirectChatEvidenceExpiryPatch({ fieldValue, now, nowMs }) {
  return {
    attachmentIds: [],
    deletedAtMs: nowMs,
    retentionUntilMs: fieldValue.delete(),
    snapshotCount: 0,
    status: 'expired',
    updatedAt: now,
  };
}

function directChatEvidenceObjectPath(reportId, messageId, mediaPath) {
  if (!REPORT_ID_PATTERN.test(String(reportId || '')) || !MESSAGE_ID_PATTERN.test(String(messageId || ''))) return '';
  const assetName = String(mediaPath || '').split('/').pop() || '';
  if (!DIRECT_CHAT_EVIDENCE_ASSET_NAMES.includes(assetName)) return '';
  return `direct-chat-evidence/${reportId}/${messageId}/${assetName}`;
}

function mapDirectChatEvidenceMediaState(value) {
  return DIRECT_CHAT_EVIDENCE_MEDIA_STATES.includes(value) ? value : 'none';
}

function resolveDirectChatEvidenceMediaState({ attachmentId, mediaPath }) {
  return typeof attachmentId === 'string' && attachmentId && readText(mediaPath, 512) ? 'pending' : 'none';
}

function buildDirectChatSweepState({ cursor, nowMs, scanned, wrapped }) {
  return {
    cursor: readText(cursor, 200),
    scanned: safeSequence(scanned),
    sweptAtMs: Number.isFinite(nowMs) ? nowMs : 0,
    wrapped: wrapped === true,
  };
}

function clampDays(value, bounds) {
  const days = Number(value);
  if (!Number.isFinite(days)) return bounds.fallbackDays;
  return Math.min(bounds.maxDays, Math.max(bounds.minDays, Math.round(days)));
}

function safeSequence(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function readText(value, maxLength) {
  return typeof value === 'string' && value.length <= maxLength ? value : '';
}

module.exports = {
  DIRECT_CHAT_EVIDENCE_ASSET_NAMES,
  DIRECT_CHAT_EVIDENCE_MEDIA_STATES,
  DIRECT_CHAT_EVIDENCE_RETENTION_BOUNDS,
  DIRECT_CHAT_LEGAL_HOLD_RETENTION_BOUNDS,
  DIRECT_CHAT_MESSAGE_RETENTION_BOUNDS,
  DIRECT_CHAT_RETENTION_POLICY_PATH,
  DIRECT_CHAT_RETENTION_POLICY_VERSION,
  DIRECT_CHAT_RETENTION_SWEEP_PATH,
  buildDirectChatEvidenceExpiryPatch,
  buildDirectChatSweepState,
  directChatEvidenceObjectPath,
  mapDirectChatEvidenceMediaState,
  mapDirectChatRetentionPolicy,
  resolveDirectChatEvidenceExpiry,
  resolveDirectChatEvidenceMediaState,
  resolveDirectChatMediaPurge,
  resolveDirectChatMessagePurge,
  resolveDirectChatRetentionCutoffs,
};
