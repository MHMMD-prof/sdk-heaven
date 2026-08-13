const { DIRECT_CHAT_EVIDENCE_RETENTION_MS } = require('./directChatReportCore');

const DIRECT_CHAT_MODERATION_ACTIONS = [
  'clear-direct-chat-restriction',
  'dismiss',
  'remove-direct-message',
  'restrict-direct-chat',
  'set-direct-chat-legal-hold',
];
const DIRECT_CHAT_MODERATION_MAX_REMOVALS = 10;
const DIRECT_CHAT_RESTRICTION_MAX_HOURS = 8_760;
const DIRECT_CHAT_LEGAL_HOLD_RETENTION_MS = 180 * 24 * 60 * 60 * 1_000;
const DIRECT_CHAT_EVIDENCE_URL_TTL_MS = 5 * 60 * 1_000;
const DIRECT_CHAT_MODERATION_REASON_LENGTH = 240;
const DIRECT_CHAT_MODERATION_NOTE_LENGTH = 500;
const DIRECT_CHAT_RESTRICTION_REASON_LENGTH = 300;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;

// A reason is mandatory rather than optional because the reason is the only part of the
// per-view audit event that explains why private message content was unmasked.
function normalizeDirectChatEvidenceRequest(body = {}) {
  const reason = readTrimmed(body.reason, DIRECT_CHAT_MODERATION_REASON_LENGTH);
  const reportId = readTrimmed(body.reportId, 200);
  const requestId = readTrimmed(body.requestId, 80);

  if (!reportId) return invalid('reportId is required.');
  if (!REQUEST_ID_PATTERN.test(requestId)) return invalid('A valid requestId is required.');
  if (reason.length < 2) return invalid('A reason with at least 2 characters is required.');

  return { ok: true, value: { reason, reportId, requestId } };
}

function normalizeDirectChatModerationAction(body = {}) {
  const action = readTrimmed(body.directChatAction, 64);
  const note = readTrimmed(body.note, DIRECT_CHAT_MODERATION_NOTE_LENGTH);
  const reportId = readTrimmed(body.reportId, 200);
  const requestId = readTrimmed(body.requestId, 80);

  if (!DIRECT_CHAT_MODERATION_ACTIONS.includes(action)) {
    return invalid('Valid direct chat moderation action is required.');
  }
  if (!reportId) return invalid('reportId is required.');
  if (!REQUEST_ID_PATTERN.test(requestId)) return invalid('A valid requestId is required.');
  // Every one of these actions is a judgement about private content, so none of them is
  // note-optional the way report-action's assign and triage are.
  if (note.length < 2) return invalid('A note with at least 2 characters is required.');

  const messageIds = normalizeMessageIds(body.messageIds);
  if (action === 'remove-direct-message') {
    if (messageIds.length === 0) return invalid('At least one messageId is required.');
    if (messageIds.length > DIRECT_CHAT_MODERATION_MAX_REMOVALS) {
      return invalid(`At most ${DIRECT_CHAT_MODERATION_MAX_REMOVALS} messages can be removed at once.`);
    }
  }

  const durationProvided = body.durationHours !== undefined && body.durationHours !== null && body.durationHours !== '';
  const durationHours = normalizeDurationHours(body.durationHours);
  if (durationProvided && durationHours === undefined) {
    return invalid(`durationHours must be a whole number between 1 and ${DIRECT_CHAT_RESTRICTION_MAX_HOURS}.`);
  }

  if (action === 'set-direct-chat-legal-hold' && typeof body.legalHold !== 'boolean') {
    return invalid('legalHold must be a boolean.');
  }

  return {
    ok: true,
    value: {
      action,
      ...(action === 'restrict-direct-chat' && durationHours !== undefined ? { durationHours } : {}),
      legalHold: body.legalHold === true,
      messageIds: action === 'remove-direct-message' ? messageIds : [],
      note,
      reportId,
      requestId,
    },
  };
}

// The shape here is load-bearing: mapDirectChatRestriction returns undefined for anything it
// does not recognise, and an unrecognised restriction silently allows direct messages.
function buildDirectChatRestrictionDocument({ actorUid, durationHours, nowMs, reason, targetUid }) {
  const hours = normalizeDurationHours(durationHours);
  return {
    actorUid,
    ...(hours === undefined ? {} : { endsAt: nowMs + (hours * 60 * 60 * 1_000) }),
    reason: readTrimmed(reason, DIRECT_CHAT_RESTRICTION_REASON_LENGTH) || 'Direct chat safety enforcement',
    startsAt: nowMs,
    state: 'restricted',
    uid: targetUid,
  };
}

function buildDirectChatRestrictionClearDocument({ actorUid, nowMs, reason, targetUid }) {
  return {
    actorUid,
    reason: readTrimmed(reason, DIRECT_CHAT_RESTRICTION_REASON_LENGTH) || 'Direct chat restriction cleared',
    startsAt: nowMs,
    state: 'cleared',
    uid: targetUid,
  };
}

function buildDirectChatRemovalPatch({ actorAuthority = 'staff', actorUid, now }) {
  return {
    moderationAuthority: actorAuthority,
    moderationRemovedAt: now,
    moderationRemovedBy: actorUid,
    text: '',
    unreadForUids: [],
    updatedAt: now,
    visibilityState: 'removed',
  };
}

function resolveDirectChatLegalHold({ evidenceCase, legalHold, nowMs }) {
  const current = Number(evidenceCase?.retentionUntilMs || 0);
  return {
    legalHold: legalHold === true,
    retentionUntilMs: legalHold === true
      ? Math.max(current, nowMs + DIRECT_CHAT_LEGAL_HOLD_RETENTION_MS)
      : nowMs + DIRECT_CHAT_EVIDENCE_RETENTION_MS,
  };
}

function resolveDirectChatRemovalTargets({ evidenceCase, messageIds }) {
  const allowed = Array.isArray(evidenceCase?.selectedMessageIds) ? evidenceCase.selectedMessageIds : [];
  const outside = messageIds.filter((messageId) => !allowed.includes(messageId));
  if (outside.length > 0) {
    return {
      ok: false,
      status: 400,
      error: 'Only messages captured as reported evidence can be removed.',
    };
  }
  return { ok: true, value: { messageIds: [...messageIds].sort() } };
}

function normalizeMessageIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((entry) => typeof entry === 'string' && entry.trim().length > 0 && entry.trim().length <= 200)
    .map((entry) => entry.trim()))];
}

function normalizeDurationHours(value) {
  const hours = Number(value);
  if (!Number.isSafeInteger(hours) || hours < 1 || hours > DIRECT_CHAT_RESTRICTION_MAX_HOURS) return undefined;
  return hours;
}

function readTrimmed(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function invalid(error) {
  return { ok: false, status: 400, error };
}

module.exports = {
  DIRECT_CHAT_EVIDENCE_URL_TTL_MS,
  DIRECT_CHAT_LEGAL_HOLD_RETENTION_MS,
  DIRECT_CHAT_MODERATION_ACTIONS,
  DIRECT_CHAT_MODERATION_MAX_REMOVALS,
  DIRECT_CHAT_RESTRICTION_MAX_HOURS,
  buildDirectChatRemovalPatch,
  buildDirectChatRestrictionClearDocument,
  buildDirectChatRestrictionDocument,
  normalizeDirectChatEvidenceRequest,
  normalizeDirectChatModerationAction,
  resolveDirectChatLegalHold,
  resolveDirectChatRemovalTargets,
};
