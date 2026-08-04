'use strict';

const ASSET_FIELD = /(asset|artwork|audio|animation|background|badge|bubble|dock|drawer|effect|frame|image|preview|sound|stage|storage|theme|thumbnail|uri|url)/i;
const SUPPORTED_FORMATS = new Set(['jpeg', 'json', 'm4a', 'mp4', 'png']);
const LEGACY_FORMATS = new Set(['animated-webp', 'gif', 'mp3', 'webp']);

function buildCosmeticAssetInventory(documents) {
  const references = documents.flatMap(extractDocumentReferences);
  const counts = new Map();
  references.forEach((reference) => {
    const key = reference.location;
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  const items = references.map((reference) => {
    const issues = [];
    if (!reference.format) issues.push('unknown-format');
    if (LEGACY_FORMATS.has(reference.format)) issues.push('legacy-format-requires-conversion');
    if (reference.format && !SUPPORTED_FORMATS.has(reference.format)
      && !LEGACY_FORMATS.has(reference.format)) issues.push('unsupported-format');
    if (!reference.versioned) issues.push('mutable-or-unversioned-location');
    if ((counts.get(reference.location) || 0) > 1) issues.push('duplicate-reference');
    if (reference.animated && !reference.hasStaticFallback) issues.push('missing-static-fallback');
    return { ...reference, issues };
  });

  const documentsWithoutVisuals = documents
    .filter((document) => document.collection === 'giftCatalog')
    .filter((document) => !references.some((item) => item.documentId === document.id
      && item.collection === document.collection))
    .map((document) => ({ collection: document.collection, documentId: document.id }));
  const issueCounts = {};
  items.flatMap((item) => item.issues).forEach((issue) => {
    issueCounts[issue] = (issueCounts[issue] || 0) + 1;
  });
  if (documentsWithoutVisuals.length) {
    issueCounts['gift-without-visual-asset'] = documentsWithoutVisuals.length;
  }

  return {
    generatedAt: new Date().toISOString(),
    issueCounts,
    items,
    summary: {
      documentsScanned: documents.length,
      documentsWithoutVisuals: documentsWithoutVisuals.length,
      referencesFound: items.length,
      referencesNeedingReview: items.filter((item) => item.issues.length > 0).length,
      uniqueLocations: counts.size,
    },
    documentsWithoutVisuals,
  };
}

function extractDocumentReferences(document) {
  const values = [];
  visit(document.data, [], values);
  const staticLocations = new Set(values
    .filter((value) => isStaticFormat(inferFormat(value.location, value.path, value.explicitFormat)))
    .map((value) => parentPath(value.path)));
  const documentHasStaticFallback = values.some((value) => {
    const path = value.path.toLowerCase();
    return /(fallback|static|thumbnail|preview)/.test(path)
      && isStaticFormat(inferFormat(value.location, value.path, value.explicitFormat));
  });

  return values.map((value) => {
    const format = inferFormat(value.location, value.path, value.explicitFormat);
    const storagePath = storagePathFromLocation(value.location);
    const animated = isAnimatedFormat(format, value.path);
    return {
      animated,
      collection: document.collection,
      documentId: document.id,
      fieldPath: value.path,
      format,
      hasStaticFallback: !animated || documentHasStaticFallback
        || staticLocations.has(parentPath(value.path)),
      location: value.location,
      locationKind: storagePath ? 'storage' : 'https',
      storagePath,
      suggestedCategory: suggestCategory(document.collection, document.data),
      versioned: isVersioned(storagePath || value.location),
    };
  });
}

function visit(value, path, output) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, [...path, String(index)], output));
    return;
  }
  const explicitFormat = normalizeFormat(value.format);
  Object.entries(value).forEach(([key, child]) => {
    const childPath = [...path, key];
    if (typeof child === 'string' && ASSET_FIELD.test(key) && isAssetLocation(child)) {
      output.push({ explicitFormat, location: child.trim(), path: childPath.join('.') });
      return;
    }
    visit(child, childPath, output);
  });
}

function inferFormat(location, path = '', explicitFormat = '') {
  const normalized = normalizeFormat(explicitFormat);
  if (normalized) return normalized;
  const clean = String(location).split(/[?#]/, 1)[0].toLowerCase();
  const extension = clean.match(/\.([a-z0-9]+)$/)?.[1] || '';
  if (extension === 'jpg') return 'jpeg';
  if (extension === 'json') return 'json';
  if (extension === 'webp' && /(animation|animated|effect)/i.test(path)) return 'animated-webp';
  return extension;
}

function normalizeFormat(value) {
  const format = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (format === 'jpg') return 'jpeg';
  if (format === 'lottie') return 'json';
  if (format === 'audio/mpeg') return 'mp3';
  return format;
}

function storagePathFromLocation(location) {
  if (/^[a-z0-9][a-z0-9_./-]{2,1023}$/i.test(location) && !location.includes('://')) {
    return location.replace(/^\/+/, '');
  }
  try {
    const url = new URL(location);
    const marker = '/o/';
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex >= 0 && /(?:firebasestorage\.googleapis\.com|storage\.googleapis\.com)$/i.test(url.hostname)) {
      return decodeURIComponent(url.pathname.slice(markerIndex + marker.length));
    }
  } catch {
    return '';
  }
  return '';
}

function isAssetLocation(value) {
  const text = value.trim();
  return /^https:\/\/[^\s]{1,2040}$/i.test(text)
    || (
      /^[a-z0-9][a-z0-9_./-]{2,1023}$/i.test(text)
      && (text.includes('/') || /\.[a-z0-9]{2,5}$/i.test(text))
    );
}

function isAnimatedFormat(format, path) {
  return ['animated-webp', 'gif', 'json', 'mp4'].includes(format)
    || /(animation|animated)/i.test(path);
}

function isStaticFormat(format) {
  return ['jpeg', 'png', 'webp'].includes(format);
}

function isVersioned(value) {
  return /(?:^|\/)(?:v\d+|version[-_]?\d+|[a-z0-9_-]+__v\d+)(?:\/|$)/i.test(value)
    || /(?:^|\/)versions?\/[a-z0-9_-]+(?:\/|$)/i.test(value);
}

function parentPath(path) {
  return path.split('.').slice(0, -1).join('.');
}

function suggestCategory(collection, data) {
  if (collection === 'roomThemes') return 'room-theme';
  if (collection === 'roomRocketCampaigns') return 'gift-effect';
  if (collection === 'giftCatalog') return 'gift-effect';
  if (collection !== 'storeCatalog') return '';
  const category = String(data?.category || '');
  if (category === 'avatar-frames') return 'avatar-frame';
  if (category === 'cars') return 'entrance-effect';
  if (category === 'chat-themes') return 'chat-bubble';
  return '';
}

module.exports = {
  buildCosmeticAssetInventory,
  extractDocumentReferences,
  inferFormat,
  storagePathFromLocation,
};
