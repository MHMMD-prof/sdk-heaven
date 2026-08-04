const {
  REPRESENTATIVE_BOOTSTRAP_TICKET_TTL_SECONDS,
  REPRESENTATIVE_FRESH_AUTH_TTL_SECONDS,
  REPRESENTATIVE_PORTAL_CONTRACT_VERSION,
  REPRESENTATIVE_PORTAL_SESSION_TTL_SECONDS,
  REPRESENTATIVE_RECIPIENT_LOOKUP_LIMIT,
  REPRESENTATIVE_RECIPIENT_LOOKUP_WINDOW_SECONDS,
  REPRESENTATIVE_RECIPIENT_PROOF_TTL_SECONDS,
  areRepresentativeTransfersEnabled,
  createRepresentativeOpaqueToken,
  hashRepresentativeOpaqueToken,
  normalizeRepresentativePortalOrigin,
} = require('./representativePortalCore');
const { hashRepresentativePin, normalizeRepresentativePinHash } = require('./representativePinCore');
const { mapRepresentativeHistoryReceipt, mapRepresentativePrivilege } = require('./representativeCore');
const { getRepresentativeStatus, resolveRepresentativeTransferPolicy, transferRepresentativeFunds } = require('./representativeService');
const { inspectPublicProfile } = require('./socialProfileCore');

const REPRESENTATIVE_HISTORY_CURSOR_TTL_MILLISECONDS = 5 * 60 * 1000;
const REPRESENTATIVE_HISTORY_SCAN_LIMIT = 100;

async function createRepresentativePortalTicket({ authTimeMillis = 0, clock, db, input, portalOrigin, randomBytes, uid }) {
  if (input !== undefined) return { errorCode: 'INVALID_REQUEST' };
  const normalizedOrigin = normalizeRepresentativePortalOrigin(portalOrigin);
  if (!normalizedOrigin.ok) return { errorCode: 'FEATURE_DISABLED' };

  const ticket = createRepresentativeOpaqueToken(randomBytes);
  const ticketId = hashRepresentativeOpaqueToken(ticket);
  const nowMillis = clock.nowMillis();
  const createdAt = clock.timestampFromMillis(nowMillis);
  const expiresAt = clock.timestampFromMillis(nowMillis + REPRESENTATIVE_BOOTSTRAP_TICKET_TTL_SECONDS * 1000);
  const freshAuthUntilMillis = Number.isFinite(authTimeMillis) && authTimeMillis > 0 && authTimeMillis <= nowMillis + 60_000
    ? authTimeMillis + REPRESENTATIVE_FRESH_AUTH_TTL_SECONDS * 1000
    : 0;

  const result = await db.runTransaction(async (transaction) => {
    const refs = {
      feature: db.doc('appConfig/socialFeatures'),
      policy: db.doc('appConfig/representativeTransferPolicy'),
      privilege: db.doc(`representativePrivileges/${uid}`),
      profile: db.doc(`publicProfiles/${uid}`),
      ticket: db.doc(`representativePortalBootstrapTickets/${ticketId}`),
    };
    const [feature, policy, privilege, profile, existingTicket] = await Promise.all([
      transaction.get(refs.feature), transaction.get(refs.policy), transaction.get(refs.privilege),
      transaction.get(refs.profile), transaction.get(refs.ticket),
    ]);
    if (existingTicket.exists) return { errorCode: 'REQUEST_CONFLICT' };
    if (!areRepresentativeTransfersEnabled(feature.data())) return { errorCode: 'FEATURE_DISABLED' };
    const permission = mapRepresentativePrivilege(privilege.data(), uid);
    if (!permission.active || (!permission.currencies.coins && !permission.currencies.diamonds)) return { errorCode: 'REPRESENTATIVE_REQUIRED' };
    if (!resolveRepresentativeTransferPolicy(policy.data(), privilege.data()).configured) return { errorCode: 'FEATURE_DISABLED' };
    const reservation = await readReservationInTransaction(db, transaction, profile.data());
    if (!inspectPublicProfile(profile.data(), reservation?.data(), uid).ok) return { errorCode: 'PROFILE_INCOMPLETE' };

    transaction.create(refs.ticket, {
      contractVersion: REPRESENTATIVE_PORTAL_CONTRACT_VERSION,
      createdAt,
      expiresAt,
      freshAuthUntil: freshAuthUntilMillis > nowMillis ? clock.timestampFromMillis(freshAuthUntilMillis) : null,
      origin: normalizedOrigin.value,
      representativeUid: uid,
      state: 'unused',
    });
    return { result: { expiresAt: new Date(expiresAt.toMillis()).toISOString(), portalOrigin: normalizedOrigin.value, ticket } };
  });

  return result;
}

async function exchangeRepresentativePortalTicket({ clock, db, portalOrigin, randomBytes, requestOrigin, ticket }) {
  const origin = resolveRequestOrigin(portalOrigin, requestOrigin);
  if (!origin.ok) return { errorCode: origin.code };
  const ticketId = hashRepresentativeOpaqueToken(ticket);
  if (!ticketId) return { errorCode: 'INVALID_REQUEST' };

  const sessionToken = createRepresentativeOpaqueToken(randomBytes);
  const sessionId = hashRepresentativeOpaqueToken(sessionToken);
  const nowMillis = clock.nowMillis();
  const now = clock.timestampFromMillis(nowMillis);
  const expiresAt = clock.timestampFromMillis(nowMillis + REPRESENTATIVE_PORTAL_SESSION_TTL_SECONDS * 1000);

  return db.runTransaction(async (transaction) => {
    const ticketRef = db.doc(`representativePortalBootstrapTickets/${ticketId}`);
    const ticketSnapshot = await transaction.get(ticketRef);
    const ticketData = ticketSnapshot.data();
    if (!ticketSnapshot.exists || ticketData?.state !== 'unused' || ticketData?.origin !== origin.value
      || timestampMillis(ticketData?.expiresAt) <= nowMillis || typeof ticketData?.representativeUid !== 'string') {
      return { errorCode: 'PORTAL_SESSION_INVALID' };
    }

    const uid = ticketData.representativeUid;
    const refs = {
      feature: db.doc('appConfig/socialFeatures'),
      policy: db.doc('appConfig/representativeTransferPolicy'),
      privilege: db.doc(`representativePrivileges/${uid}`),
      profile: db.doc(`publicProfiles/${uid}`),
      session: db.doc(`representativePortalSessions/${sessionId}`),
    };
    const [feature, policy, privilege, profile, existingSession] = await Promise.all([
      transaction.get(refs.feature), transaction.get(refs.policy), transaction.get(refs.privilege),
      transaction.get(refs.profile), transaction.get(refs.session),
    ]);
    if (existingSession.exists) return { errorCode: 'REQUEST_CONFLICT' };
    if (!areRepresentativeTransfersEnabled(feature.data())) return { errorCode: 'FEATURE_DISABLED' };
    const permission = mapRepresentativePrivilege(privilege.data(), uid);
    if (!permission.active || (!permission.currencies.coins && !permission.currencies.diamonds)) return { errorCode: 'REPRESENTATIVE_REQUIRED' };
    if (!resolveRepresentativeTransferPolicy(policy.data(), privilege.data()).configured) return { errorCode: 'FEATURE_DISABLED' };
    const reservation = await readReservationInTransaction(db, transaction, profile.data());
    if (!inspectPublicProfile(profile.data(), reservation?.data(), uid).ok) return { errorCode: 'PROFILE_INCOMPLETE' };

    transaction.set(ticketRef, { ...ticketData, consumedAt: now, consumedBySessionId: sessionId, state: 'consumed' });
    transaction.create(refs.session, {
      contractVersion: REPRESENTATIVE_PORTAL_CONTRACT_VERSION,
      createdAt: now,
      expiresAt,
      freshAuthUntil: ticketData.freshAuthUntil || null,
      origin: origin.value,
      representativeUid: uid,
      state: 'active',
    });
    return { result: { expiresAt: new Date(expiresAt.toMillis()).toISOString(), sessionToken } };
  });
}

async function setupRepresentativeTransferPin({ clock, db, hashPin = hashRepresentativePin, pin, portalOrigin, requestOrigin, sessionToken }) {
  const origin = resolveRequestOrigin(portalOrigin, requestOrigin);
  if (!origin.ok) return { errorCode: origin.code };
  const sessionId = hashRepresentativeOpaqueToken(sessionToken);
  if (!sessionId) return { errorCode: 'PORTAL_SESSION_INVALID' };
  const preliminarySession = await db.doc(`representativePortalSessions/${sessionId}`).get();
  const preliminaryData = preliminarySession.data();
  const preliminaryNowMillis = clock.nowMillis();
  if (!isActivePortalSession(preliminarySession, preliminaryData, origin.value, preliminaryNowMillis)) return { errorCode: 'PORTAL_SESSION_INVALID' };
  if (timestampMillis(preliminaryData.freshAuthUntil) <= preliminaryNowMillis) return { errorCode: 'FRESH_AUTH_REQUIRED' };
  const pinHash = await hashPin(pin);
  const nowMillis = clock.nowMillis();
  const now = clock.timestampFromMillis(nowMillis);

  return db.runTransaction(async (transaction) => {
    const sessionRef = db.doc(`representativePortalSessions/${sessionId}`);
    const session = await transaction.get(sessionRef);
    const sessionData = session.data();
    if (!isActivePortalSession(session, sessionData, origin.value, nowMillis)) return { errorCode: 'PORTAL_SESSION_INVALID' };
    if (timestampMillis(sessionData.freshAuthUntil) <= nowMillis) return { errorCode: 'FRESH_AUTH_REQUIRED' };
    const uid = sessionData.representativeUid;
    const refs = {
      feature: db.doc('appConfig/socialFeatures'),
      pin: db.doc(`representativeTransferPins/${uid}`),
      policy: db.doc('appConfig/representativeTransferPolicy'),
      privilege: db.doc(`representativePrivileges/${uid}`),
      profile: db.doc(`publicProfiles/${uid}`),
    };
    const [feature, pinSnapshot, policy, privilege, profile] = await Promise.all([
      transaction.get(refs.feature), transaction.get(refs.pin), transaction.get(refs.policy), transaction.get(refs.privilege), transaction.get(refs.profile),
    ]);
    if (!areRepresentativeTransfersEnabled(feature.data())) return { errorCode: 'FEATURE_DISABLED' };
    const permission = mapRepresentativePrivilege(privilege.data(), uid);
    if (!permission.active || (!permission.currencies.coins && !permission.currencies.diamonds)) return { errorCode: 'REPRESENTATIVE_REQUIRED' };
    if (!resolveRepresentativeTransferPolicy(policy.data(), privilege.data()).configured) return { errorCode: 'FEATURE_DISABLED' };
    const reservation = await readReservationInTransaction(db, transaction, profile.data());
    if (!inspectPublicProfile(profile.data(), reservation?.data(), uid).ok) return { errorCode: 'PROFILE_INCOMPLETE' };
    if (pinSnapshot.exists && pinSnapshot.data()?.resetRequired !== true) {
      return { errorCode: normalizeRepresentativePinHash(pinSnapshot.data()) ? 'PIN_ALREADY_CONFIGURED' : 'PIN_RESET_REQUIRED' };
    }

    transaction.set(refs.pin, {
      ...pinHash,
      createdAt: pinSnapshot.exists && pinSnapshot.data()?.createdAt ? pinSnapshot.data().createdAt : now,
      failedAttempts: 0,
      lockedUntil: null,
      resetRequired: false,
      representativeUid: uid,
      updatedAt: now,
    });
    return { result: { pin: { state: 'ready' } } };
  });
}

async function getRepresentativePortalStatus({ clock, db, portalOrigin, requestOrigin, sessionToken }) {
  const session = await readRepresentativePortalSession({ clock, db, portalOrigin, requestOrigin, sessionToken });
  if (session.errorCode) return session;
  const status = await getRepresentativeStatus({ clock, db, portalOrigin: session.origin, uid: session.uid });
  if (status.errorCode) return status;
  if (!status.result.feature.available) return { errorCode: 'FEATURE_DISABLED' };
  if (!status.result.privilege.active) return { errorCode: 'REPRESENTATIVE_REQUIRED' };
  return { result: mapRepresentativePortalStatus(status.result) };
}

async function transferRepresentativePortalFunds({
  clock, createPublicReference, db, fieldValue, input, portalOrigin, requestOrigin, sessionToken, verifyPin,
}) {
  const origin = resolveRequestOrigin(portalOrigin, requestOrigin);
  if (!origin.ok) return { errorCode: origin.code };
  const portalSessionId = hashRepresentativeOpaqueToken(sessionToken);
  if (!portalSessionId) return { errorCode: 'PORTAL_SESSION_INVALID' };
  const session = await readRepresentativePortalSession({ clock, db, portalOrigin, requestOrigin, sessionToken });
  if (session.errorCode) return session;
  const transfer = await transferRepresentativeFunds({
    clock, createPublicReference, db, fieldValue,
    input: { amount: input.amount, currency: input.currency, pin: input.pin, proof: input.proof },
    portalOrigin: origin.value, portalSessionId, requestId: input.requestId, uid: session.uid, verifyPin,
  });
  return transfer.result ? { result: { ...transfer.result, representativeUid: session.uid } } : transfer;
}

async function lookupRepresentativeReceipt({
  clock, db, portalOrigin, publicReference, requestOrigin, sessionToken,
}) {
  const session = await readRepresentativePortalSession({ clock, db, portalOrigin, requestOrigin, sessionToken });
  if (session.errorCode) return session;
  const reference = await db.doc(`representativePublicReferences/${publicReference}`).get();
  const referenceData = reference.data();
  if (!reference.exists || referenceData?.representativeUid !== session.uid || typeof referenceData?.transferId !== 'string') {
    return { errorCode: 'RECEIPT_NOT_FOUND' };
  }
  const [transfer, reversal] = await Promise.all([
    db.doc(`representativeTransfers/${referenceData.transferId}`).get(),
    db.doc(`representativeTransferReversals/${referenceData.transferId}`).get(),
  ]);
  const transferData = transfer.data();
  const reversalData = reversal.data();
  const reversed = reversal.exists
    && reversalData?.status === 'completed'
    && reversalData?.publicReference === publicReference
    && reversalData?.transferId === referenceData.transferId;
  const receipt = mapRepresentativeHistoryReceipt({
    ...transferData,
    publicReference,
    status: reversed ? 'reversed' : 'completed',
  });
  if (!transfer.exists || !receipt || transferData?.representativeUid !== session.uid) {
    return { errorCode: 'RECEIPT_NOT_FOUND' };
  }
  return {
    result: {
      ...receipt,
      ...(reversed && timestampMillis(reversalData?.createdAt) > 0
        ? { reversedAt: new Date(timestampMillis(reversalData.createdAt)).toISOString() }
        : {}),
    },
  };
}

async function getRepresentativeHistory({
  clock, db, input, portalOrigin, randomBytes, requestOrigin, sessionToken,
}) {
  const session = await readRepresentativePortalSession({ clock, db, portalOrigin, requestOrigin, sessionToken });
  if (session.errorCode) return session;
  const filtersKey = JSON.stringify({
    currency: input.currency,
    from: input.from,
    status: input.status,
    to: input.to,
  });
  let query = db.collection(`representativeTransferReceipts/${session.uid}/items`)
    .orderBy('createdAt', 'desc')
    .limit(REPRESENTATIVE_HISTORY_SCAN_LIMIT);

  if (input.cursor) {
    const cursorId = hashRepresentativeOpaqueToken(input.cursor);
    const cursor = cursorId ? await db.doc(`representativePortalHistoryCursors/${cursorId}`).get() : undefined;
    const cursorData = cursor?.data();
    if (!cursor?.exists
      || cursorData?.representativeUid !== session.uid
      || cursorData?.sessionId !== session.sessionId
      || cursorData?.filtersKey !== filtersKey
      || timestampMillis(cursorData?.expiresAt) <= clock.nowMillis()
      || typeof cursorData?.lastReceiptPath !== 'string') {
      return { errorCode: 'CURSOR_INVALID' };
    }
    const lastReceipt = await db.doc(cursorData.lastReceiptPath).get();
    if (!lastReceipt.exists) return { errorCode: 'CURSOR_INVALID' };
    query = query.startAfter(lastReceipt);
  }

  const snapshot = await query.get();
  const items = [];
  let lastScanned;
  for (const document of snapshot.docs) {
    lastScanned = document;
    const mapped = mapRepresentativeHistoryReceipt(document.data());
    if (!mapped || !matchesHistoryFilters(mapped, input)) continue;
    items.push(mapped);
    if (items.length >= input.limit) break;
  }

  const mayHaveMore = Boolean(lastScanned)
    && (items.length >= input.limit || snapshot.docs.length >= REPRESENTATIVE_HISTORY_SCAN_LIMIT);
  let nextCursor = '';
  if (mayHaveMore) {
    nextCursor = createRepresentativeOpaqueToken(randomBytes);
    const cursorId = hashRepresentativeOpaqueToken(nextCursor);
    const nowMillis = clock.nowMillis();
    await db.runTransaction(async (transaction) => {
      transaction.create(db.doc(`representativePortalHistoryCursors/${cursorId}`), {
        createdAt: clock.timestampFromMillis(nowMillis),
        expiresAt: clock.timestampFromMillis(nowMillis + REPRESENTATIVE_HISTORY_CURSOR_TTL_MILLISECONDS),
        filtersKey,
        lastReceiptPath: lastScanned.ref.path,
        representativeUid: session.uid,
        sessionId: session.sessionId,
      });
    });
  }
  return { result: { items, nextCursor } };
}

function matchesHistoryFilters(receipt, input) {
  const createdAtMillis = Date.parse(receipt.createdAt);
  return (!input.currency || receipt.currency === input.currency)
    && (!input.status || receipt.status === input.status)
    && (!input.from || createdAtMillis >= Date.parse(input.from))
    && (!input.to || createdAtMillis <= Date.parse(input.to));
}

function mapRepresentativePortalTransferResult(result) {
  return {
    amount: result.amount,
    balances: result.balances,
    currency: result.currency,
    publicReference: result.publicReference,
    recipient: result.recipient,
  };
}

async function previewRepresentativeRecipient({ clock, db, portalOrigin, randomBytes, recipientPublicId, requestOrigin, sessionToken }) {
  const origin = resolveRequestOrigin(portalOrigin, requestOrigin);
  if (!origin.ok) return { errorCode: origin.code };
  const sessionId = hashRepresentativeOpaqueToken(sessionToken);
  if (!sessionId) return { errorCode: 'PORTAL_SESSION_INVALID' };

  const proof = createRepresentativeOpaqueToken(randomBytes);
  const proofId = hashRepresentativeOpaqueToken(proof);
  const nowMillis = clock.nowMillis();
  const now = clock.timestampFromMillis(nowMillis);
  const proofExpiresAt = clock.timestampFromMillis(nowMillis + REPRESENTATIVE_RECIPIENT_PROOF_TTL_SECONDS * 1000);

  return db.runTransaction(async (transaction) => {
    const sessionRef = db.doc(`representativePortalSessions/${sessionId}`);
    const sessionSnapshot = await transaction.get(sessionRef);
    const sessionData = sessionSnapshot.data();
    if (!isActivePortalSession(sessionSnapshot, sessionData, origin.value, nowMillis)) return { errorCode: 'PORTAL_SESSION_INVALID' };

    const uid = sessionData.representativeUid;
    const refs = {
      feature: db.doc('appConfig/socialFeatures'),
      identity: db.doc(`publicIds/${recipientPublicId}`),
      policy: db.doc('appConfig/representativeTransferPolicy'),
      privilege: db.doc(`representativePrivileges/${uid}`),
      profile: db.doc(`publicProfiles/${uid}`),
      proof: db.doc(`representativeRecipientProofs/${proofId}`),
      rate: db.doc(`representativePortalRateLimits/${uid}`),
      securityEvent: db.doc(`representativePortalSecurityEvents/${proofId}`),
    };
    const [feature, identity, policy, privilege, profile, existingProof, rate] = await Promise.all([
      transaction.get(refs.feature), transaction.get(refs.identity), transaction.get(refs.policy),
      transaction.get(refs.privilege), transaction.get(refs.profile), transaction.get(refs.proof), transaction.get(refs.rate),
    ]);
    if (!areRepresentativeTransfersEnabled(feature.data())) return { errorCode: 'FEATURE_DISABLED' };
    const permission = mapRepresentativePrivilege(privilege.data(), uid);
    if (!permission.active || (!permission.currencies.coins && !permission.currencies.diamonds)) return { errorCode: 'REPRESENTATIVE_REQUIRED' };
    if (!resolveRepresentativeTransferPolicy(policy.data(), privilege.data()).configured) return { errorCode: 'FEATURE_DISABLED' };
    const reservation = await readReservationInTransaction(db, transaction, profile.data());
    if (!inspectPublicProfile(profile.data(), reservation?.data(), uid).ok) return { errorCode: 'PROFILE_INCOMPLETE' };

    const rateState = nextLookupRateState(rate.data(), nowMillis);
    transaction.set(refs.rate, { count: rateState.count, representativeUid: uid, windowStartedAt: clock.timestampFromMillis(rateState.windowStartedAt) });
    if (!rateState.allowed) {
      transaction.create(refs.securityEvent, {
        count: rateState.count,
        createdAt: now,
        kind: 'recipient-lookup-rate-limited',
        representativeUid: uid,
        windowStartedAt: clock.timestampFromMillis(rateState.windowStartedAt),
      });
      return { errorCode: 'RATE_LIMITED' };
    }
    const recipientUid = identity.exists && typeof identity.data()?.uid === 'string' ? identity.data().uid : '';
    const recipientProfileRef = recipientUid ? db.doc(`publicProfiles/${recipientUid}`) : undefined;
    const recipientProfile = recipientProfileRef ? await transaction.get(recipientProfileRef) : undefined;
    const validRecipient = recipientUid && recipientUid !== uid && recipientProfile?.data()?.publicId === recipientPublicId
      && inspectPublicProfile(recipientProfile.data(), identity.data(), recipientUid).ok;

    if (!validRecipient) {
      transaction.create(refs.securityEvent, {
        count: rateState.count,
        createdAt: now,
        kind: 'invalid-recipient-lookup',
        representativeUid: uid,
        windowStartedAt: clock.timestampFromMillis(rateState.windowStartedAt),
      });
      return { errorCode: 'INVALID_RECIPIENT' };
    }
    if (existingProof.exists) return { errorCode: 'REQUEST_CONFLICT' };

    transaction.create(refs.proof, {
      contractVersion: REPRESENTATIVE_PORTAL_CONTRACT_VERSION,
      createdAt: now,
      expiresAt: proofExpiresAt,
      recipientPublicId,
      recipientUid,
      representativeUid: uid,
      state: 'unused',
    });
    const recipientData = recipientProfile.data();
    return {
      result: {
        expiresAt: new Date(proofExpiresAt.toMillis()).toISOString(),
        proof,
        recipient: {
          avatarUrl: recipientData.avatarModerationStatus === 'clear' ? recipientData.avatarUrl : '',
          displayName: recipientData.displayName,
          publicId: recipientPublicId,
        },
      },
    };
  });
}

async function readRepresentativePortalSession({ clock, db, portalOrigin, requestOrigin, sessionToken }) {
  const origin = resolveRequestOrigin(portalOrigin, requestOrigin);
  if (!origin.ok) return { errorCode: origin.code };
  const sessionId = hashRepresentativeOpaqueToken(sessionToken);
  if (!sessionId) return { errorCode: 'PORTAL_SESSION_INVALID' };
  const session = await db.doc(`representativePortalSessions/${sessionId}`).get();
  const data = session.data();
  if (!isActivePortalSession(session, data, origin.value, clock.nowMillis())) return { errorCode: 'PORTAL_SESSION_INVALID' };
  return { origin: origin.value, sessionId, uid: data.representativeUid };
}

function resolveRequestOrigin(portalOrigin, requestOrigin) {
  const configured = normalizeRepresentativePortalOrigin(portalOrigin);
  const requested = normalizeRepresentativePortalOrigin(requestOrigin);
  if (!configured.ok || !requested.ok || configured.value !== requested.value) return { ok: false, code: 'PORTAL_ORIGIN_DENIED' };
  return { ok: true, value: configured.value };
}

function isActivePortalSession(snapshot, data, origin, nowMillis) {
  return snapshot.exists && data?.state === 'active' && data?.origin === origin
    && typeof data?.representativeUid === 'string' && data.representativeUid
    && timestampMillis(data?.expiresAt) > nowMillis;
}

function nextLookupRateState(data, nowMillis) {
  const previousStart = timestampMillis(data?.windowStartedAt);
  const inWindow = previousStart > 0 && nowMillis - previousStart < REPRESENTATIVE_RECIPIENT_LOOKUP_WINDOW_SECONDS * 1000;
  const count = inWindow && Number.isSafeInteger(data?.count) && data.count >= 0 ? data.count + 1 : 1;
  return { allowed: count <= REPRESENTATIVE_RECIPIENT_LOOKUP_LIMIT, count, windowStartedAt: inWindow ? previousStart : nowMillis };
}

function mapRepresentativePortalStatus(status) {
  return {
    dailyAllowance: status.dailyAllowance,
    feature: status.feature,
    limits: status.limits,
    pin: status.pin,
    privilege: { active: status.privilege.active, currencies: status.privilege.currencies },
    recentTransfers: status.recentTransfers.map((receipt) => ({
      amount: receipt.amount,
      balanceAfter: receipt.balanceAfter,
      balanceBefore: receipt.balanceBefore,
      createdAt: receipt.createdAt,
      currency: receipt.currency,
      kind: receipt.status === 'reversed' ? 'reversal' : 'transfer',
      publicReference: receipt.publicReference,
      recipientDisplayName: receipt.recipientDisplayName,
      recipientPublicId: receipt.recipientPublicId,
      status: receipt.status,
    })),
    wallet: {
      balances: status.wallet.balances,
      updatedAt: status.wallet.updatedAt,
    },
  };
}

async function readReservationInTransaction(db, transaction, profile) {
  return profile?.publicId ? transaction.get(db.doc(`publicIds/${profile.publicId}`)) : undefined;
}

function timestampMillis(value) { return value && typeof value.toMillis === 'function' ? value.toMillis() : 0; }

module.exports = {
  createRepresentativePortalTicket,
  exchangeRepresentativePortalTicket,
  getRepresentativePortalStatus,
  getRepresentativeHistory,
  lookupRepresentativeReceipt,
  mapRepresentativePortalStatus,
  mapRepresentativePortalTransferResult,
  nextLookupRateState,
  previewRepresentativeRecipient,
  readRepresentativePortalSession,
  resolveRequestOrigin,
  setupRepresentativeTransferPin,
  transferRepresentativePortalFunds,
};
