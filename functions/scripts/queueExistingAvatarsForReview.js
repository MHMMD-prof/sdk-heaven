const crypto = require('node:crypto');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();
const bucket = admin.storage().bucket();
const apply = process.argv.includes('--apply');

async function main() {
  const profiles = await db.collection('publicProfiles').get();
  let queued = 0;
  let skipped = 0;
  for (const profile of profiles.docs) {
    const avatarUrl = typeof profile.data()?.avatarUrl === 'string' ? profile.data().avatarUrl.trim() : '';
    if (!avatarUrl) { skipped += 1; continue; }
    const uploadId = `avu_${crypto.createHash('sha256').update(`legacy-avatar-v1\0${profile.id}\0${avatarUrl}`).digest('hex').slice(0, 40)}`;
    const submissionRef = db.doc(`avatarSubmissions/${uploadId}`);
    if ((await submissionRef.get()).exists) { skipped += 1; continue; }
    const source = await readAvatar(avatarUrl);
    if (!source || source.bytes.length < 1 || source.bytes.length > 5 * 1024 * 1024) { skipped += 1; continue; }
    const extension = source.contentType === 'image/jpeg' ? 'jpg' : source.contentType.split('/')[1];
    const sourcePath = `avatar-quarantine/${profile.id}/${uploadId}/source.${extension}`;
    if (apply) {
      await bucket.file(sourcePath).save(source.bytes, {
        contentType: source.contentType,
        metadata: { cacheControl: 'private,no-store,max-age=0', metadata: { migration: 'legacy-avatar-v1', uploaderUid: profile.id, uploadId } },
        resumable: false,
      });
      await submissionRef.create({
        contentType: source.contentType,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        legacyApprovedAvatarUrl: avatarUrl,
        moderationReason: 'legacy-avatar-requires-review',
        scanner: 'legacy-migration',
        sha256: crypto.createHash('sha256').update(source.bytes).digest('hex'),
        sizeBytes: source.bytes.length,
        sourcePath,
        status: 'pending',
        uid: profile.id,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        uploadId,
      });
    }
    queued += 1;
  }
  console.info(JSON.stringify({ apply, queued, scanned: profiles.size, skipped }));
}

async function readAvatar(url) {
  const bucketPrefix = `https://storage.googleapis.com/${bucket.name}/`;
  const firebasePrefix = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/`;
  let path = '';
  if (url.startsWith(bucketPrefix)) path = url.slice(bucketPrefix.length).split('?')[0];
  if (url.startsWith(firebasePrefix)) path = decodeURIComponent(url.slice(firebasePrefix.length).split('?')[0]);
  if (path) {
    const file = bucket.file(path);
    const [[bytes], [metadata]] = await Promise.all([file.download(), file.getMetadata()]);
    const contentType = normalizeContentType(metadata.contentType, path);
    return contentType ? { bytes, contentType } : undefined;
  }
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) return undefined;
  const contentType = normalizeContentType(response.headers.get('content-type'), url);
  return contentType ? { bytes: Buffer.from(await response.arrayBuffer()), contentType } : undefined;
}

function normalizeContentType(value, path) {
  const type = String(value || '').split(';')[0].trim().toLowerCase();
  if (['image/jpeg', 'image/png', 'image/webp'].includes(type)) return type;
  if (/\.jpe?g(?:$|[?#])/i.test(path)) return 'image/jpeg';
  if (/\.png(?:$|[?#])/i.test(path)) return 'image/png';
  if (/\.webp(?:$|[?#])/i.test(path)) return 'image/webp';
  return '';
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
