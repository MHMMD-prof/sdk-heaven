const { inspectPublicProfile, isTimestampLike } = require('./socialProfileCore');
const {
  applyWalletMutation,
  buildWalletDocument,
  buildWalletTransaction,
  mapWalletSummary,
} = require('./socialWalletCore');
const { mapStoreCatalogItem } = require('./storeCore');
const { durationToMilliseconds } = require('./storePurchaseCore');
const {
  DEFAULT_ROOM_THEME_ID,
  buildRoomThemeFingerprint,
  isClientVersionCompatible,
  mapRoomThemeEntitlement,
  normalizeRoomThemeBody,
  roomThemeError,
  validateRoomThemeManifest,
  validateRoomThemeRequest,
} = require('./roomThemeCore');

async function executeRoomThemeCommand({
  body,
  clock,
  db,
  decodedToken,
  fieldValue,
}) {
  const validation = validateRoomThemeRequest(normalizeRoomThemeBody(body));
  if (!validation.ok) return validation;
  const command = validation.value;
  if (command.action === 'get-room-theme-inventory') {
    return getRoomThemeInventory({ command, db, decodedToken });
  }
  return command.action === 'purchase-room-theme'
    ? purchaseRoomTheme({ clock, command, db, decodedToken, fieldValue })
    : equipRoomTheme({ command, db, decodedToken, fieldValue });
}

async function getRoomThemeInventory({ command, db, decodedToken }) {
  const [room, features, profile, themes, entitlements, catalogs] = await Promise.all([
    db.doc(`rooms/${command.roomId}`).get(),
    db.doc('appConfig/voiceRoomFeatures').get(),
    db.doc(`publicProfiles/${decodedToken.uid}`).get(),
    db.collection('roomThemes').where('publicationStatus', '==', 'published').limit(100).get(),
    db.collection(`rooms/${command.roomId}/themeEntitlements`).limit(100).get(),
    db.collection('storeCatalog').where('category', '==', 'chat-themes').limit(100).get(),
  ]);
  const access = validateOwnerAccess({
    features: features.data(),
    profile: profile.exists ? profile.data() : undefined,
    room: room.exists ? room.data() : undefined,
    uid: decodedToken.uid,
  });
  if (!access.ok) return access;
  const entitlementByTheme = new Map(entitlements.docs.map((document) => [
    document.id,
    mapRoomThemeEntitlement(document.data(), document.id),
  ]));
  const catalogByTheme = new Map(catalogs.docs.map((document) => [
    document.id,
    mapStoreCatalogItem(document.data(), document.id),
  ]));
  const inventory = themes.docs
    .map((document) => validateRoomThemeManifest(document.data(), document.id))
    .filter(Boolean)
    .filter((manifest) => manifest.renderingEnabled)
    .map((manifest) => {
      const entitlement = entitlementByTheme.get(manifest.themeId);
      const free = manifest.themeId === DEFAULT_ROOM_THEME_ID;
      const state = free ? 'free' : entitlement?.state === 'active' ? 'owned' : entitlement?.state === 'expired' ? 'expired' : 'locked';
      return { catalog: catalogByTheme.get(manifest.themeId) || null, entitlement: entitlement || null, manifest, state };
    })
    .sort((left, right) => Number(left.state !== 'free') - Number(right.state !== 'free') || left.manifest.themeId.localeCompare(right.manifest.themeId));
  if (!inventory.some((entry) => entry.manifest.themeId === DEFAULT_ROOM_THEME_ID)) {
    inventory.unshift({
      entitlement: null,
      catalog: null,
      manifest: null,
      state: 'free',
      themeId: DEFAULT_ROOM_THEME_ID,
    });
  }
  return {
    ok: true,
    result: {
      equippedThemeId: typeof room.data()?.themeId === 'string' ? room.data().themeId : DEFAULT_ROOM_THEME_ID,
      inventory,
      roomId: command.roomId,
    },
  };
}

async function purchaseRoomTheme({ clock, command, db, decodedToken, fieldValue }) {
  if (command.themeId === DEFAULT_ROOM_THEME_ID) {
    return roomThemeError('THEME_FREE', 409, 'The default room theme is already free.');
  }
  const fingerprint = buildRoomThemeFingerprint(decodedToken.uid, command);
  return db.runTransaction(async (transaction) => {
    const refs = {
      catalog: db.doc(`storeCatalog/${command.themeId}`),
      command: db.doc(`roomThemeCommandRequests/${decodedToken.uid}/requests/${command.requestId}`),
      entitlement: db.doc(`rooms/${command.roomId}/themeEntitlements/${command.themeId}`),
      features: db.doc('appConfig/voiceRoomFeatures'),
      profile: db.doc(`publicProfiles/${decodedToken.uid}`),
      room: db.doc(`rooms/${command.roomId}`),
      storeTransaction: db.doc(`storeTransactions/${decodedToken.uid}_${command.requestId}`),
      theme: db.doc(`roomThemes/${command.themeId}`),
      wallet: db.doc(`walletSummaries/${decodedToken.uid}`),
      walletTransaction: db.doc(`walletTransactions/${decodedToken.uid}_${command.requestId}`),
    };
    const [room, features, profile, theme, catalog, entitlement, wallet, previous] = await Promise.all([
      transaction.get(refs.room),
      transaction.get(refs.features),
      transaction.get(refs.profile),
      transaction.get(refs.theme),
      transaction.get(refs.catalog),
      transaction.get(refs.entitlement),
      transaction.get(refs.wallet),
      transaction.get(refs.command),
    ]);
    if (previous.exists) {
      const data = previous.data();
      return data.fingerprint === fingerprint && data.result
        ? { ok: true, replayed: true, result: data.result }
        : roomThemeError('REQUEST_ID_CONFLICT', 409, 'This request ID was already used.');
    }
    const access = validateOwnerAccess({
      features: features.data(),
      profile: profile.exists ? profile.data() : undefined,
      room: room.exists ? room.data() : undefined,
      uid: decodedToken.uid,
      purchases: true,
    });
    if (!access.ok) return access;
    const manifest = theme.exists ? validateRoomThemeManifest(theme.data(), theme.id) : undefined;
    const item = catalog.exists ? mapStoreCatalogItem(catalog.data(), catalog.id) : undefined;
    if (
      !manifest
      || manifest.publicationStatus !== 'published'
      || !manifest.renderingEnabled
      || !manifest.purchasingEnabled
      || !isClientVersionCompatible(manifest.minimumClientVersion, command.clientVersion)
      || !item
      || item.itemId !== manifest.themeId
      || item.category !== 'chat-themes'
      || item.availability !== 'available'
      || !item.purchasingEnabled
    ) return roomThemeError('THEME_UNAVAILABLE', 409, 'This room theme is unavailable or incompatible.');
    const existing = entitlement.exists
      ? mapRoomThemeEntitlement(entitlement.data(), entitlement.id, clock.nowMillis())
      : undefined;
    if (existing?.state === 'active') return roomThemeError('DUPLICATE_ENTITLEMENT', 409, 'This room already owns the theme.');
    if (item.stock.kind === 'limited' && item.stock.remaining < 1) {
      return roomThemeError('OUT_OF_STOCK', 409, 'This room theme is out of stock.');
    }
    const price = item.prices[command.currency];
    if (!Number.isSafeInteger(price)) return roomThemeError('THEME_UNAVAILABLE', 409, 'The selected currency is unavailable.');
    const walletBefore = mapWalletSummary(wallet.exists ? wallet.data() : undefined, decodedToken.uid);
    const debit = applyWalletMutation(walletBefore, { amount: price, currency: command.currency, type: 'debit' });
    if (!debit.ok) return roomThemeError(debit.code, 409, debit.code === 'INSUFFICIENT_FUNDS' ? 'Insufficient funds.' : 'Wallet update failed.');

    const timestamp = fieldValue.serverTimestamp();
    const durationMs = durationToMilliseconds(item.duration);
    const expiresAt = durationMs ? clock.timestampFromMillis(clock.nowMillis() + durationMs) : null;
    const result = {
      balances: debit.value.wallet.balances,
      equipped: command.applyTheme,
      expiresAt,
      roomId: command.roomId,
      themeId: command.themeId,
    };
    transaction.set(refs.wallet, buildWalletDocument(debit.value.wallet, {
      createdAt: wallet.exists && isTimestampLike(wallet.data().createdAt) ? wallet.data().createdAt : timestamp,
      updatedAt: timestamp,
    }));
    transaction.create(refs.walletTransaction, buildWalletTransaction({
      actorUid: decodedToken.uid,
      amount: price,
      balanceAfter: debit.value.balanceAfter,
      createdAt: timestamp,
      currency: command.currency,
      referenceId: `${command.roomId}:${command.themeId}`,
      source: 'room-theme',
      type: 'purchase',
      uid: decodedToken.uid,
    }));
    transaction.create(refs.storeTransaction, {
      amount: price,
      category: 'chat-themes',
      createdAt: timestamp,
      currency: command.currency,
      itemId: command.themeId,
      kind: 'room-theme-purchase',
      requestId: command.requestId,
      roomId: command.roomId,
      uid: decodedToken.uid,
    });
    transaction.set(refs.entitlement, {
      acquiredAt: timestamp,
      acquiredByUid: decodedToken.uid,
      expiresAt,
      itemId: command.themeId,
      roomId: command.roomId,
      state: 'active',
      themeId: command.themeId,
      updatedAt: timestamp,
    });
    if (command.applyTheme) {
      transaction.update(refs.room, {
        revision: Number(room.data().revision || 0) + 1,
        themeId: command.themeId,
        themeUpdatedAt: timestamp,
        updatedAt: timestamp,
      });
    }
    if (item.stock.kind === 'limited') {
      transaction.update(refs.catalog, {
        stock: { kind: 'limited', remaining: item.stock.remaining - 1 },
        updatedAt: timestamp,
      });
    }
    transaction.create(refs.command, {
      action: command.action,
      createdAt: timestamp,
      fingerprint,
      requestId: command.requestId,
      result,
      roomId: command.roomId,
      themeId: command.themeId,
      uid: decodedToken.uid,
    });
    return { ok: true, result };
  });
}

async function equipRoomTheme({ command, db, decodedToken, fieldValue }) {
  const fingerprint = buildRoomThemeFingerprint(decodedToken.uid, command);
  return db.runTransaction(async (transaction) => {
    const refs = {
      command: db.doc(`roomThemeCommandRequests/${decodedToken.uid}/requests/${command.requestId}`),
      entitlement: db.doc(`rooms/${command.roomId}/themeEntitlements/${command.themeId}`),
      features: db.doc('appConfig/voiceRoomFeatures'),
      profile: db.doc(`publicProfiles/${decodedToken.uid}`),
      room: db.doc(`rooms/${command.roomId}`),
      theme: db.doc(`roomThemes/${command.themeId}`),
    };
    const [room, features, profile, theme, entitlement, previous] = await Promise.all([
      transaction.get(refs.room),
      transaction.get(refs.features),
      transaction.get(refs.profile),
      transaction.get(refs.theme),
      transaction.get(refs.entitlement),
      transaction.get(refs.command),
    ]);
    if (previous.exists) {
      const data = previous.data();
      return data.fingerprint === fingerprint && data.result
        ? { ok: true, replayed: true, result: data.result }
        : roomThemeError('REQUEST_ID_CONFLICT', 409, 'This request ID was already used.');
    }
    const access = validateOwnerAccess({
      features: features.data(),
      profile: profile.exists ? profile.data() : undefined,
      room: room.exists ? room.data() : undefined,
      uid: decodedToken.uid,
    });
    if (!access.ok) return access;
    let manifest;
    if (command.themeId !== DEFAULT_ROOM_THEME_ID) {
      manifest = theme.exists ? validateRoomThemeManifest(theme.data(), theme.id) : undefined;
      const owned = entitlement.exists
        ? mapRoomThemeEntitlement(entitlement.data(), entitlement.id)
        : undefined;
      if (!owned || owned.state !== 'active') return roomThemeError('ENTITLEMENT_REQUIRED', 403, 'This room does not own the selected theme.');
    }
    if (
      command.themeId !== DEFAULT_ROOM_THEME_ID
      && (
        !manifest
        || manifest.publicationStatus !== 'published'
        || !manifest.renderingEnabled
        || !isClientVersionCompatible(manifest.minimumClientVersion, command.clientVersion)
      )
    ) return roomThemeError('THEME_UNAVAILABLE', 409, 'This room theme is unavailable or incompatible.');
    const timestamp = fieldValue.serverTimestamp();
    const result = { equipped: true, roomId: command.roomId, themeId: command.themeId };
    transaction.update(refs.room, {
      revision: Number(room.data().revision || 0) + 1,
      themeId: command.themeId,
      themeUpdatedAt: timestamp,
      updatedAt: timestamp,
    });
    transaction.create(refs.command, {
      action: command.action,
      createdAt: timestamp,
      fingerprint,
      requestId: command.requestId,
      result,
      roomId: command.roomId,
      themeId: command.themeId,
      uid: decodedToken.uid,
    });
    return { ok: true, result };
  });
}

async function expireRoomThemeEntitlements({
  clock,
  db,
  fieldValue,
  limit = 200,
}) {
  const now = clock.timestampFromMillis(clock.nowMillis());
  const snapshot = await db.collectionGroup('themeEntitlements')
    .where('state', '==', 'active')
    .where('expiresAt', '<=', now)
    .limit(limit)
    .get();
  let expired = 0;
  for (const candidate of snapshot.docs) {
    const changed = await db.runTransaction(async (transaction) => {
      const entitlement = await transaction.get(candidate.ref);
      const data = entitlement.exists ? entitlement.data() : undefined;
      if (!data || data.state !== 'active' || !data.expiresAt || data.expiresAt.toMillis() > clock.nowMillis()) return false;
      const roomRef = candidate.ref.parent.parent;
      const room = roomRef ? await transaction.get(roomRef) : undefined;
      const timestamp = fieldValue.serverTimestamp();
      transaction.update(candidate.ref, { state: 'expired', updatedAt: timestamp });
      if (room?.exists && room.data()?.themeId === data.themeId) {
        transaction.update(room.ref, {
          revision: Number(room.data().revision || 0) + 1,
          themeId: DEFAULT_ROOM_THEME_ID,
          themeUpdatedAt: timestamp,
          updatedAt: timestamp,
        });
      }
      return true;
    });
    if (changed) expired += 1;
  }
  return { expired, scanned: snapshot.docs.length };
}

function validateOwnerAccess({ features, profile, purchases = false, room, uid }) {
  if (!room || room.status !== 'active') return roomThemeError('ROOM_NOT_ACTIVE', 409, 'The room is not active.');
  if ((room.ownerUid || room.hostId) !== uid) return roomThemeError('OWNER_REQUIRED', 403, 'Only the room owner can manage room themes.');
  if (!profile || profile.uid !== uid || profile.moderationStatus !== 'active') {
    return roomThemeError('ACCOUNT_RESTRICTED', 403, 'The account is not eligible to manage room themes.');
  }
  if (features?.voice_room_themes !== true) return roomThemeError('FEATURE_DISABLED', 503, 'Room themes are disabled.');
  if (purchases && features?.voice_room_theme_purchases !== true) {
    return roomThemeError('PURCHASES_DISABLED', 503, 'Room-theme purchases are disabled.');
  }
  return { ok: true };
}

module.exports = {
  executeRoomThemeCommand,
  expireRoomThemeEntitlements,
  getRoomThemeInventory,
};
