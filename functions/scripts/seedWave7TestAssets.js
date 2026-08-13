'use strict';

const admin = require('firebase-admin');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const {
  normalizeAdminCosmeticsAssetMutation,
} = require('../adminCosmeticsAssetCore');
const {
  mutateAdminCosmeticsAsset,
} = require('../adminCosmeticsAssetService');
const {
  buildCanonicalStoragePath,
  extensionForFormat,
  inspectCosmeticAssetBuffer,
} = require('../cosmeticsAssetValidationCore');
const {
  normalizeAdminRoomThemeMutation,
} = require('../adminRoomThemeCore');
const {
  mutateAdminRoomTheme,
} = require('../adminRoomThemeService');
const {
  validateRoomThemeManifest,
} = require('../roomThemeCore');

const DEFAULT_BUCKET = 'yallgame-ebd19.firebasestorage.app';
const TEST_THEME_ID = 'ruby-constellation';
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const ASSET_SOURCES = Object.freeze([
  {
    assetId: 'wave7-test-reaction-static',
    category: 'room-reaction',
    contentType: 'image/png',
    filePath: path.join(PROJECT_ROOT, 'assets/favicon.png'),
    format: 'png',
    usage: 'static',
  },
  {
    assetId: 'wave7-test-reaction-ring',
    category: 'room-reaction',
    contentType: 'application/json',
    fallbackAssetId: 'wave7-test-reaction-static',
    filePath: path.join(PROJECT_ROOT, 'assets/cosmetics-lab/wave0-ring.json'),
    format: 'lottie-json',
    usage: 'looping',
  },
  {
    assetId: 'wave7-test-theme-static',
    category: 'room-theme',
    contentType: 'image/png',
    filePath: path.join(PROJECT_ROOT, 'assets/room-themes/ruby-constellation/background-v1.png'),
    format: 'png',
    usage: 'static',
  },
  {
    assetId: 'wave7-test-theme-ring',
    category: 'room-theme',
    contentType: 'application/json',
    fallbackAssetId: 'wave7-test-theme-static',
    filePath: path.join(PROJECT_ROOT, 'assets/cosmetics-lab/wave0-ring.json'),
    format: 'lottie-json',
    usage: 'looping',
  },
]);

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const apply = process.argv.includes('--apply');
  const actorUid = readArgument('--actor-uid');
  const bucketName = readArgument('--bucket') || DEFAULT_BUCKET;
  if (apply && !actorUid) throw new Error('--actor-uid is required with --apply.');

  admin.initializeApp({ storageBucket: bucketName });
  const db = admin.firestore();
  const bucket = admin.storage().bucket(bucketName);
  const assets = await loadAndInspectAssets();
  await preflight({ actorUid, apply, assets, db });

  console.info(JSON.stringify({
    actorUid: actorUid || '',
    apply,
    assets: assets.map(({ assetId, assetVersionId, category, format }) => ({
      assetId,
      assetVersionId,
      category,
      format,
    })),
    bucket: bucketName,
    reactionCatalog: assets
      .filter((asset) => asset.category === 'room-reaction')
      .map(assetReference),
    themeId: TEST_THEME_ID,
  }, null, 2));
  if (!apply) return;

  for (const asset of assets) {
    await publishAsset({ actorUid, asset, bucket, db });
  }
  await publishReactionCatalog({ actorUid, assets, db });
  await publishTestThemeMotion({ actorUid, assets, db });
  console.info(JSON.stringify({ applied: true, testSeed: 'wave7', themeId: TEST_THEME_ID }));
}

async function loadAndInspectAssets() {
  const assets = [];
  for (const source of ASSET_SOURCES) {
    const buffer = await fs.readFile(source.filePath);
    const inspection = await inspectCosmeticAssetBuffer({
      buffer,
      category: source.category,
      contentType: source.contentType,
      format: source.format,
      loop: source.usage === 'looping',
      usage: source.usage,
    });
    if (!inspection.ok) throw new Error(`${source.assetId}: ${inspection.reason}`);
    assets.push({
      ...source,
      assetVersionId: `v1-${inspection.value.sha256.slice(0, 12)}`,
      buffer,
      inspection: inspection.value,
    });
  }
  for (const asset of assets) {
    if (!asset.fallbackAssetId) continue;
    const fallback = assets.find((candidate) => candidate.assetId === asset.fallbackAssetId);
    if (!fallback || !['png', 'jpeg'].includes(fallback.format) || fallback.category !== asset.category) {
      throw new Error(`${asset.assetId}: a same-category static fallback is required.`);
    }
    asset.fallbackAssetVersionId = fallback.assetVersionId;
  }
  return assets;
}

async function preflight({ actorUid, apply, assets, db }) {
  if (apply) await requirePlatformOwner(db, actorUid);
  const [config, theme, ...summaries] = await Promise.all([
    db.doc('appConfig/cosmeticsFeatures').get(),
    db.doc(`roomThemes/${TEST_THEME_ID}`).get(),
    ...assets.map((asset) => db.doc(`cosmeticAssets/${asset.assetId}`).get()),
  ]);
  if (!config.exists) throw new Error('appConfig/cosmeticsFeatures was not found.');
  const flags = config.data() || {};
  const requiredFlags = [
    'cosmetics_asset_registry',
    'cosmetics_lottie',
    'cosmetics_shared_renderer',
    'room_animated_themes',
    'room_reactions',
  ];
  const disabledFlags = requiredFlags.filter((flag) => flags[flag] !== true);
  if (disabledFlags.length > 0) {
    throw new Error(`Required Wave 7 flags are disabled: ${disabledFlags.join(', ')}`);
  }
  if (!theme.exists || !validateRoomThemeManifest(theme.data(), TEST_THEME_ID)) {
    throw new Error(`${TEST_THEME_ID} is missing or has an invalid manifest.`);
  }
  for (let index = 0; index < assets.length; index += 1) {
    const snapshot = summaries[index];
    if (!snapshot.exists) continue;
    const asset = assets[index];
    const summary = snapshot.data() || {};
    if (
      summary.assetId !== asset.assetId
      || summary.category !== asset.category
      || summary.ownerType !== 'platform'
      || summary.publishedVersionId !== asset.assetVersionId
      || summary.approvedVersionId !== asset.assetVersionId
      || summary.publicationStatus !== 'published'
      || summary.moderationStatus !== 'approved'
      || summary.renderingEnabled !== true
    ) {
      throw new Error(`${asset.assetId} already exists with conflicting state.`);
    }
  }
}

async function publishAsset({ actorUid, asset, bucket, db }) {
  const summaryRef = db.doc(`cosmeticAssets/${asset.assetId}`);
  const existing = await summaryRef.get();
  if (existing.exists) {
    await verifyPublishedAsset({ asset, db });
    console.info(JSON.stringify({ assetId: asset.assetId, status: 'already-published' }));
    return;
  }

  const identity = assetIdentity(asset);
  const storagePath = buildCanonicalStoragePath(identity, extensionForFormat(asset.format));
  await saveImmutableObject(bucket, storagePath, asset);
  const context = {
    bucket,
    db,
    decodedToken: { email: '', uid: actorUid },
    fieldValue: admin.firestore.FieldValue,
  };
  await runAssetMutation(context, {
    asset: identity,
    expectedRevision: 0,
    operation: 'validate-version',
    reason: 'Wave 7 test-only asset validation',
    requestId: requestId(asset.assetId, 'validate'),
  });
  await runAssetMutation(context, {
    assetId: asset.assetId,
    assetVersionId: asset.assetVersionId,
    expectedRevision: 1,
    operation: 'approve-version',
    reason: 'Platform Owner approved Wave 7 test-only asset',
    requestId: requestId(asset.assetId, 'approve'),
  });
  await runAssetMutation(context, {
    assetId: asset.assetId,
    assetVersionId: asset.assetVersionId,
    expectedRevision: 2,
    operation: 'publish-version',
    reason: 'Publish Wave 7 test-only asset',
    requestId: requestId(asset.assetId, 'publish'),
  });
  console.info(JSON.stringify({ assetId: asset.assetId, status: 'published' }));
}

async function saveImmutableObject(bucket, storagePath, asset) {
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (exists) {
    const [stored] = await file.download();
    const storedSha = crypto.createHash('sha256').update(stored).digest('hex');
    if (storedSha !== asset.inspection.sha256) {
      throw new Error(`${storagePath} exists with different immutable bytes.`);
    }
    return;
  }
  await file.save(asset.buffer, {
    metadata: {
      cacheControl: 'public,max-age=31536000,immutable',
      contentType: asset.contentType,
      metadata: { wave7TestSeed: 'true' },
    },
    preconditionOpts: { ifGenerationMatch: 0 },
    resumable: false,
    validation: 'crc32c',
  });
}

async function runAssetMutation(context, body) {
  const normalized = normalizeAdminCosmeticsAssetMutation(body);
  if (!normalized.ok) throw new Error(normalized.error);
  return mutateAdminCosmeticsAsset({ ...context, input: normalized.value });
}

async function verifyPublishedAsset({ asset, db }) {
  const [version, approval] = await Promise.all([
    db.doc(`cosmeticAssets/${asset.assetId}/versions/${asset.assetVersionId}`).get(),
    db.doc(`cosmeticAssetApprovals/${asset.assetId}__${asset.assetVersionId}`).get(),
  ]);
  if (
    !version.exists
    || version.data()?.sha256 !== asset.inspection.sha256
    || !approval.exists
    || approval.data()?.decision !== 'approved'
    || approval.data()?.checksum !== asset.inspection.sha256
  ) {
    throw new Error(`${asset.assetId} is published but its immutable records are invalid.`);
  }
}

async function publishReactionCatalog({ actorUid, assets, db }) {
  const catalog = assets
    .filter((asset) => asset.category === 'room-reaction')
    .map(assetReference);
  const configRef = db.doc('appConfig/cosmeticsFeatures');
  const auditRef = db.doc('adminAuditEvents/wave7_test_reaction_catalog_v1');
  await db.runTransaction(async (transaction) => {
    const [config, audit] = await transaction.getAll(configRef, auditRef);
    if (!config.exists) throw new Error('appConfig/cosmeticsFeatures was not found.');
    if (sameReferences(config.data()?.room_reaction_catalog, catalog)) return;
    if (audit.exists && audit.data()?.actorUid !== actorUid) {
      throw new Error('Wave 7 test reaction catalog audit belongs to another actor.');
    }
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    transaction.set(configRef, {
      cosmetics_asset_registry: true,
      cosmetics_lottie: true,
      cosmetics_shared_renderer: true,
      room_reaction_catalog: catalog,
      room_reactions: true,
      updatedAt: timestamp,
      updatedBy: actorUid,
    }, { merge: true });
    transaction.set(auditRef, {
      action: 'wave7-test-reaction-catalog-publish',
      actorUid,
      createdAt: timestamp,
      id: auditRef.id,
      kind: 'cosmetics-rollout',
      status: 'completed',
      testOnly: true,
    });
  });
  console.info(JSON.stringify({ reactionCatalog: catalog, status: 'published' }));
}

async function publishTestThemeMotion({ actorUid, assets, db }) {
  const animated = assets.find((asset) => asset.assetId === 'wave7-test-theme-ring');
  const themeRef = db.doc(`roomThemes/${TEST_THEME_ID}`);
  const snapshot = await themeRef.get();
  const current = snapshot.exists
    ? validateRoomThemeManifest(snapshot.data(), TEST_THEME_ID)
    : undefined;
  if (!current) throw new Error(`${TEST_THEME_ID} has an invalid manifest.`);
  const motion = {
    ambient: [{
      asset: assetReference(animated),
      height: 0.22,
      id: 'test-ring',
      width: 0.22,
      x: 0.68,
      y: 0.1,
    }],
    background: null,
  };
  if (current.manifestVersion >= 2 && sameMotion(current.motion, motion)) {
    console.info(JSON.stringify({ status: 'already-published', themeId: TEST_THEME_ID }));
    return;
  }
  const normalized = normalizeAdminRoomThemeMutation({
    expectedRevision: current.revision,
    manifest: { ...current, manifestVersion: current.manifestVersion >= 2 ? current.manifestVersion : 2, motion },
    operation: 'publish',
    reason: 'Publish test-only Wave 7 ambient room motion',
    requestId: `wave7_test_theme_publish_r${current.revision}`,
    themeId: TEST_THEME_ID,
  });
  if (!normalized.ok) throw new Error(normalized.error);
  const result = await mutateAdminRoomTheme({
    db,
    decodedToken: { email: '', uid: actorUid },
    fieldValue: admin.firestore.FieldValue,
    input: normalized.value,
  });
  console.info(JSON.stringify({ revision: result.revision, status: 'published', themeId: TEST_THEME_ID }));
}

function assetIdentity(asset) {
  return {
    assetId: asset.assetId,
    assetVersionId: asset.assetVersionId,
    audioAssetId: '',
    audioAssetVersionId: '',
    category: asset.category,
    fallbackAssetId: asset.fallbackAssetId || '',
    fallbackAssetVersionId: asset.fallbackAssetVersionId || '',
    format: asset.format,
    loop: asset.usage === 'looping',
    minimumClientVersion: '1.0.0',
    ownerType: 'platform',
    ownerUid: '',
    performanceTier: 'low',
    slot: '',
    usage: asset.usage,
  };
}

function assetReference(asset) {
  return { assetId: asset.assetId, assetVersionId: asset.assetVersionId };
}

function sameReferences(left, right) {
  return JSON.stringify(left || []) === JSON.stringify(right || []);
}

function sameMotion(left, right) {
  return JSON.stringify(left || null) === JSON.stringify(right);
}

function requestId(assetId, operation) {
  return `wave7_test_${assetId}_${operation}`.slice(0, 80);
}

async function requirePlatformOwner(db, actorUid) {
  const snapshot = await db.doc(`adminProfiles/${actorUid}`).get();
  const profile = snapshot.exists ? snapshot.data() : null;
  if (!profile || profile.uid !== actorUid || profile.role !== 'owner' || profile.status !== 'active') {
    throw new Error('The actor must be an active Platform Owner.');
  }
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
}
