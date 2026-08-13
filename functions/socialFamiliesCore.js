'use strict';

const crypto = require('node:crypto');

const FAMILY_MUTATION_ACTIONS = Object.freeze([
  'create-family',
  'invite-to-family',
  'accept-family-invite',
  'decline-family-invite',
  'cancel-family-invite',
  'join-family',
  'leave-family',
  'kick-family-member',
  'dissolve-family',
]);

const FAMILY_READ_ACTIONS = Object.freeze([
  'get-my-family',
]);

const FAMILY_ROLES = Object.freeze(['owner', 'elder', 'member']);
const FAMILY_MEMBER_CAP = 30;
const FAMILY_NAME_MAX = 40;
const FAMILY_DEFAULT_BADGE_COLOR = '#5B8C5A';

function createFamilyId() {
  return crypto.randomBytes(16).toString('hex');
}

function createFamilyInviteCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function createFamilyInviteId(familyId, targetUid) {
  return `${familyId}_${targetUid}`;
}

function normalizeFamilyName(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, FAMILY_NAME_MAX);
}

function normalizeBadgeColor(value) {
  if (typeof value !== 'string') return FAMILY_DEFAULT_BADGE_COLOR;
  const trimmed = value.trim().slice(0, 32);
  if (!/^#[0-9A-Fa-f]{6}$/.test(trimmed)) return FAMILY_DEFAULT_BADGE_COLOR;
  return trimmed.toUpperCase();
}

function normalizeHomeRoomId(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128) return null;
  return trimmed;
}

function normalizeCreateFamilyInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const allowed = new Set(['nameAr', 'badgeColor', 'homeRoomId']);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const nameAr = normalizeFamilyName(input.nameAr);
  if (!nameAr || nameAr.length < 2) return { ok: false, code: 'INVALID_REQUEST' };
  const homeRoomId = normalizeHomeRoomId(input.homeRoomId);
  if (homeRoomId === null) return { ok: false, code: 'INVALID_REQUEST' };
  return {
    ok: true,
    value: {
      badgeColor: normalizeBadgeColor(input.badgeColor),
      homeRoomId,
      nameAr,
    },
  };
}

function normalizeFamilyTargetInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  if (Object.keys(input).some((key) => key !== 'targetUid')) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const targetUid = typeof input.targetUid === 'string' ? input.targetUid.trim() : '';
  if (!targetUid || targetUid.length > 128) return { ok: false, code: 'INVALID_REQUEST' };
  return { ok: true, value: { targetUid } };
}

function normalizeFamilyIdInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  if (Object.keys(input).some((key) => key !== 'familyId')) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const familyId = typeof input.familyId === 'string' ? input.familyId.trim() : '';
  if (!familyId || familyId.length > 64) return { ok: false, code: 'INVALID_REQUEST' };
  return { ok: true, value: { familyId } };
}

function normalizeJoinFamilyInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  if (Object.keys(input).some((key) => key !== 'inviteCode')) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const inviteCode = typeof input.inviteCode === 'string'
    ? input.inviteCode.trim().toUpperCase()
    : '';
  if (!/^[0-9A-F]{6}$/.test(inviteCode)) return { ok: false, code: 'INVALID_REQUEST' };
  return { ok: true, value: { inviteCode } };
}

function normalizeCancelFamilyInviteInput(input = {}, requestingUid) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const allowed = new Set(['familyId', 'targetUid']);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const familyId = typeof input.familyId === 'string' ? input.familyId.trim() : '';
  const targetUid = typeof input.targetUid === 'string' ? input.targetUid.trim() : '';
  if (!familyId || familyId.length > 64 || !targetUid || targetUid.length > 128) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  if (targetUid === requestingUid) return { ok: false, code: 'INVALID_REQUEST' };
  return { ok: true, value: { familyId, targetUid } };
}

function canInviteOrKick(role) {
  return role === 'owner' || role === 'elder';
}

function canKickTarget(actorRole, targetRole) {
  if (!canInviteOrKick(actorRole)) return false;
  if (targetRole === 'owner') return false;
  if (actorRole === 'elder' && targetRole === 'elder') return false;
  return true;
}

function mapFamilyBadge(data = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const familyId = typeof data.familyId === 'string' ? data.familyId.trim() : '';
  const nameAr = normalizeFamilyName(data.nameAr);
  const role = typeof data.role === 'string' ? data.role.trim() : '';
  if (!familyId || !nameAr || !FAMILY_ROLES.includes(role)) return null;
  return {
    badgeColor: normalizeBadgeColor(data.badgeColor),
    familyId,
    nameAr,
    role,
  };
}

function mapFamilySummary(data = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const familyId = typeof data.familyId === 'string' ? data.familyId.trim() : '';
  const nameAr = normalizeFamilyName(data.nameAr);
  if (!familyId || !nameAr) return null;
  const memberCount = Number(data.memberCount);
  const ownerUid = typeof data.ownerUid === 'string' ? data.ownerUid.trim() : '';
  return {
    badgeColor: normalizeBadgeColor(data.badgeColor),
    familyId,
    homeRoomId: typeof data.homeRoomId === 'string' ? data.homeRoomId.trim().slice(0, 128) : '',
    inviteCode: typeof data.inviteCode === 'string' ? data.inviteCode.trim().toUpperCase() : '',
    memberCount: Number.isSafeInteger(memberCount) && memberCount >= 0 ? memberCount : 0,
    nameAr,
    ownerUid,
  };
}

function mapFamilyMember(data = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const uid = typeof data.uid === 'string' ? data.uid.trim() : '';
  const role = typeof data.role === 'string' ? data.role.trim() : '';
  if (!uid || !FAMILY_ROLES.includes(role)) return null;
  return {
    displayName: typeof data.displayName === 'string' ? data.displayName.trim().slice(0, 80) : '',
    publicId: typeof data.publicId === 'string'
      ? data.publicId.trim()
      : (Number.isSafeInteger(data.publicId) ? String(data.publicId) : ''),
    role,
    uid,
  };
}

module.exports = {
  FAMILY_DEFAULT_BADGE_COLOR,
  FAMILY_MEMBER_CAP,
  FAMILY_MUTATION_ACTIONS,
  FAMILY_NAME_MAX,
  FAMILY_READ_ACTIONS,
  FAMILY_ROLES,
  canInviteOrKick,
  canKickTarget,
  createFamilyId,
  createFamilyInviteCode,
  createFamilyInviteId,
  mapFamilyBadge,
  mapFamilyMember,
  mapFamilySummary,
  normalizeCancelFamilyInviteInput,
  normalizeCreateFamilyInput,
  normalizeFamilyIdInput,
  normalizeFamilyTargetInput,
  normalizeJoinFamilyInput,
};
