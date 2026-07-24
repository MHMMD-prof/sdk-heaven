const ADMIN_USER_CONTEXT_LIMIT = 20;
const ADMIN_USER_BLOCK_SCAN_LIMIT = 100;

function readTimestampIso(value) {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value && typeof value.toMillis === 'function') return new Date(value.toMillis()).toISOString();
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : '';
}

function mapUserRelationship(id, data = {}, uid, kind) {
  const memberUids = Array.isArray(data.memberUids) ? data.memberUids.filter((value) => typeof value === 'string') : [];
  const peerUid = kind === 'friend'
    ? memberUids.find((value) => value !== uid) || ''
    : data.senderUid === uid ? data.recipientUid : data.senderUid;
  if (!id || typeof peerUid !== 'string' || !peerUid || peerUid === uid) return null;
  return { createdAt: readTimestampIso(data.createdAt), id, kind, peerUid, status: typeof data.status === 'string' ? data.status : kind === 'friend' ? 'active' : 'pending', updatedAt: readTimestampIso(data.updatedAt) };
}

function mapUserGiftEvent(id, data = {}, uid, channel = 'social') {
  const senderUid = typeof data.senderUid === 'string' ? data.senderUid : '';
  const recipientUid = typeof data.recipientUid === 'string' ? data.recipientUid : '';
  if (!id || !senderUid || !recipientUid || ![senderUid, recipientUid].includes(uid)) return null;
  const amount = Number.isSafeInteger(data.price) && data.price >= 0 ? data.price : 0;
  return {
    amount,
    channel,
    createdAt: readTimestampIso(data.createdAt),
    currency: typeof data.currency === 'string' ? data.currency : channel === 'social' ? 'coins' : '',
    direction: senderUid === uid ? 'sent' : 'received',
    id,
    itemId: typeof data.itemId === 'string' ? data.itemId : typeof data.giftId === 'string' ? data.giftId : '',
    label: typeof data.nameAr === 'string' ? data.nameAr : '',
    peerUid: senderUid === uid ? recipientUid : senderUid,
  };
}

function mapUserOwnership(id, data = {}, catalog = {}, acquisitionSource = 'purchase') {
  const itemId = typeof data.itemId === 'string' && data.itemId ? data.itemId : id;
  if (!itemId || data.kind !== 'store-ownership' || !['active', 'expired'].includes(data.state)) return null;
  return {
    acquiredAt: readTimestampIso(data.acquiredAt),
    acquisitionSource,
    category: typeof data.category === 'string' ? data.category : '',
    equipped: data.equipped === true,
    expiresAt: readTimestampIso(data.expiresAt),
    itemId,
    nameAr: typeof catalog.name?.ar === 'string' ? catalog.name.ar : '',
    state: data.state,
    thumbnailUrl: typeof catalog.thumbnailUrl === 'string' ? catalog.thumbnailUrl : '',
  };
}

function mapUserTransferReceipt(id, data = {}, direction) {
  if (!id || !Number.isSafeInteger(data.amount) || data.amount < 1 || !['coins', 'diamonds'].includes(data.currency)) return null;
  const peerUid = direction === 'sent' ? data.recipientUid : data.representativeUid;
  if (typeof peerUid !== 'string' || !peerUid) return null;
  return {
    amount: data.amount,
    createdAt: readTimestampIso(data.createdAt),
    currency: data.currency,
    direction,
    id,
    peerPublicId: direction === 'sent' ? String(data.recipientPublicId || '') : String(data.representativePublicId || ''),
    peerUid,
    status: data.status === 'completed' ? 'completed' : String(data.status || ''),
    transferId: typeof data.transferId === 'string' ? data.transferId : id,
  };
}

function mapUserRoomModeration(id, data = {}) {
  if (!id || typeof data.roomId !== 'string' || !data.roomId) return null;
  return { action: typeof data.action === 'string' ? data.action : '', actorUid: typeof data.actorUid === 'string' ? data.actorUid : '', createdAt: readTimestampIso(data.createdAt), id, reason: typeof data.reason === 'string' ? data.reason : '', roomId: data.roomId };
}

function summarizeUserReports(reports = [], nowMs = Date.now()) {
  const recentBoundary = nowMs - (30 * 24 * 60 * 60 * 1000);
  return {
    open: reports.filter((report) => report.status !== 'resolved').length,
    recentResolved: reports.filter((report) => report.status === 'resolved' && Date.parse(report.resolvedAt || report.updatedAt) >= recentBoundary).length,
    total: reports.length,
    urgent: reports.filter((report) => report.status !== 'resolved' && ['high', 'critical'].includes(report.severity)).length,
  };
}

function sortRecent(rows = [], limit = ADMIN_USER_CONTEXT_LIMIT) {
  return rows.filter(Boolean).sort((left, right) => String(right.updatedAt || right.createdAt || right.acquiredAt).localeCompare(String(left.updatedAt || left.createdAt || left.acquiredAt))).slice(0, limit);
}

module.exports = {
  ADMIN_USER_BLOCK_SCAN_LIMIT,
  ADMIN_USER_CONTEXT_LIMIT,
  mapUserGiftEvent,
  mapUserOwnership,
  mapUserRelationship,
  mapUserRoomModeration,
  mapUserTransferReceipt,
  readTimestampIso,
  sortRecent,
  summarizeUserReports,
};
