const { createHash } = require('node:crypto');
const {
  buildLegacyEntryPresentation,
  inspectApprovedEntryPresentation,
  resolveEntryPresentationDelivery,
} = require('./roomEntryPresentationCore');
const {
  buildCoupleEntryCopySnapshot,
  buildEntryEffectCopySnapshot,
  resolveRoomEffectSurface,
} = require('./roomEffectPresentationCore');

const ROOM_ENTRY_EFFECT_ACTIONS = Object.freeze(['announce-entry-effect']);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/;
const FIRESTORE_ID_PATTERN = /^[^/]{1,128}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/;
const CLIENT_VERSION_PATTERN = /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}(?:[-+][A-Za-z0-9.-]{1,24})?$/;
const DEFAULT_DURATION_MS = 4_000;
const MIN_DURATION_MS = 3_000;
const MAX_DURATION_MS = 5_000;
const EFFECT_TTL_MS = 10_000;
const EFFECT_RETENTION_MS = 24 * 60 * 60 * 1000;
const COUPLE_ENTRY_WINDOW_MS = 8_000;
const MAX_QUEUE_HINT = 8;
const MAX_EFFECT_DIMENSION = 2_048;
const PERFORMANCE_TIERS = Object.freeze(['low', 'standard', 'high']);
const SOUND_POLICIES = Object.freeze(['off', 'soft', 'full']);

function normalizeRoomEntryEffectBody(body = {}) {
  return {
    action: typeof body.action === 'string' ? body.action.trim() : '',
    requestId: typeof body.requestId === 'string' ? body.requestId.trim() : '',
    roomId: typeof body.roomId === 'string' ? body.roomId.trim() : '',
    sessionId: typeof body.sessionId === 'string' ? body.sessionId.trim() : '',
    clientVersion: typeof body.clientVersion === 'string' ? body.clientVersion.trim() : '',
  };
}

function validateRoomEntryEffectRequest(command) {
  if (
    !ROOM_ENTRY_EFFECT_ACTIONS.includes(command.action)
    || !FIRESTORE_ID_PATTERN.test(command.roomId)
    || !REQUEST_ID_PATTERN.test(command.requestId)
    || !SESSION_ID_PATTERN.test(command.sessionId)
    || (command.clientVersion && !CLIENT_VERSION_PATTERN.test(command.clientVersion))
  ) {
    return entryEffectError('INVALID_REQUEST', 400, 'A valid entry-effect command is required.');
  }
  return { ok: true, value: command };
}

function mapCarEntryEffectMetadata(catalogData, catalogItem) {
  if (!catalogItem || catalogItem.category !== 'cars') return undefined;
  const raw = catalogData && typeof catalogData === 'object' ? catalogData : {};
  const thumbnailUrl = isApprovedEntryAssetUrl(catalogItem.thumbnailUrl)
    ? catalogItem.thumbnailUrl
    : '';
  const previewAssetUrl = isApprovedEntryAssetUrl(catalogItem.previewAssetUrl)
    ? catalogItem.previewAssetUrl
    : '';
  if (!thumbnailUrl || !previewAssetUrl) return undefined;
  const durationMs = Number.isInteger(raw.entryEffectDurationMs)
    ? Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, raw.entryEffectDurationMs))
    : DEFAULT_DURATION_MS;
  const performanceTier = PERFORMANCE_TIERS.includes(raw.entryEffectPerformanceTier)
    ? raw.entryEffectPerformanceTier
    : 'standard';
  const soundPolicy = SOUND_POLICIES.includes(raw.entryEffectSoundPolicy)
    ? raw.entryEffectSoundPolicy
    : 'off';
  const assetVersion = typeof raw.entryEffectAssetVersion === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(raw.entryEffectAssetVersion.trim())
    ? raw.entryEffectAssetVersion.trim()
    : 'static-1';
  const minimumClientVersion = typeof raw.entryEffectMinimumClientVersion === 'string'
    && CLIENT_VERSION_PATTERN.test(raw.entryEffectMinimumClientVersion.trim())
    ? raw.entryEffectMinimumClientVersion.trim()
    : '';
  const width = Number.isInteger(raw.entryEffectWidth)
    ? Math.min(MAX_EFFECT_DIMENSION, Math.max(1, raw.entryEffectWidth))
    : 720;
  const height = Number.isInteger(raw.entryEffectHeight)
    ? Math.min(MAX_EFFECT_DIMENSION, Math.max(1, raw.entryEffectHeight))
    : 405;
  const fallbackArtworkUrl = isApprovedEntryAssetUrl(raw.entryEffectFallbackUrl)
    ? raw.entryEffectFallbackUrl.trim()
    : thumbnailUrl;
  return {
    assetVersion,
    durationMs,
    fallbackArtworkUrl,
    height,
    minimumClientVersion,
    nameAr: catalogItem.name?.ar || catalogItem.itemId,
    nameEn: catalogItem.name?.en || catalogItem.itemId,
    performanceTier,
    previewAssetUrl,
    soundPolicy,
    thumbnailUrl,
    width,
  };
}

function resolveEntryEffectAnnouncement({
  catalogData,
  catalogItem,
  command,
  cosmeticsFlags,
  customEntryRecords,
  equipment,
  featureFlags,
  nowMs,
  ownership,
  presentationRecords,
  publicProfile,
  room,
  senderUid,
}) {
  if (featureFlags?.voice_room_entry_effects !== true) {
    return entryEffectError('FEATURE_DISABLED', 503, 'Room entry effects are not enabled.');
  }
  if (!isActiveRoom(room)) {
    return entryEffectError('ROOM_NOT_ACTIVE', 409, 'The room is not available for entry effects.');
  }
  if (!isEligiblePublicProfile(publicProfile, senderUid)) {
    return entryEffectError('ACCOUNT_RESTRICTED', 403, 'A complete active profile is required.');
  }
  if (
    room.effectsPolicy === 'off'
    || room.roomCustomizationSuspended === true
    || (room.staffLockdown && typeof room.staffLockdown === 'object')
  ) {
    return { ok: true, value: { skipped: true, reason: 'ROOM_EFFECTS_DISABLED' } };
  }

  const customProjection = readCustomEntryProjection(equipment);
  if (customProjection && cosmeticsFlags?.cosmetics_custom_rendering === true) {
    const customResolution = resolveCustomEntryEffectAnnouncement({
      command,
      cosmeticsFlags,
      customEntryRecords,
      nowMs,
      projection: customProjection,
      publicProfile,
      room,
      senderUid,
    });
    // Fail closed to store/platform cars when custom ownership/asset checks fail.
    if (customResolution.ok && !customResolution.value?.skipped) {
      return customResolution;
    }
  }

  const equippedCarId = typeof equipment?.slots?.cars === 'string' ? equipment.slots.cars.trim() : '';
  if (!equippedCarId) {
    return { ok: true, value: { skipped: true, reason: 'NO_EQUIPPED_CAR' } };
  }
  if (!ownership || ownership.itemId !== equippedCarId || ownership.uid !== senderUid) {
    return entryEffectError('OWNERSHIP_REQUIRED', 409, 'Equipped entry vehicle ownership is required.');
  }
  if (ownership.state !== 'active' || ownership.category !== 'cars') {
    return entryEffectError('OWNERSHIP_INACTIVE', 409, 'The equipped entry vehicle is not active.');
  }
  const expiresAtMs = timestampToMillis(ownership.expiresAt);
  if (expiresAtMs && expiresAtMs <= nowMs) {
    return entryEffectError('OWNERSHIP_EXPIRED', 409, 'The equipped entry vehicle has expired.');
  }
  if (!catalogItem || catalogItem.itemId !== equippedCarId || catalogItem.category !== 'cars') {
    return entryEffectError('CATALOG_UNAVAILABLE', 404, 'Entry vehicle catalog item is unavailable.');
  }
  if (catalogItem.availability !== 'available') {
    return entryEffectError('CATALOG_UNAVAILABLE', 404, 'Entry vehicle catalog item is unavailable.');
  }
  const metadata = mapCarEntryEffectMetadata(catalogData, catalogItem);
  if (!metadata) {
    return entryEffectError('CATALOG_UNAVAILABLE', 404, 'Entry vehicle effect metadata is unavailable.');
  }
  const presentationInspection = catalogItem.entryPresentation
    ? inspectApprovedEntryPresentation({
      presentation: catalogItem.entryPresentation,
      records: presentationRecords,
    })
    : { ok: true, presentation: buildLegacyEntryPresentation() };
  if (!presentationInspection.ok) {
    return entryEffectError(
      presentationInspection.code || 'ENTRY_ASSET_UNAVAILABLE',
      409,
      'The equipped entry effect is not approved for playback.',
    );
  }
  const presentation = catalogItem.entryPresentation
    ? presentationInspection.presentation
    : {
      ...presentationInspection.presentation,
      durationMs: metadata.durationMs,
      minimumClientVersion: metadata.minimumClientVersion || '0.0.0',
      performanceTier: metadata.performanceTier,
      soundPolicy: metadata.soundPolicy,
    };
  if (
    presentation.minimumClientVersion !== '0.0.0'
    && (!command.clientVersion || compareClientVersions(command.clientVersion, presentation.minimumClientVersion) < 0)
  ) {
    return entryEffectError(
      'CLIENT_UPDATE_REQUIRED',
      426,
      'The equipped entry vehicle requires a newer client version.',
      { minimumClientVersion: presentation.minimumClientVersion },
    );
  }
  const delivery = resolveEntryPresentationDelivery(presentation, cosmeticsFlags);
  const hasApprovedPresentation = catalogItem.entryPresentation?.animationEnabled === true;
  const deliveredCosmeticAsset = delivery.animationEnabled
    ? presentation.visualAsset
    : hasApprovedPresentation ? presentation.fallbackAsset : undefined;
  const roomEffectsPolicy = ['full', 'reduced', 'off'].includes(room.effectsPolicy)
    ? room.effectsPolicy
    : 'full';
  const eventId = createEntryEffectEventId(command.roomId, senderUid, command.sessionId);
  return {
    ok: true,
    value: {
      skipped: false,
      effect: {
        assetVersion: metadata.assetVersion,
        ...(hasApprovedPresentation ? {
          assetSnapshot: {
            audioAsset: presentation.audioAsset || null,
            audioChecksum: presentationRecords?.audio?.version?.sha256 || '',
            fallbackAsset: presentation.fallbackAsset,
            fallbackChecksum: presentationRecords?.fallback?.version?.sha256 || '',
            physicalApprovalReceiptId: presentation.physicalApprovalReceiptId,
            visualAsset: presentation.visualAsset,
            visualChecksum: presentationRecords?.visual?.version?.sha256 || '',
          },
        } : {}),
        ...(deliveredCosmeticAsset ? { cosmeticAsset: deliveredCosmeticAsset } : {}),
        animationEnabled: delivery.animationEnabled,
        audioEnabled: delivery.audioEnabled,
        canonicalSlot: 'entry-effect',
        copy: buildEntryEffectCopySnapshot({
          displayName: publicProfile.displayName,
          itemNameAr: metadata.nameAr,
          itemNameEn: metadata.nameEn,
        }),
        displayName: publicProfile.displayName,
        durationMs: presentation.durationMs,
        eventId,
        expiresAtMs: nowMs + EFFECT_TTL_MS,
        fallbackArtworkUrl: metadata.fallbackArtworkUrl,
        height: metadata.height,
        itemId: equippedCarId,
        kind: 'room-entry',
        legacyEquipmentSlot: 'cars',
        minimumClientVersion: presentation.minimumClientVersion,
        nameAr: metadata.nameAr,
        nameEn: metadata.nameEn,
        performanceTier: presentation.performanceTier,
        previewAssetUrl: metadata.previewAssetUrl,
        priority: presentation.performanceTier === 'high' ? 3 : 2,
        presentationSurface: resolveRoomEffectSurface('room-entry'),
        queueHintMax: MAX_QUEUE_HINT,
        roomEffectsPolicy,
        roomId: command.roomId,
        senderUid,
        sessionId: command.sessionId,
        soundPolicy: presentation.soundPolicy,
        thumbnailUrl: metadata.thumbnailUrl,
        ...(presentation.visualFormat ? { visualFormat: presentation.visualFormat } : {}),
        width: metadata.width,
      },
    },
  };
}

function readCustomEntryProjection(equipment) {
  const projection = equipment?.customCosmetics?.entryEffect;
  if (!projection || typeof projection !== 'object' || Array.isArray(projection)) return undefined;
  const assetId = typeof projection.assetId === 'string' ? projection.assetId.trim() : '';
  const assetVersionId = typeof projection.assetVersionId === 'string'
    ? projection.assetVersionId.trim()
    : '';
  const itemId = typeof projection.itemId === 'string' ? projection.itemId.trim() : '';
  if (
    projection.source !== 'custom'
    || !/^[a-z0-9][a-z0-9_-]{2,79}$/.test(assetId)
    || !/^v[1-9][0-9]{0,8}-[a-f0-9]{12}$/.test(assetVersionId)
    || !/^[a-z0-9][a-z0-9_-]{2,79}$/.test(itemId)
  ) return undefined;
  return { assetId, assetVersionId, itemId, source: 'custom' };
}

function resolveCustomEntryEffectAnnouncement({
  command,
  cosmeticsFlags,
  customEntryRecords,
  nowMs,
  projection,
  publicProfile,
  room,
  senderUid,
}) {
  const {
    inspectApprovedCustomOwnership,
    isCustomMp4Rejected,
  } = require('./cosmeticCustomSubmissionCore');
  const approved = inspectApprovedCustomOwnership({
    approval: customEntryRecords?.approval,
    ownership: customEntryRecords?.ownership,
    summary: customEntryRecords?.summary,
    uid: senderUid,
    version: customEntryRecords?.version,
  });
  if (
    !approved.ok
    || approved.value.category !== 'entry-effect'
    || approved.value.format !== 'lottie-json'
    || approved.value.assetId !== projection.assetId
    || approved.value.assetVersionId !== projection.assetVersionId
    || isCustomMp4Rejected(approved.value.format, customEntryRecords?.version?.contentType)
  ) {
    return entryEffectError(
      'CUSTOM_ENTRY_UNAVAILABLE',
      409,
      'The equipped custom entry effect is not approved for playback.',
    );
  }

  const version = customEntryRecords.version;
  const fallback = inspectCustomEntryFallback(customEntryRecords?.fallback);
  if (!fallback.ok) {
    return entryEffectError(
      fallback.code || 'CUSTOM_ENTRY_FALLBACK_UNAVAILABLE',
      409,
      'The equipped custom entry effect fallback is unavailable.',
    );
  }
  if (
    version.fallbackAssetId !== fallback.assetId
    || version.fallbackAssetVersionId !== fallback.assetVersionId
  ) {
    return entryEffectError(
      'CUSTOM_ENTRY_FALLBACK_UNAVAILABLE',
      409,
      'The equipped custom entry effect fallback is unavailable.',
    );
  }

  const durationMs = Number.isInteger(version.durationMs)
    ? Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, version.durationMs))
    : DEFAULT_DURATION_MS;
  const minimumClientVersion = typeof version.minimumClientVersion === 'string'
    && CLIENT_VERSION_PATTERN.test(version.minimumClientVersion.trim())
    ? version.minimumClientVersion.trim()
    : '1.0.0';
  if (
    minimumClientVersion !== '0.0.0'
    && (!command.clientVersion || compareClientVersions(command.clientVersion, minimumClientVersion) < 0)
  ) {
    return entryEffectError(
      'CLIENT_UPDATE_REQUIRED',
      426,
      'The equipped custom entry effect requires a newer client version.',
      { minimumClientVersion },
    );
  }

  const presentation = {
    animationEnabled: true,
    durationMs,
    fallbackAsset: { assetId: fallback.assetId, assetVersionId: fallback.assetVersionId },
    minimumClientVersion,
    performanceTier: PERFORMANCE_TIERS.includes(version.performanceTier)
      ? version.performanceTier
      : 'standard',
    schemaVersion: 1,
    soundPolicy: 'off',
    visualAsset: { assetId: projection.assetId, assetVersionId: projection.assetVersionId },
    visualFormat: 'lottie-json',
  };
  const delivery = resolveEntryPresentationDelivery(presentation, {
    ...cosmeticsFlags,
    room_entry_animations: cosmeticsFlags?.room_entry_animations === true
      && cosmeticsFlags?.cosmetics_custom_rendering === true,
  });
  if (!delivery.animationEnabled) {
    // Motion gates off: do not play custom bytes; fall through to store cars.
    return { ok: true, value: { skipped: true, reason: 'CUSTOM_ENTRY_MOTION_DISABLED' } };
  }

  const roomEffectsPolicy = ['full', 'reduced', 'off'].includes(room.effectsPolicy)
    ? room.effectsPolicy
    : 'full';
  const width = Number.isInteger(version.width)
    ? Math.min(MAX_EFFECT_DIMENSION, Math.max(1, version.width))
    : 1280;
  const height = Number.isInteger(version.height)
    ? Math.min(MAX_EFFECT_DIMENSION, Math.max(1, version.height))
    : 720;
  const eventId = createEntryEffectEventId(command.roomId, senderUid, command.sessionId);
  const displayName = typeof publicProfile?.displayName === 'string'
    ? publicProfile.displayName
    : 'عضو';
  return {
    ok: true,
    value: {
      skipped: false,
      effect: {
        assetSnapshot: {
          audioAsset: null,
          audioChecksum: '',
          fallbackAsset: presentation.fallbackAsset,
          fallbackChecksum: fallback.checksum,
          physicalApprovalReceiptId: '',
          visualAsset: presentation.visualAsset,
          visualChecksum: version.sha256 || '',
        },
        animationEnabled: true,
        audioEnabled: false,
        assetVersion: projection.assetVersionId,
        canonicalSlot: 'entry-effect',
        cosmeticAsset: presentation.visualAsset,
        copy: buildEntryEffectCopySnapshot({
          displayName,
          itemNameAr: 'دخول مخصّص',
          itemNameEn: 'Custom entrance',
        }),
        customSource: true,
        displayName,
        durationMs,
        eventId,
        expiresAtMs: nowMs + EFFECT_TTL_MS,
        fallbackArtworkUrl: '',
        fallbackAssetId: fallback.assetId,
        fallbackAssetVersionId: fallback.assetVersionId,
        height,
        itemId: projection.itemId,
        kind: 'room-entry',
        minimumClientVersion,
        nameAr: 'دخول مخصّص',
        nameEn: 'Custom entrance',
        performanceTier: presentation.performanceTier,
        previewAssetUrl: '',
        priority: presentation.performanceTier === 'high' ? 3 : 2,
        presentationSurface: resolveRoomEffectSurface('room-entry'),
        queueHintMax: MAX_QUEUE_HINT,
        roomEffectsPolicy,
        roomId: command.roomId,
        senderUid,
        sessionId: command.sessionId,
        soundPolicy: 'off',
        thumbnailUrl: '',
        visualFormat: 'lottie-json',
        width,
      },
    },
  };
}

function inspectCustomEntryFallback(fallbackRecords) {
  const summary = fallbackRecords?.summary;
  const version = fallbackRecords?.version;
  const approval = fallbackRecords?.approval;
  const assetId = typeof version?.assetId === 'string' ? version.assetId.trim() : '';
  const assetVersionId = typeof version?.assetVersionId === 'string'
    ? version.assetVersionId.trim()
    : '';
  const expectedApprovalId = `${assetId}__${assetVersionId}`;
  if (
    !/^[a-z0-9][a-z0-9_-]{2,79}$/.test(assetId)
    || !/^v[1-9][0-9]{0,8}-[a-f0-9]{12}$/.test(assetVersionId)
    || !summary
    || !version
    || !approval
    || summary.ownerType !== 'platform'
    || summary.visibility === 'owner-bound'
    || summary.moderationStatus !== 'approved'
    || summary.publicationStatus !== 'published'
    || summary.renderingEnabled !== true
    || summary.approvedVersionId !== assetVersionId
    || summary.publishedVersionId !== assetVersionId
    || summary.approvalId !== expectedApprovalId
    || version.ownerType !== 'platform'
    || version.category !== 'entry-effect'
    || !['png', 'jpeg', 'legacy-webp'].includes(version.format)
    || version.usage !== 'static'
    || approval.decision !== 'approved'
    || approval.assetId !== assetId
    || approval.assetVersionId !== assetVersionId
    || approval.checksum !== version.sha256
  ) {
    return { ok: false, code: 'CUSTOM_ENTRY_FALLBACK_UNAVAILABLE' };
  }
  return {
    ok: true,
    assetId,
    assetVersionId,
    checksum: version.sha256 || '',
  };
}

function createEntryEffectEventId(roomId, senderUid, sessionId) {
  return `ree_${createHash('sha256').update(`${roomId}|${senderUid}|${sessionId}`).digest('hex').slice(0, 24)}`;
}

function createCoupleEntryEffectEventId(roomId, coupleIdHash, sessionIds) {
  const sessions = Array.isArray(sessionIds) ? [...sessionIds].sort() : [];
  if (
    !FIRESTORE_ID_PATTERN.test(roomId || '')
    || !/^[a-f0-9]{64}$/.test(coupleIdHash || '')
    || sessions.length !== 2
    || sessions.some((sessionId) => !SESSION_ID_PATTERN.test(sessionId))
  ) return '';
  return `rce_${createHash('sha256')
    .update(`${roomId}|${coupleIdHash}|${sessions.join('|')}`)
    .digest('hex')
    .slice(0, 24)}`;
}

function resolveCoupleEntryEffect({
  approvedDescriptor,
  command,
  cosmeticsFlags,
  equipment,
  featureFlags,
  memberProfiles,
  memberUids,
  nowMs,
  ownership,
  partnerPresence,
  presence,
  relationship,
  room,
}) {
  if (
    featureFlags?.voice_room_entry_effects !== true
    || cosmeticsFlags?.cosmetics_couple_entrances !== true
    || cosmeticsFlags?.cosmetics_couple_effects !== true
    || !isActiveRoom(room)
    || room.effectsPolicy === 'off'
    || room.roomCustomizationSuspended === true
    || (room.staffLockdown && typeof room.staffLockdown === 'object')
  ) return { eligible: false, reason: 'COUPLE_ENTRANCE_DISABLED' };
  const projection = equipment?.projection;
  const joinedAtMs = timestampToMillis(presence?.joinedAt);
  const partnerJoinedAtMs = timestampToMillis(partnerPresence?.joinedAt);
  const leaseExpiresAtMs = timestampToMillis(presence?.leaseExpiresAt);
  const partnerLeaseExpiresAtMs = timestampToMillis(partnerPresence?.leaseExpiresAt);
  const sessionIds = [presence?.sessionId, partnerPresence?.sessionId];
  const sortedMemberUids = Array.isArray(memberUids) ? [...memberUids].sort() : [];
  const sortedProfiles = Array.isArray(memberProfiles)
    ? [...memberProfiles].sort((left, right) => String(left?.uid).localeCompare(String(right?.uid)))
    : [];
  const eventId = createCoupleEntryEffectEventId(command.roomId, relationship?.coupleIdHash, sessionIds);
  if (
    !eventId
    || !relationship
    || sortedMemberUids.length !== 2
    || sortedProfiles.length !== 2
    || sortedProfiles.some((profile, index) => (
      profile?.uid !== sortedMemberUids[index]
      || profile?.moderationStatus !== 'active'
      || typeof profile?.displayName !== 'string'
      || profile.displayName.length < 2
      || profile?.coupleEffect?.coupleIdHash !== relationship.coupleIdHash
    ))
    || equipment?.state !== 'equipped'
    || equipment?.relationshipId !== relationship.relationshipId
    || equipment?.memberUids?.length !== 2
    || [...equipment.memberUids].sort().some((uid, index) => uid !== sortedMemberUids[index])
    || !projection
    || projection.coupleIdHash !== relationship.coupleIdHash
    || projection.entranceMode === 'off'
    || !approvedDescriptor
    || projection.assetId !== approvedDescriptor.assetId
    || projection.assetVersionId !== approvedDescriptor.assetVersionId
    || projection.fallbackAssetId !== approvedDescriptor.fallbackAssetId
    || projection.fallbackAssetVersionId !== approvedDescriptor.fallbackAssetVersionId
    || projection.format !== approvedDescriptor.format
    || ownership?.relationshipId !== relationship.relationshipId
    || ownership?.itemId !== projection.itemId
    || ownership?.state !== 'active'
    || ownership?.equipped !== true
    || (timestampToMillis(ownership?.expiresAt) || Infinity) <= nowMs
    || presence?.sessionId !== command.sessionId
    || !['online', 'reconnecting'].includes(presence?.status)
    || !['online', 'reconnecting'].includes(partnerPresence?.status)
    || leaseExpiresAtMs <= nowMs
    || partnerLeaseExpiresAtMs <= nowMs
    || !joinedAtMs
    || !partnerJoinedAtMs
    || nowMs - joinedAtMs < 0
    || nowMs - partnerJoinedAtMs < 0
    || nowMs - joinedAtMs > COUPLE_ENTRY_WINDOW_MS
    || nowMs - partnerJoinedAtMs > COUPLE_ENTRY_WINDOW_MS
    || Math.abs(joinedAtMs - partnerJoinedAtMs) > COUPLE_ENTRY_WINDOW_MS
  ) return { eligible: false, reason: 'COUPLE_NOT_ELIGIBLE' };

  const durationMs = projection.entranceMode === 'static' ? MIN_DURATION_MS : DEFAULT_DURATION_MS;
  return {
    eligible: true,
    sessionIds: [...sessionIds].sort(),
    effect: {
      animationEnabled: true,
      assetId: approvedDescriptor.assetId,
      assetVersionId: approvedDescriptor.assetVersionId,
      audioEnabled: false,
      coupleEntrance: true,
      durationMs,
      eventId,
      expiresAtMs: nowMs + EFFECT_TTL_MS,
      fallbackAssetId: approvedDescriptor.fallbackAssetId,
      fallbackAssetVersionId: approvedDescriptor.fallbackAssetVersionId,
      format: approvedDescriptor.format,
      kind: 'room-entry',
      copy: buildCoupleEntryCopySnapshot({
        memberDisplayNames: sortedProfiles.map((profile) => profile.displayName),
      }),
      memberDisplayNames: sortedProfiles.map((profile) => profile.displayName.slice(0, 40)),
      memberUids: sortedMemberUids,
      priority: 3,
      presentationSurface: resolveRoomEffectSurface('room-entry'),
      roomId: command.roomId,
    },
  };
}

function buildEntryEffectFingerprint(uid, command) {
  return createHash('sha256')
    .update([
      uid,
      command.action,
      command.roomId,
      command.sessionId,
      command.clientVersion,
      command.requestId,
    ].join('|'))
    .digest('hex');
}

function entryEffectError(code, status, error, details) {
  return {
    ok: false,
    code,
    status,
    error,
    ...(details ? { details } : {}),
  };
}

function isActiveRoom(room) {
  return Boolean(
    room
    && room.status === 'active'
    && (room.availability === undefined || room.availability === 'active'),
  );
}

function isEligiblePublicProfile(profile, uid) {
  return Boolean(
    profile
    && profile.uid === uid
    && profile.moderationStatus === 'active'
    && typeof profile.displayName === 'string'
    && profile.displayName.length >= 2,
  );
}

function timestampToMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function compareClientVersions(left, right) {
  const parse = (value) => String(value).split(/[+-]/, 1)[0].split('.').map((part) => Number(part));
  const leftParts = parse(left);
  const rightParts = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
  }
  return 0;
}

function isApprovedEntryAssetUrl(value) {
  const url = typeof value === 'string' ? value.trim() : '';
  if (!/^https:\/\/[^\s]{1,2039}$/.test(url)) return false;
  try {
    const parsed = new URL(url);
    const decodedPath = decodeURIComponent(parsed.pathname);
    if (parsed.hostname === 'firebasestorage.googleapis.com') {
      return /\/o\/store-assets\/[^/]+\/(thumbnail|preview)\/[A-Za-z0-9_-]{16,80}$/.test(decodedPath);
    }
    if (parsed.hostname === 'storage.googleapis.com') {
      return /\/store-assets\/[^/]+\/(thumbnail|preview)\/[A-Za-z0-9_-]{16,80}$/.test(decodedPath);
    }
    return false;
  } catch {
    return false;
  }
}

module.exports = {
  COUPLE_ENTRY_WINDOW_MS,
  DEFAULT_DURATION_MS,
  EFFECT_RETENTION_MS,
  EFFECT_TTL_MS,
  MAX_QUEUE_HINT,
  ROOM_ENTRY_EFFECT_ACTIONS,
  buildEntryEffectFingerprint,
  compareClientVersions,
  createCoupleEntryEffectEventId,
  createEntryEffectEventId,
  entryEffectError,
  mapCarEntryEffectMetadata,
  normalizeRoomEntryEffectBody,
  inspectCustomEntryFallback,
  readCustomEntryProjection,
  resolveCoupleEntryEffect,
  resolveCustomEntryEffectAnnouncement,
  resolveEntryEffectAnnouncement,
  timestampToMillis,
  validateRoomEntryEffectRequest,
};
