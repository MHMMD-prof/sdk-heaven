const ADMIN_USER_HISTORY_LIMIT = 20;
const ADMIN_USER_HISTORY_SECTIONS = Object.freeze(['activity', 'notes', 'ownerships', 'reports', 'room-moderation', 'rooms', 'social-gifts', 'store-gifts', 'transfers']);

function encodeAdminUserHistoryCursor(section, sources = {}) {
  if (!ADMIN_USER_HISTORY_SECTIONS.includes(section)) return '';
  const normalized = {};
  for (const [source, value] of Object.entries(sources)) {
    if (!isCursorMark(value)) continue;
    normalized[source] = { at: new Date(value.at).toISOString(), id: value.id };
  }
  return Buffer.from(JSON.stringify({ section, sources: normalized, version: 1 }), 'utf8').toString('base64url');
}

function decodeAdminUserHistoryCursor(value, section) {
  if (!value) return { section, sources: {} };
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (parsed?.version !== 1 || parsed.section !== section || !parsed.sources || typeof parsed.sources !== 'object' || Array.isArray(parsed.sources)) return null;
    const sources = {};
    for (const [source, mark] of Object.entries(parsed.sources)) {
      if (!/^[a-z][a-z0-9-]{0,40}$/.test(source) || !isCursorMark(mark)) return null;
      sources[source] = { at: new Date(mark.at).toISOString(), id: mark.id };
    }
    return { section, sources };
  } catch {
    return null;
  }
}

function mergeAdminUserHistoryEntries({ entries = [], incomingSources = {}, limit = ADMIN_USER_HISTORY_LIMIT, section, sourceHasMore = {} }) {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, ADMIN_USER_HISTORY_LIMIT) : ADMIN_USER_HISTORY_LIMIT;
  const deduplicated = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry.key !== 'string' || !entry.key || !Array.isArray(entry.marks) || !entry.marks.every((mark) => mark && typeof mark.source === 'string' && isCursorMark(mark))) continue;
    const existing = deduplicated.get(entry.key);
    if (existing) existing.marks.push(...entry.marks.filter((mark) => !existing.marks.some((current) => current.source === mark.source && current.id === mark.id)));
    else deduplicated.set(entry.key, { ...entry, marks: [...entry.marks] });
  }
  const ordered = [...deduplicated.values()].sort((left, right) => String(right.sortAt).localeCompare(String(left.sortAt)) || String(right.sortKey || right.marks[0]?.id || right.key).localeCompare(String(left.sortKey || left.marks[0]?.id || left.key)) || String(right.key).localeCompare(String(left.key)));
  const selected = ordered.slice(0, safeLimit);
  const sources = { ...incomingSources };
  selected.forEach((entry) => entry.marks.forEach((mark) => { sources[mark.source] = { at: new Date(mark.at).toISOString(), id: mark.id }; }));
  const hasNextPage = ordered.length > selected.length || Object.values(sourceHasMore).some(Boolean);
  return {
    items: selected.map((entry) => entry.value),
    pageInfo: {
      hasNextPage,
      limit: safeLimit,
      nextCursor: hasNextPage && selected.length ? encodeAdminUserHistoryCursor(section, sources) : null,
      returned: selected.length,
    },
  };
}

function isCursorMark(value) {
  return Boolean(value && typeof value === 'object' && typeof value.id === 'string' && value.id && typeof value.at === 'string' && !Number.isNaN(Date.parse(value.at)));
}

module.exports = {
  ADMIN_USER_HISTORY_LIMIT,
  ADMIN_USER_HISTORY_SECTIONS,
  decodeAdminUserHistoryCursor,
  encodeAdminUserHistoryCursor,
  mergeAdminUserHistoryEntries,
};
