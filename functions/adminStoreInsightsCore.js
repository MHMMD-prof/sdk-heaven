const MAX_STORE_ITEM_TRANSACTIONS = 1000;
const MAX_STORE_ITEM_OWNERSHIPS = 1000;
const MAX_STORE_ITEM_AUDIT_EVENTS = 200;
const MAX_ECONOMY_EXPORT_ROWS = 2000;

function readTimestampIso(value) {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value && typeof value.toMillis === 'function') return new Date(value.toMillis()).toISOString();
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : '';
}

function mapStoreTransaction(id, data = {}) {
  const kind = data.kind === 'gift' ? 'gift' : data.kind === 'purchase' ? 'purchase' : '';
  const itemId = typeof data.itemId === 'string' ? data.itemId.trim() : '';
  if (!id || !kind || !itemId || !Number.isSafeInteger(data.amount) || data.amount < 0 || !['coins', 'diamonds'].includes(data.currency)) return null;
  return {
    amount: data.amount,
    createdAt: readTimestampIso(data.createdAt),
    currency: data.currency,
    id,
    itemId,
    kind,
    recipientUid: typeof data.recipientUid === 'string' ? data.recipientUid.trim() : '',
    senderUid: typeof data.senderUid === 'string' ? data.senderUid.trim() : '',
    uid: typeof data.uid === 'string' ? data.uid.trim() : '',
  };
}

function mapStoreOwnership(id, data = {}) {
  const itemId = typeof data.itemId === 'string' ? data.itemId.trim() : '';
  const uid = typeof data.uid === 'string' ? data.uid.trim() : '';
  if (!id || !itemId || !uid || data.kind !== 'store-ownership') return null;
  const expiresAt = readTimestampIso(data.expiresAt);
  const state = data.state === 'expired' || (expiresAt && Date.parse(expiresAt) <= Date.now()) ? 'expired' : 'active';
  return {
    acquiredAt: readTimestampIso(data.acquiredAt),
    equipped: data.equipped === true,
    expiresAt,
    id,
    itemId,
    state,
    uid,
    updatedAt: readTimestampIso(data.updatedAt),
  };
}

function buildStoreItemInsights({ auditEvents = [], ownerships = [], transactions = [] } = {}) {
  const validTransactions = transactions.filter(Boolean);
  const validOwnerships = ownerships.filter(Boolean);
  const revenue = validTransactions.reduce((sum, transaction) => {
    sum[transaction.currency] += transaction.amount;
    return sum;
  }, { coins: 0, diamonds: 0 });
  const history = [
    ...validTransactions.map((transaction) => ({
      actorUid: transaction.senderUid || transaction.uid,
      amount: transaction.amount,
      createdAt: transaction.createdAt,
      currency: transaction.currency,
      id: transaction.id,
      kind: transaction.kind,
      targetUid: transaction.recipientUid || transaction.uid,
    })),
    ...auditEvents.filter(Boolean).map((event) => ({
      actorUid: event.actorUid || '',
      amount: 0,
      createdAt: event.createdAt || '',
      currency: '',
      id: event.id,
      kind: 'catalog-change',
      targetUid: '',
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
  return {
    history,
    metrics: {
      activeOwnerships: validOwnerships.filter((item) => item.state === 'active').length,
      equippedOwnerships: validOwnerships.filter((item) => item.state === 'active' && item.equipped).length,
      expiredOwnerships: validOwnerships.filter((item) => item.state === 'expired').length,
      gifts: validTransactions.filter((item) => item.kind === 'gift').length,
      ownerships: validOwnerships.length,
      purchases: validTransactions.filter((item) => item.kind === 'purchase').length,
      revenueCoins: revenue.coins,
      revenueDiamonds: revenue.diamonds,
    },
    sampled: {
      auditEvents: auditEvents.length >= MAX_STORE_ITEM_AUDIT_EVENTS,
      ownerships: ownerships.length >= MAX_STORE_ITEM_OWNERSHIPS,
      transactions: transactions.length >= MAX_STORE_ITEM_TRANSACTIONS,
    },
  };
}

function buildEconomyCsv(rows = []) {
  const limited = rows.slice(0, MAX_ECONOMY_EXPORT_ROWS);
  const headers = ['id', 'created_at', 'uid', 'display_name', 'public_id', 'special_id', 'type', 'currency', 'amount', 'balance_after', 'source', 'reference_id', 'actor_uid', 'note'];
  const values = limited.map((item) => [item.id, item.createdAt, item.uid, item.displayName, item.publicId, item.specialId, item.type, item.currency, item.amount, item.balanceAfter, item.source, item.referenceId, item.actorUid, item.note]);
  const csv = [headers, ...values].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
  return { count: limited.length, csv, filename: `store-ledger-${new Date().toISOString().slice(0, 10)}.csv`, truncated: rows.length >= MAX_ECONOMY_EXPORT_ROWS };
}

function escapeCsvCell(value) {
  let text = String(value ?? '').replace(/\r?\n/g, ' ');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

module.exports = {
  MAX_ECONOMY_EXPORT_ROWS,
  MAX_STORE_ITEM_AUDIT_EVENTS,
  MAX_STORE_ITEM_OWNERSHIPS,
  MAX_STORE_ITEM_TRANSACTIONS,
  buildEconomyCsv,
  buildStoreItemInsights,
  mapStoreOwnership,
  mapStoreTransaction,
};
