const admin = require('firebase-admin');
const crypto = require('node:crypto');
const path = require('node:path');

admin.initializeApp();

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
  const grantRoomId = readArgument('--grant-room');
  if (apply && (!actorUid || !bucketName)) throw new Error('--actor-uid and --bucket are required with --apply.');
  const db = admin.firestore();
  if (apply) await requirePlatformOwner(db, actorUid);
  console.info(JSON.stringify({ apply, bucketName, grantRoomId, themes: themes.map((theme) => theme.id) }));
  if (!apply) return;
  const bucket = admin.storage().bucket(bucketName);
  for (const theme of themes) {
    const storagePath = `room-theme-assets/${theme.id}/v1/background.png`;
    const file = bucket.file(storagePath);
    const [exists] = await file.exists();
    let token = crypto.randomUUID();
    if (!exists) {
      await bucket.upload(path.resolve(__dirname, `../../assets/room-themes/${theme.id}/background-v1.png`), {
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
    const backgroundUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    await db.doc(`roomThemes/${theme.id}`).set({
      ...manifest(theme, backgroundUrl),
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
        previewAssetUrl: backgroundUrl,
        prices: theme.prices,
        purchasingEnabled: false,
        stock: { kind: 'unlimited' },
        thumbnailUrl: backgroundUrl,
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

function manifest(theme, backgroundUrl) {
  const royal = theme.layout === 'theater';
  const constellation = theme.layout === 'grid';
  return {
    manifestVersion: 1,
    themeId: theme.id,
    publicationStatus: 'published',
    renderingEnabled: true,
    purchasingEnabled: Boolean(theme.prices),
    minimumClientVersion: '1.0.0',
    revision: 1,
    assets: {
      background: { uri: backgroundUrl, version: 1 },
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
    layouts: Object.fromEntries([5, 10, 15, 20].map((count) => [
      String(count),
      theme.layout === 'theater' ? theater(count) : theme.layout === 'grid' ? grid(count) : majlis(count),
    ])),
  };
}

function majlis(count) {
  if (count === 5) return points([[0.16, 0.34], [0.32, 0.18], [0.5, 0.13], [0.68, 0.18], [0.84, 0.34]]);
  const rows = Math.ceil(count / 5);
  const output = [];
  for (let row = 0; row < rows; row += 1) {
    const progress = rows === 1 ? 1 : row / (rows - 1);
    output.push(...spread(
      Math.min(5, count - output.length),
      0.18 - progress * 0.08,
      0.82 + progress * 0.08,
      rows === 2 ? 0.22 + row * 0.48 : 0.1 + row * (0.78 / (rows - 1)),
    ));
  }
  return points(output);
}

function theater(count) {
  const rows = Math.ceil(count / 5);
  const output = [];
  for (let row = 0; row < rows; row += 1) {
    const progress = rows === 1 ? 1 : row / (rows - 1);
    output.push(...spread(
      Math.min(5, count - output.length),
      0.2 - progress * 0.1,
      0.8 + progress * 0.1,
      rows === 1 ? 0.42 : 0.12 + row * (0.76 / (rows - 1)),
    ));
  }
  return points(output);
}

function grid(count) {
  const output = [];
  const rows = Math.ceil(count / 5);
  for (let row = 0; row < rows; row += 1) {
    output.push(...spread(Math.min(5, count - output.length), 0.11, 0.89, rows === 1 ? 0.4 : 0.16 + row * (0.68 / Math.max(1, rows - 1))));
  }
  return points(output);
}

function spread(count, start, end, y) {
  if (count < 1) return [];
  if (count === 1) return [[0.5, y]];
  return Array.from({ length: count }, (_, index) => [start + ((end - start) * index) / (count - 1), y]);
}

function points(values) {
  return values.map(([x, y], index) => ({
    seatNumber: index + 1,
    x: Math.round(x * 1000) / 1000,
    y: Math.round(y * 1000) / 1000,
    scale: 1,
    z: index + 1,
  }));
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
