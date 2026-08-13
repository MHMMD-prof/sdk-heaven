'use strict';

const { createHash } = require('node:crypto');

const GIFT_THEATER_TAGS = Object.freeze(['combo', 'storm', 'lucky', 'magic']);
const TEMPLATE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,39}$/;

const DEFAULT_LUCKY_TABLE = Object.freeze({
  entries: Object.freeze([
    Object.freeze({
      id: 'none',
      kind: 'none',
      labelAr: 'حظ عادي',
      oddsLabelAr: '٧٠٪',
      weight: 70,
    }),
    Object.freeze({
      id: 'spark',
      kind: 'display-crumb',
      labelAr: 'شرارة ذهبية',
      oddsLabelAr: '٢٥٪',
      weight: 25,
    }),
    Object.freeze({
      id: 'crown-crumb',
      kind: 'display-crumb',
      labelAr: 'تاج لحظي',
      oddsLabelAr: '٥٪',
      weight: 5,
    }),
  ]),
  tableId: 'default',
  version: 1,
});

const DEFAULT_MAGIC_FRAME_TEMPLATES = Object.freeze([
  Object.freeze({
    accentColor: '#E4B45F',
    labelAr: 'إطار ذهبي',
    templateId: 'gold-frame',
  }),
  Object.freeze({
    accentColor: '#C43B55',
    labelAr: 'إطار ياقوتي',
    templateId: 'ruby-frame',
  }),
  Object.freeze({
    accentColor: '#2BCB88',
    labelAr: 'إطار زمردي',
    templateId: 'emerald-frame',
  }),
]);

function mapGiftTheater(value) {
  if (value === undefined || value === null) {
    return { luckyTableId: 'default', tags: [] };
  }
  if (!isRecord(value)) return undefined;
  const allowedKeys = ['luckyTableId', 'tags'];
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) return undefined;
  const tags = Array.isArray(value.tags)
    ? [...new Set(value.tags.filter((tag) => GIFT_THEATER_TAGS.includes(tag)))]
    : [];
  if (Array.isArray(value.tags) && value.tags.some((tag) => !GIFT_THEATER_TAGS.includes(tag))) {
    return undefined;
  }
  const luckyTableId = value.luckyTableId === undefined
    ? 'default'
    : (typeof value.luckyTableId === 'string' ? value.luckyTableId.trim() : '');
  if (!TEMPLATE_ID_PATTERN.test(luckyTableId)) return undefined;
  if (tags.includes('lucky') === false && value.luckyTableId !== undefined && luckyTableId !== 'default') {
    // Allow default table id even without lucky tag for simpler admin saves.
  }
  return { luckyTableId, tags };
}

function mapLuckyGiftTable(value) {
  if (!isRecord(value)) return null;
  const tableId = typeof value.tableId === 'string' ? value.tableId.trim() : '';
  const version = Number.isInteger(value.version) && value.version >= 1 ? value.version : 0;
  if (!TEMPLATE_ID_PATTERN.test(tableId) || version < 1 || !Array.isArray(value.entries) || !value.entries.length) {
    return null;
  }
  const entries = [];
  for (const entry of value.entries) {
    if (!isRecord(entry)) return null;
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    const kind = entry.kind === 'display-crumb' || entry.kind === 'none' ? entry.kind : '';
    const labelAr = typeof entry.labelAr === 'string' ? entry.labelAr.trim() : '';
    const oddsLabelAr = typeof entry.oddsLabelAr === 'string' ? entry.oddsLabelAr.trim() : '';
    const weight = Number(entry.weight);
    if (
      !TEMPLATE_ID_PATTERN.test(id)
      || !kind
      || labelAr.length < 2
      || labelAr.length > 40
      || oddsLabelAr.length < 1
      || oddsLabelAr.length > 16
      || !Number.isSafeInteger(weight)
      || weight < 1
      || weight > 10_000
    ) {
      return null;
    }
    entries.push({ id, kind, labelAr, oddsLabelAr, weight });
  }
  return { entries, tableId, version };
}

function mapMagicGiftFrameTemplates(value) {
  if (!Array.isArray(value) || !value.length || value.length > 24) return null;
  const templates = [];
  const seen = new Set();
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    const templateId = typeof entry.templateId === 'string' ? entry.templateId.trim() : '';
    const labelAr = typeof entry.labelAr === 'string' ? entry.labelAr.trim() : '';
    const accentColor = typeof entry.accentColor === 'string' ? entry.accentColor.trim() : '';
    if (
      !TEMPLATE_ID_PATTERN.test(templateId)
      || seen.has(templateId)
      || labelAr.length < 2
      || labelAr.length > 40
      || !/^#[0-9A-Fa-f]{6}$/.test(accentColor)
    ) {
      return null;
    }
    seen.add(templateId);
    templates.push({ accentColor, labelAr, templateId });
  }
  return templates;
}

function resolvePublishedLuckyTable(documentData, tableId = 'default') {
  const mapped = mapLuckyGiftTable(documentData);
  if (mapped && mapped.tableId === tableId) return mapped;
  if (tableId === DEFAULT_LUCKY_TABLE.tableId) return { ...DEFAULT_LUCKY_TABLE, entries: [...DEFAULT_LUCKY_TABLE.entries] };
  return null;
}

function resolvePublishedMagicTemplates(documentData) {
  const mapped = mapMagicGiftFrameTemplates(documentData?.templates || documentData);
  if (mapped) return mapped;
  return DEFAULT_MAGIC_FRAME_TEMPLATES.map((entry) => ({ ...entry }));
}

function resolveGiftTheaterFlags(growthFeatures = {}) {
  return {
    giftCombos: growthFeatures.giftCombos === true,
    luckyGifts: growthFeatures.luckyGifts === true,
    magicGiftTemplates: growthFeatures.magicGiftTemplates === true,
  };
}

function resolveGiftComboForTheater({
  combosEnabled,
  existing,
  giftId,
  nowMs,
  quantity,
  requestId,
  senderUid,
  targetUid,
  tier,
  resolveGiftComboState,
}) {
  if (!combosEnabled) {
    const comboId = `combo_${createHash('sha256').update(`${senderUid}|${targetUid}|${giftId}`).digest('hex').slice(0, 32)}`;
    return {
      comboCount: quantity,
      comboId,
      comboKey: comboId,
      comboWindowId: `gcw_${createHash('sha256')
        .update(`${comboId}|${requestId || nowMs}`)
        .digest('hex')
        .slice(0, 24)}`,
      giftId,
      senderUid,
      sequence: 1,
      targetUid,
      tier,
      windowExpiresAtMs: nowMs,
    };
  }
  return resolveGiftComboState({
    existing,
    giftId,
    nowMs,
    quantity,
    requestId,
    senderUid,
    targetUid,
    tier,
  });
}

function resolveLuckyGiftRoll({ giftId, requestId, table }) {
  if (!table?.entries?.length || !requestId) {
    return { ok: false, code: 'LUCKY_TABLE_UNAVAILABLE' };
  }
  const totalWeight = table.entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (!Number.isSafeInteger(totalWeight) || totalWeight < 1) {
    return { ok: false, code: 'LUCKY_TABLE_UNAVAILABLE' };
  }
  const digest = createHash('sha256')
    .update(`lucky-gift|${requestId}|${giftId}|${table.tableId}|${table.version}`)
    .digest('hex');
  const roll = Number.parseInt(digest.slice(0, 8), 16) % totalWeight;
  let cursor = 0;
  let selected = table.entries[table.entries.length - 1];
  for (const entry of table.entries) {
    cursor += entry.weight;
    if (roll < cursor) {
      selected = entry;
      break;
    }
  }
  return {
    ok: true,
    value: {
      entryId: selected.id,
      kind: selected.kind,
      labelAr: selected.labelAr,
      oddsLabelAr: selected.oddsLabelAr,
      roll,
      seed: digest.slice(0, 16),
      tableId: table.tableId,
      tableVersion: table.version,
      totalWeight,
    },
  };
}

function resolveMagicGiftTemplate({ magicFrameTemplateId, templates }) {
  const templateId = typeof magicFrameTemplateId === 'string' ? magicFrameTemplateId.trim() : '';
  if (!TEMPLATE_ID_PATTERN.test(templateId)) {
    return { ok: false, code: 'INVALID_MAGIC_TEMPLATE' };
  }
  const match = (templates || []).find((entry) => entry.templateId === templateId);
  if (!match) return { ok: false, code: 'MAGIC_TEMPLATE_UNKNOWN' };
  return {
    ok: true,
    value: {
      accentColor: match.accentColor,
      labelAr: match.labelAr,
      templateId: match.templateId,
    },
  };
}

function resolveGiftTheaterKind({ presentationTier, tags = [] }) {
  if (tags.includes('storm') || presentationTier === 'major' || presentationTier === 'global') {
    return 'storm';
  }
  if (tags.includes('lucky')) return 'lucky';
  if (tags.includes('magic')) return 'magic';
  if (tags.includes('combo')) return 'combo';
  return 'standard';
}

function publicLuckyOdds(table) {
  const resolved = table || DEFAULT_LUCKY_TABLE;
  const totalWeight = resolved.entries.reduce((sum, entry) => sum + entry.weight, 0);
  return {
    entries: resolved.entries.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      labelAr: entry.labelAr,
      oddsLabelAr: entry.oddsLabelAr,
      weight: entry.weight,
    })),
    tableId: resolved.tableId,
    totalWeight,
    version: resolved.version,
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

module.exports = {
  DEFAULT_LUCKY_TABLE,
  DEFAULT_MAGIC_FRAME_TEMPLATES,
  GIFT_THEATER_TAGS,
  mapGiftTheater,
  mapLuckyGiftTable,
  mapMagicGiftFrameTemplates,
  publicLuckyOdds,
  resolveGiftComboForTheater,
  resolveGiftTheaterFlags,
  resolveGiftTheaterKind,
  resolveLuckyGiftRoll,
  resolveMagicGiftTemplate,
  resolvePublishedLuckyTable,
  resolvePublishedMagicTemplates,
};
