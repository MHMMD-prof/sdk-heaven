const crypto = require('node:crypto');
const { validateRoomThemeManifestV1 } = require('./roomThemeCore');

async function getAdminRoomTheme({ db, themeId }) {
  const [theme, versions] = await Promise.all([
    db.doc(`roomThemes/${themeId}`).get(),
    db.collection(`roomThemes/${themeId}/versions`).orderBy('revision', 'desc').limit(20).get(),
  ]);
  return {
    manifest: theme.exists ? validateRoomThemeManifestV1(theme.data(), themeId) || null : null,
    versions: versions.docs.map((document) => ({
      manifest: validateRoomThemeManifestV1(document.data(), themeId) || null,
      revision: document.data()?.revision || 0,
    })).filter((entry) => entry.manifest),
  };
}

async function mutateAdminRoomTheme({ db, decodedToken, fieldValue, input }) {
  const themeRef = db.doc(`roomThemes/${input.themeId}`);
  const catalogRef = db.doc(`storeCatalog/${input.themeId}`);
  const auditRef = db.doc(`adminAuditEvents/room_theme_${input.requestId}`);
  const rollbackRef = input.operation === 'rollback'
    ? themeRef.collection('versions').doc(`v${input.rollbackRevision}`)
    : null;
  return db.runTransaction(async (transaction) => {
    const refs = [themeRef, catalogRef, auditRef, ...(rollbackRef ? [rollbackRef] : [])];
    const [themeSnapshot, catalogSnapshot, auditSnapshot, rollbackSnapshot] = await transaction.getAll(...refs);
    const fingerprint = stableFingerprint(input);
    if (auditSnapshot.exists) {
      const audit = auditSnapshot.data();
      if (audit.actorUid !== decodedToken.uid || audit.requestFingerprint !== fingerprint) {
        throw adminError(409, 'requestId was already used for another theme change.');
      }
      return { eventId: auditRef.id, replayed: true, revision: audit.revision };
    }
    const existing = themeSnapshot.exists ? validateRoomThemeManifestV1(themeSnapshot.data(), input.themeId) : undefined;
    const currentRevision = existing?.revision || 0;
    if (currentRevision !== input.expectedRevision) throw adminError(409, 'Theme changed after it was opened. Refresh and try again.');
    if (input.themeId !== 'majlis-default' && (!catalogSnapshot.exists || catalogSnapshot.data()?.category !== 'chat-themes')) {
      throw adminError(409, 'Create a matching Room Themes store item before publishing this manifest.');
    }

    let next;
    if (input.operation === 'emergency-disable') {
      if (!existing) throw adminError(404, 'Theme was not found.');
      next = {
        ...existing,
        publicationStatus: 'disabled',
        renderingEnabled: false,
        revision: currentRevision + 1,
      };
    } else if (input.operation === 'rollback') {
      const rollback = rollbackSnapshot?.exists
        ? validateRoomThemeManifestV1(rollbackSnapshot.data(), input.themeId)
        : undefined;
      if (!rollback) throw adminError(404, 'Rollback version was not found.');
      next = {
        ...rollback,
        publicationStatus: 'published',
        renderingEnabled: true,
        revision: currentRevision + 1,
      };
    } else {
      next = { ...input.manifest, revision: currentRevision + 1 };
    }
    const timestamp = fieldValue.serverTimestamp();
    const stored = {
      ...next,
      createdAt: themeSnapshot.exists ? themeSnapshot.data()?.createdAt || timestamp : timestamp,
      lastEditorEmail: decodedToken.email || '',
      lastEditorUid: decodedToken.uid,
      ...(next.publicationStatus === 'published' ? { publishedAt: timestamp } : {}),
      updatedAt: timestamp,
    };
    transaction.set(themeRef, stored);
    transaction.set(themeRef.collection('versions').doc(`v${next.revision}`), {
      ...next,
      createdAt: timestamp,
      editorUid: decodedToken.uid,
      operation: input.operation,
    });
    transaction.create(auditRef, {
      action: `room-theme-${input.operation}`,
      actorEmail: decodedToken.email || '',
      actorUid: decodedToken.uid,
      createdAt: timestamp,
      id: auditRef.id,
      itemId: input.themeId,
      kind: 'store-catalog',
      reason: input.reason,
      requestFingerprint: fingerprint,
      revision: next.revision,
      status: 'completed',
      themeId: input.themeId,
    });
    return { eventId: auditRef.id, replayed: false, revision: next.revision };
  });
}

function stableFingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(sort(value))).digest('hex');
}

function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sort(value[key])]));
}

function adminError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

module.exports = { getAdminRoomTheme, mutateAdminRoomTheme };
