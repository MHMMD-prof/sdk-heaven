const admin = require('firebase-admin');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createProductionRoomThemeLayouts } = require('../roomThemeProductionLayouts');

const themes = [
  { id: 'majlis-default', ar: 'المجلس', en: 'Majlis Default', layout: 'majlis' },
  { id: 'royal-theater', ar: 'المسرح الملكي', en: 'Royal Theater', layout: 'theater', prices: { coins: 25000, diamonds: 250 } },
  { id: 'ruby-constellation', ar: 'كوكبة الياقوت', en: 'Ruby Constellation', layout: 'grid', prices: { coins: 18000, diamonds: 180 } },
];

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const apply = process.argv.includes('--apply');
  const actorUid = readArgument('--actor-uid');
  const bucketName = readArgument('--bucket');
  const credentialFile = readArgument('--credential-file');
  const grantRoomId = readArgument('--grant-room');
  if (apply && (!actorUid || !bucketName)) throw new Error('--actor-uid and --bucket are required with --apply.');
  if (credentialFile) {
    const resolvedCredentialFile = path.resolve(credentialFile);
    if (!fs.existsSync(resolvedCredentialFile)) throw new Error('--credential-file was not found.');
    const serviceAccount = JSON.parse(fs.readFileSync(resolvedCredentialFile, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
      storageBucket: bucketName,
    });
  } else {
    admin.initializeApp({ storageBucket: bucketName });
  }
  const db = admin.firestore();
  if (apply) await requirePlatformOwner(db, actorUid);
  console.info(JSON.stringify({ apply, bucketName, grantRoomId, themes: themes.map((theme) => theme.id) }));
  if (!apply) return;
  const bucket = admin.storage().bucket(bucketName);
  for (const theme of themes) {
    const stageUrl = await uploadImmutableAsset({
      bucket,
      localPath: path.resolve(__dirname, `../../assets/room-themes/${theme.id}/stage-v2.png`),
      storagePath: `room-theme-assets/${theme.id}/v2/stage.png`,
    });
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    await db.doc(`roomThemes/${theme.id}`).set({
      ...manifest(theme, stageUrl),
      createdAt: timestamp,
      lastEditorUid: actorUid,
      publishedAt: timestamp,
      updatedAt: timestamp,
    }, { merge: true });
    if (theme.prices) {
      await db.doc(`storeCatalog/${theme.id}`).set({
        availability: 'available',
        category: 'chat-themes',
        createdAt: timestamp,
        description: {
          ar: theme.layout === 'theater' ? 'صفوف مسرحية منحنية بالياقوت والذهب.' : 'شبكة مرنة بإضاءة كوكبية ياقوتية.',
          en: theme.layout === 'theater' ? 'Curved royal theater rows in ruby and gold.' : 'A modular grid with ruby constellation light.',
        },
        duration: { kind: 'permanent' },
        itemId: theme.id,
        lastEditorEmail: '',
        lastEditorUid: actorUid,
        name: { ar: theme.ar, en: theme.en },
        order: theme.layout === 'theater' ? 30 : 31,
        previewAssetUrl: stageUrl,
        prices: theme.prices,
        purchasingEnabled: false,
        stock: { kind: 'unlimited' },
        thumbnailUrl: stageUrl,
        updatedAt: timestamp,
      }, { merge: true });
    }
    console.info(JSON.stringify({ path: `roomThemes/${theme.id}`, seeded: true }));
  }
  if (grantRoomId) {
    const room = await db.doc(`rooms/${grantRoomId}`).get();
    if (!room.exists) throw new Error(`Grant room ${grantRoomId} was not found.`);
    const batch = db.batch();
    for (const theme of themes.filter((candidate) => candidate.prices)) {
      const timestamp = admin.firestore.FieldValue.serverTimestamp();
      batch.set(db.doc(`rooms/${grantRoomId}/themeEntitlements/${theme.id}`), {
        acquiredAt: timestamp,
        acquiredByUid: actorUid,
        expiresAt: null,
        grantSource: 'wave16-test',
        itemId: theme.id,
        roomId: grantRoomId,
        state: 'active',
        themeId: theme.id,
        updatedAt: timestamp,
      });
    }
    await batch.commit();
    console.info(JSON.stringify({ granted: themes.filter((theme) => theme.prices).map((theme) => theme.id), roomId: grantRoomId }));
  }
}

function manifest(theme, stageUrl) {
  const royal = theme.layout === 'theater';
  const constellation = theme.layout === 'grid';
  const compactLayouts = createProductionRoomThemeLayouts(theme.id, 'compact');
  const standardLayouts = createProductionRoomThemeLayouts(theme.id, 'standard');
  const tallLayouts = createProductionRoomThemeLayouts(theme.id, 'tall');
  return {
    manifestVersion: 3,
    themeId: theme.id,
    publicationStatus: 'published',
    renderingEnabled: true,
    purchasingEnabled: Boolean(theme.prices),
    minimumClientVersion: '1.0.0',
    revision: 8,
    assets: {
      background: { uri: stageUrl, version: 2 },
      stage: null,
      emptySeatFrame: null,
      badge: null,
      dock: null,
      drawer: null,
    },
    colors: {
      background: royal ? '#090506' : constellation ? '#070407' : '#080405',
      panel: royal ? '#170B0D' : constellation ? '#120A10' : '#130A0B',
      panelRaised: royal ? '#291114' : constellation ? '#24101D' : '#211012',
      ruby: royal ? '#861923' : constellation ? '#731630' : '#74151D',
      rubyBright: royal ? '#C4323E' : constellation ? '#B72A4E' : '#B92A35',
      gold: '#D6A84F',
      goldSoft: '#F4D58A',
      text: '#FFF4DE',
      textMuted: '#CDBB9D',
    },
    layouts: standardLayouts,
    motion: { ambient: [], background: null },
    scene: {
      background: { fit: 'cover', focalX: 0.5, focalY: 0.5 },
      stage: { fit: 'cover', focalX: 0.5, focalY: 0.5 },
      profiles: {
        compact: { layouts: compactLayouts },
        standard: { layouts: standardLayouts },
        tall: { layouts: tallLayouts },
      },
    },
  };
}

async function uploadImmutableAsset({ bucket, localPath, storagePath }) {
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  let token = crypto.randomUUID();
  if (!exists) {
    await bucket.upload(localPath, {
      destination: storagePath,
      metadata: {
        cacheControl: 'public,max-age=31536000,immutable',
        contentType: 'image/png',
        metadata: { firebaseStorageDownloadTokens: token },
      },
    });
  } else {
    const [metadata] = await file.getMetadata();
    token = metadata.metadata?.firebaseStorageDownloadTokens || token;
  }
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
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
