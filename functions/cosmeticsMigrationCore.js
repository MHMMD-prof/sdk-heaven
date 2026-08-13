'use strict';

const ASSET_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,79}$/;
const VERSION_ID_PATTERN = /^v[1-9][0-9]{0,8}-[a-f0-9]{12}$/;

const MIGRATION_COLLECTIONS = Object.freeze([
  'storeCatalog',
  'giftCatalog',
  'roomRocketCampaigns',
  'roomThemes',
  'storeOwnerships',
  'storeEquipment',
  'publicProfiles',
]);

function isApprovedPublishedVersion(record = {}) {
  const assetId = readString(record.assetId);
  const assetVersionId = readString(record.assetVersionId);
  const expectedApprovalId = `${assetId}__${assetVersionId}`;
  return Boolean(
    ASSET_ID_PATTERN.test(assetId)
    && VERSION_ID_PATTERN.test(assetVersionId)
    && record.moderationStatus === 'approved'
    && record.publicationStatus === 'published'
    && record.renderingEnabled === true
    && record.approvedVersionId === assetVersionId
    && record.publishedVersionId === assetVersionId
    && record.approvalId === expectedApprovalId
    && record.approvalDecision === 'approved'
    && typeof record.sha256 === 'string'
    && /^[a-f0-9]{64}$/i.test(record.sha256)
    && (record.approvalChecksum === undefined || record.approvalChecksum === record.sha256),
  );
}

function buildApprovedRegistryIndex(records = []) {
  const byRef = new Map();
  const byStoragePath = new Map();
  for (const record of records) {
    if (!isApprovedPublishedVersion(record)) continue;
    const ref = {
      assetId: readString(record.assetId),
      assetVersionId: readString(record.assetVersionId),
    };
    const key = refKey(ref);
    byRef.set(key, { ...ref, sha256: record.sha256, storagePath: readString(record.storagePath) });
    const storagePath = readString(record.storagePath);
    if (storagePath) byStoragePath.set(storagePath, ref);
  }
  return { byRef, byStoragePath };
}

function planCosmeticAssetReferenceMigration({ documents = [], registry }) {
  const index = registry?.byRef instanceof Map
    ? registry
    : buildApprovedRegistryIndex(Array.isArray(registry) ? registry : []);
  const items = [];
  for (const document of documents) {
    if (!document || !MIGRATION_COLLECTIONS.includes(document.collection)) {
      items.push({
        action: 'skip',
        collection: document?.collection || '',
        documentId: document?.id || '',
        reason: 'unsupported-collection',
      });
      continue;
    }
    items.push(...planDocument(document, index));
  }
  const summary = {
    alreadyCanonical: items.filter((item) => item.action === 'already-canonical').length,
    documentsScanned: documents.length,
    invalidRefs: items.filter((item) => item.action === 'invalid-ref').length,
    patchesReady: items.filter((item) => item.action === 'patch').length,
    skipped: items.filter((item) => item.action === 'skip').length,
    unresolved: items.filter((item) => item.action === 'unresolved').length,
  };
  return {
    generatedAt: new Date().toISOString(),
    items,
    summary,
  };
}

function buildCosmeticMigrationPatches(plan, { apply = false } = {}) {
  const ready = (plan?.items || []).filter((item) => item.action === 'patch' && item.patch);
  if (!apply) {
    return {
      applied: false,
      dryRun: true,
      patches: ready,
      wouldWrite: ready.length,
    };
  }
  return {
    applied: true,
    dryRun: false,
    patches: ready,
    wouldWrite: ready.length,
  };
}

function mergeDualReadCanonicalFields(existingData, patch) {
  if (!isRecord(existingData) || !isRecord(patch)) return { ...(isRecord(existingData) ? existingData : {}) };
  const next = structuredClone(existingData);
  for (const [fieldPath, value] of Object.entries(patch)) {
    if (!isRecord(value) || !ASSET_ID_PATTERN.test(value.assetId) || !VERSION_ID_PATTERN.test(value.assetVersionId)) {
      continue;
    }
    setPath(next, fieldPath, { assetId: value.assetId, assetVersionId: value.assetVersionId });
  }
  return next;
}

function planDocument(document, index) {
  const candidates = extractReferenceSites(document);
  if (!candidates.length) {
    return [{
      action: 'skip',
      collection: document.collection,
      documentId: document.id,
      reason: 'no-reference-sites',
    }];
  }
  return candidates.map((site) => evaluateSite(document, site, index));
}

function evaluateSite(document, site, index) {
  const base = {
    collection: document.collection,
    documentId: document.id,
    fieldPath: site.fieldPath,
  };
  if (site.ref) {
    const approved = index.byRef.get(refKey(site.ref));
    if (!approved) {
      return { ...base, action: 'invalid-ref', reason: 'ref-not-approved-published', ref: site.ref };
    }
    return { ...base, action: 'already-canonical', ref: site.ref };
  }
  if (site.storagePath) {
    const mapped = index.byStoragePath.get(site.storagePath);
    if (mapped) {
      return {
        ...base,
        action: 'patch',
        patch: { [site.fieldPath]: mapped },
        reason: 'resolved-from-storage-path',
        ref: mapped,
      };
    }
  }
  return {
    ...base,
    action: 'unresolved',
    reason: site.storagePath ? 'storage-path-unmapped' : 'missing-canonical-ref',
    storagePath: site.storagePath || '',
  };
}

function extractReferenceSites(document) {
  const data = isRecord(document.data) ? document.data : {};
  switch (document.collection) {
    case 'storeCatalog':
      return [
        ...optionalRefSite('cosmeticAsset', data.cosmeticAsset),
        ...optionalRefSite('stickerAsset', data.stickerAsset),
        ...optionalRefSite('entryPresentation.visualAsset', data.entryPresentation?.visualAsset),
        ...optionalRefSite('entryPresentation.fallbackAsset', data.entryPresentation?.fallbackAsset),
        ...optionalRefSite('entryPresentation.audioAsset', data.entryPresentation?.audioAsset),
      ];
    case 'giftCatalog':
      return [
        ...optionalRefSite('presentation.visualAsset', data.presentation?.visualAsset),
        ...optionalRefSite('presentation.fallbackAsset', data.presentation?.fallbackAsset),
        ...optionalRefSite('presentation.audioAsset', data.presentation?.audioAsset),
      ];
    case 'roomRocketCampaigns':
      return [
        ...legacyAppearanceSite('appearance.animationAsset.canonicalAsset', data.appearance?.animationAsset),
        ...legacyAppearanceSite('appearance.staticAsset.canonicalAsset', data.appearance?.staticAsset),
        ...legacyAppearanceSite('appearance.soundAsset.canonicalAsset', data.appearance?.soundAsset),
      ];
    case 'roomThemes':
      return extractThemeSites(data);
    case 'storeOwnerships':
      return optionalRefSite('cosmeticAsset', data.cosmeticAsset);
    case 'storeEquipment':
      return extractEquipmentSites(data);
    case 'publicProfiles':
      return [
        ...extractPublicCosmeticSites(data),
        ...optionalRefSite('equippedAvatarFrame.canonicalAsset', data.equippedAvatarFrame?.canonicalAsset),
      ];
    default:
      return [];
  }
}

function extractThemeSites(data) {
  const sites = [];
  const background = data.motion?.background;
  if (background !== undefined) {
    sites.push(...optionalRefSite('motion.background', background));
  }
  const ambient = Array.isArray(data.motion?.ambient) ? data.motion.ambient : [];
  ambient.forEach((entry, index) => {
    if (entry?.asset !== undefined) {
      sites.push(...optionalRefSite(`motion.ambient.${index}.asset`, entry.asset));
    }
  });
  return sites;
}

function extractEquipmentSites(data) {
  const cosmetics = isRecord(data.cosmetics) ? data.cosmetics : {};
  return Object.entries(cosmetics).flatMap(([key, value]) => {
    if (!isRecord(value)) return [];
    const ref = mapRef(value);
    return [{
      fieldPath: `cosmetics.${key}`,
      ref,
      storagePath: '',
    }];
  });
}

function extractPublicCosmeticSites(data) {
  const cosmetics = isRecord(data.equippedCosmetics) ? data.equippedCosmetics : {};
  return Object.entries(cosmetics).flatMap(([key, value]) => {
    if (!isRecord(value)) return [];
    return [{
      fieldPath: `equippedCosmetics.${key}`,
      ref: mapRef(value),
      storagePath: '',
    }];
  });
}

function optionalRefSite(fieldPath, value) {
  if (value === undefined) return [];
  return [{
    fieldPath,
    ref: mapRef(value),
    storagePath: '',
  }];
}

function legacyAppearanceSite(fieldPath, appearance) {
  if (!isRecord(appearance)) return [];
  const existing = mapRef(appearance.canonicalAsset);
  if (existing) {
    return [{ fieldPath, ref: existing, storagePath: '' }];
  }
  const storagePath = readString(appearance.storagePath)
    || storagePathFromLocation(readString(appearance.uri));
  return [{
    fieldPath,
    ref: undefined,
    storagePath,
  }];
}

function mapRef(value) {
  if (!isRecord(value)) return undefined;
  const assetId = readString(value.assetId);
  const assetVersionId = readString(value.assetVersionId);
  return ASSET_ID_PATTERN.test(assetId) && VERSION_ID_PATTERN.test(assetVersionId)
    ? { assetId, assetVersionId }
    : undefined;
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

function setPath(target, fieldPath, value) {
  const parts = fieldPath.split('.');
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    if (!isRecord(cursor[key]) && !Array.isArray(cursor[key])) cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
}

function refKey(ref) {
  return `${ref.assetId}|${ref.assetVersionId}`;
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

module.exports = {
  MIGRATION_COLLECTIONS,
  buildApprovedRegistryIndex,
  buildCosmeticMigrationPatches,
  isApprovedPublishedVersion,
  mergeDualReadCanonicalFields,
  planCosmeticAssetReferenceMigration,
};
