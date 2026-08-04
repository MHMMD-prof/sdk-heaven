const fs = require('node:fs');
const path = require('node:path');
const admin = require('firebase-admin');

const { executeAdminWalletCredit } = require('../adminWalletService');
const { executeRepresentativePolicyUpdate } = require('../representativeAdminService');
const { executeAdminRepresentativeUpdate } = require('../representativeService');
const { normalizeRepresentativeTransferPolicy } = require('../representativePortalCore');
const { isTimestampLike, validatePrivateProfile } = require('../socialProfileCore');
const { provisionPublicProfile } = require('../socialProfileService');

const DEFAULT_POLICY = Object.freeze({
  coins: Object.freeze({
    maxPerDay: 200_000,
    maxPerTransfer: 50_000,
    maxTransfersPerHour: 20,
  }),
  diamonds: Object.freeze({
    maxPerDay: 20_000,
    maxPerTransfer: 5_000,
    maxTransfersPerHour: 20,
  }),
});

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const serviceAccount = JSON.parse(fs.readFileSync(options.credentialFile, 'utf8'));
  if (serviceAccount.project_id !== options.projectId) {
    throw new Error('The service account does not belong to the requested Firebase project.');
  }
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: options.projectId,
    });
  }

  const db = admin.firestore();
  const auth = admin.auth();
  const refs = {
    actor: db.doc(`adminProfiles/${options.actorUid}`),
    features: db.doc('appConfig/socialFeatures'),
    policy: db.doc('appConfig/representativeTransferPolicy'),
    privilege: db.doc(`representativePrivileges/${options.targetUid}`),
    privateProfile: db.doc(`users/${options.targetUid}`),
    publicProfile: db.doc(`publicProfiles/${options.targetUid}`),
    room: db.doc(`rooms/representative-test-${options.targetUid}`),
    wallet: db.doc(`walletSummaries/${options.targetUid}`),
  };
  const [
    actor,
    features,
    policy,
    privilege,
    privateProfile,
    publicProfile,
    room,
    wallet,
    targetAuth,
    actorAuth,
  ] = await Promise.all([
    refs.actor.get(),
    refs.features.get(),
    refs.policy.get(),
    refs.privilege.get(),
    refs.privateProfile.get(),
    refs.publicProfile.get(),
    refs.room.get(),
    refs.wallet.get(),
    auth.getUser(options.targetUid),
    auth.getUser(options.actorUid),
  ]);

  requirePlatformOwner(actor, options.actorUid);
  if (targetAuth.disabled) throw new Error('The target Firebase Authentication user is disabled.');
  const initialPrivateValidation = validatePrivateProfile(privateProfile.data(), options.targetUid);
  let profile = publicProfile.data();
  let privateData = privateProfile.data();
  const displayName = readDisplayName(profile?.displayName)
    || readDisplayName(privateData?.displayName)
    || readDisplayName(targetAuth.displayName)
    || 'Test Representative';
  const avatarLabel = readAvatarLabel(profile?.avatarLabel)
    || readAvatarLabel(privateData?.avatarLabel)
    || [...displayName][0];
  if (!displayName || !avatarLabel) throw new Error('The target profile is missing its display name or avatar label.');

  const currentPolicy = normalizeRepresentativeTransferPolicy(policy.data()?.limits);
  const result = {
    apply: options.apply,
    actorUid: options.actorUid,
    targetUid: options.targetUid,
    projectId: options.projectId,
    requestedFunding: { coins: options.coins, diamonds: options.diamonds },
    before: {
      balances: {
        coins: readAmount(wallet.data()?.balances?.coins ?? wallet.data()?.balance),
        diamonds: readAmount(wallet.data()?.balances?.diamonds),
      },
      representative: {
        active: privilege.data()?.active === true,
        currencies: {
          coins: privilege.data()?.currencies?.coins === true,
          diamonds: privilege.data()?.currencies?.diamonds === true,
        },
      },
      representativeTransfersEnabled: features.data()?.representativeTransfers === true,
      walletEnabled: features.data()?.wallet === true,
      transferPolicyConfigured: currentPolicy.ok,
      profile: {
        privateReady: initialPrivateValidation.ok,
        publicDocumentExists: publicProfile.exists,
      },
      room: room.exists
        ? { id: room.id, ownerUid: room.data()?.ownerUid, status: room.data()?.status }
        : null,
    },
  };
  console.info(JSON.stringify(result, null, 2));
  if (!options.apply) return;
  if (features.data()?.wallet !== true) {
    throw new Error('The wallet feature is disabled. It was not overridden automatically.');
  }

  const decodedActor = {
    email: actorAuth.email || actor.data()?.email || '',
    uid: options.actorUid,
  };
  const fieldValue = admin.firestore.FieldValue;
  const stamp = '20260728_v1';
  const repairedProfiles = await ensureTargetProfiles({
    actorEmail: decodedActor.email,
    actorUid: options.actorUid,
    authUser: targetAuth,
    avatarLabel,
    db,
    displayName,
    fieldValue,
    initialPrivateSnapshot: privateProfile,
    targetUid: options.targetUid,
  });
  profile = repairedProfiles.publicProfile;
  privateData = repairedProfiles.privateProfile;
  if (!currentPolicy.ok) {
    await executeRepresentativePolicyUpdate({
      db,
      decodedToken: decodedActor,
      fieldValue,
      input: {
        expectedUpdatedAt: timestampIso(policy.data()?.updatedAt) || 'missing',
        limits: DEFAULT_POLICY,
        reason: 'Configure bounded representative transfer policy for development testing',
        requestId: `representative_test_policy_${stamp}`,
      },
    });
  }
  await ensureRepresentativeTransfersEnabled({
    actorEmail: decodedActor.email,
    actorUid: options.actorUid,
    db,
    fieldValue,
    requestId: `representative_test_feature_${stamp}`,
  });
  await executeAdminRepresentativeUpdate({
    db,
    decodedToken: decodedActor,
    fieldValue,
    input: {
      active: true,
      currencies: { coins: true, diamonds: true },
      expectedUpdatedAt: timestampIso(privilege.data()?.updatedAt) || 'missing',
      reason: 'Grant representative access for development transfer testing',
      requestId: `representative_test_grant_${stamp}`,
      targetUid: options.targetUid,
    },
  });
  await executeAdminWalletCredit({
    db,
    decodedToken: decodedActor,
    fieldValue,
    input: {
      amount: options.coins,
      currency: 'coins',
      expectedUpdatedAt: '',
      note: 'Representative transfer development test funding',
      requestId: `representative_test_coins_${stamp}`,
      targetUid: options.targetUid,
    },
  });
  await executeAdminWalletCredit({
    db,
    decodedToken: decodedActor,
    fieldValue,
    input: {
      amount: options.diamonds,
      currency: 'diamonds',
      expectedUpdatedAt: '',
      note: 'Representative transfer development test funding',
      requestId: `representative_test_diamonds_${stamp}`,
      targetUid: options.targetUid,
    },
  });
  const roomId = await provisionOwnedRoom({
    actorEmail: decodedActor.email,
    actorUid: options.actorUid,
    avatarLabel,
    countryCode: readCountryCode(profile?.countryCode),
    db,
    displayName,
    fieldValue,
    roomRef: refs.room,
    targetUid: options.targetUid,
  });
  await auth.revokeRefreshTokens(options.targetUid);

  const [afterPrivilege, afterWallet, afterRoom, afterFeatures, afterPolicy] = await Promise.all([
    refs.privilege.get(),
    refs.wallet.get(),
    refs.room.get(),
    refs.features.get(),
    refs.policy.get(),
  ]);
  const verifiedPolicy = normalizeRepresentativeTransferPolicy(afterPolicy.data()?.limits);
  const verified = {
    balances: {
      coins: readAmount(afterWallet.data()?.balances?.coins),
      diamonds: readAmount(afterWallet.data()?.balances?.diamonds),
    },
    representativeActive: afterPrivilege.data()?.active === true,
    representativeCurrencies: afterPrivilege.data()?.currencies,
    representativeTransfersEnabled: afterFeatures.data()?.representativeTransfers === true,
    roomId,
    roomOwnerUid: afterRoom.data()?.ownerUid,
    roomStatus: afterRoom.data()?.status,
    seatEngineVersion: afterRoom.data()?.seatEngineVersion,
    transferPolicyConfigured: verifiedPolicy.ok,
  };
  if (
    !verified.representativeActive
    || verified.representativeCurrencies?.coins !== true
    || verified.representativeCurrencies?.diamonds !== true
    || !verified.representativeTransfersEnabled
    || verified.roomOwnerUid !== options.targetUid
    || verified.roomStatus !== 'active'
    || verified.seatEngineVersion !== 1
    || !verified.transferPolicyConfigured
  ) {
    throw new Error('Provisioning completed but production verification failed.');
  }
  console.info(JSON.stringify({ applied: true, verified }, null, 2));
}

async function ensureTargetProfiles({
  actorEmail,
  actorUid,
  authUser,
  avatarLabel,
  db,
  displayName,
  fieldValue,
  initialPrivateSnapshot,
  targetUid,
}) {
  const privateRef = db.doc(`users/${targetUid}`);
  if (!validatePrivateProfile(initialPrivateSnapshot.data(), targetUid).ok) {
    const timestamp = fieldValue.serverTimestamp();
    const auditRef = db.doc(`adminAuditEvents/representative_test_profile_${targetUid}_v1`);
    await db.runTransaction(async (transaction) => {
      const [current, audit] = await Promise.all([
        transaction.get(privateRef),
        transaction.get(auditRef),
      ]);
      if (validatePrivateProfile(current.data(), targetUid).ok) return;
      if (audit.exists) {
        if (audit.data()?.action === 'representative-test-profile-repair'
          && audit.data()?.targetUid === targetUid) return;
        throw new Error('Representative profile repair audit request conflicts with an existing operation.');
      }
      transaction.set(privateRef, {
        avatarLabel,
        createdAt: current.data()?.createdAt || timestamp,
        displayName,
        email: authUser.email || `${targetUid}@test.invalid`,
        uid: targetUid,
        updatedAt: timestamp,
      }, { merge: true });
      transaction.create(auditRef, {
        action: 'representative-test-profile-repair',
        actorEmail,
        actorUid,
        createdAt: timestamp,
        kind: 'profile-provisioning',
        note: 'Repair the development representative private profile',
        source: 'server-credential-cli',
        status: 'completed',
        targetUid,
      });
    });
  }
  const provisioned = await provisionPublicProfile({
    actorEmail,
    actorUid,
    auditAction: 'representative-test-profile-provision',
    bypassRateLimit: true,
    db,
    fieldValue,
    requestId: `representative_test_profile_${targetUid}_v1`,
    uid: targetUid,
  });
  if (provisioned.errorCode || !provisioned.result?.provisioned) {
    throw new Error(`Target profile provisioning failed: ${provisioned.errorCode || 'UNKNOWN'}.`);
  }
  const [privateProfile, publicProfile] = await Promise.all([
    privateRef.get(),
    db.doc(`publicProfiles/${targetUid}`).get(),
  ]);
  if (!validatePrivateProfile(privateProfile.data(), targetUid).ok || !publicProfile.exists) {
    throw new Error('Target profile provisioning did not produce complete profiles.');
  }
  return {
    privateProfile: privateProfile.data(),
    publicProfile: publicProfile.data(),
  };
}

async function ensureRepresentativeTransfersEnabled({
  actorEmail,
  actorUid,
  db,
  fieldValue,
  requestId,
}) {
  const configRef = db.doc('appConfig/socialFeatures');
  const auditRef = db.doc(`adminAuditEvents/${requestId}`);
  await db.runTransaction(async (transaction) => {
    const [config, audit] = await Promise.all([
      transaction.get(configRef),
      transaction.get(auditRef),
    ]);
    if (audit.exists) {
      if (audit.data()?.action === 'representative-emergency-enable'
        && audit.data()?.actorUid === actorUid) return;
      throw new Error('Representative feature audit request ID conflicts with an existing operation.');
    }
    if (config.data()?.representativeTransfers === true) return;
    const timestamp = fieldValue.serverTimestamp();
    transaction.set(configRef, {
      representativeTransfers: true,
      updatedAt: timestamp,
      updatedBy: actorUid,
    }, { merge: true });
    transaction.create(auditRef, {
      action: 'representative-emergency-enable',
      actorEmail,
      actorUid,
      after: { representativeTransfers: true },
      before: { representativeTransfers: false },
      createdAt: timestamp,
      kind: 'administrator-security',
      note: 'Enable representative transfers for development testing',
      source: 'server-credential-cli',
      status: 'completed',
      targetUid: 'representativeTransfers',
    });
  });
}

async function provisionOwnedRoom({
  actorEmail,
  actorUid,
  avatarLabel,
  countryCode,
  db,
  displayName,
  fieldValue,
  roomRef,
  targetUid,
}) {
  const auditRef = db.doc(`adminAuditEvents/representative_test_room_${targetUid}_v1`);
  return db.runTransaction(async (transaction) => {
    const [room, audit] = await Promise.all([
      transaction.get(roomRef),
      transaction.get(auditRef),
    ]);
    if (audit.exists) {
      if (audit.data()?.action === 'representative-test-room-provision'
        && audit.data()?.targetUid === targetUid) return roomRef.id;
      throw new Error('Representative room audit request ID conflicts with an existing operation.');
    }
    if (room.exists && room.data()?.ownerUid !== targetUid) {
      throw new Error('The deterministic representative test room belongs to another user.');
    }
    const timestamp = fieldValue.serverTimestamp();
    if (!room.exists) {
      transaction.create(roomRef, {
        announcement: '',
        audioLockdown: false,
        availability: 'active',
        chatMode: 'everyone',
        countryCode,
        createdAt: timestamp,
        effectsPolicy: 'full',
        historyVisibility: 'after-join',
        hostAvatarLabel: avatarLabel,
        hostDisplayName: displayName,
        hostId: targetUid,
        id: roomRef.id,
        keywordFilterMode: 'standard',
        moderatorCount: 0,
        ownerAvatarLabel: avatarLabel,
        ownerDisplayName: displayName,
        ownerUid: targetUid,
        ownershipRevision: 1,
        participantCount: 1,
        revision: 1,
        roomCustomizationSuspended: false,
        roomImageReviewStatus: 'none',
        schemaVersion: 2,
        seatEngineActivatedAt: timestamp,
        seatEngineActivatedBy: actorUid,
        seatEngineVersion: 1,
        seatMode: 'open',
        seatTargetCount: 10,
        slowModeSeconds: 0,
        speakerCount: 1,
        status: 'active',
        themeId: 'majlis-default',
        title: 'Representative Test Room',
        type: 'voice',
        updatedAt: timestamp,
        updatedBy: actorUid,
        visibility: 'public',
        welcomeMessage: 'Development room for representative transfer testing.',
      });
      transaction.create(roomRef.collection('members').doc(targetUid), {
        authorityRole: 'owner',
        avatarLabel,
        canPublishAudio: true,
        displayName,
        joinedAt: timestamp,
        privileges: { canManageMusic: false },
        role: 'host',
        schemaVersion: 2,
        seatId: '01',
        status: 'active',
        uid: targetUid,
        updatedAt: timestamp,
      });
      for (let seatNumber = 1; seatNumber <= 20; seatNumber += 1) {
        const occupied = seatNumber === 1;
        transaction.create(roomRef.collection('seats').doc(String(seatNumber).padStart(2, '0')), {
          ...(occupied ? {
            occupancyState: 'occupied',
            occupantUid: targetUid,
            retired: false,
          } : {}),
          revision: occupied ? 2 : 1,
          schemaVersion: 2,
          seatNumber,
          state: occupied ? 'occupied' : 'open',
          updatedAt: timestamp,
        });
      }
    }
    transaction.create(auditRef, {
      action: 'representative-test-room-provision',
      actorEmail,
      actorUid,
      after: { ownerUid: targetUid, roomId: roomRef.id, status: 'active' },
      before: room.exists ? { ownerUid: room.data()?.ownerUid, status: room.data()?.status } : null,
      createdAt: timestamp,
      kind: 'room',
      note: 'Provision an owned room for representative development testing',
      source: 'server-credential-cli',
      status: 'completed',
      targetUid,
    });
    return roomRef.id;
  });
}

function requirePlatformOwner(snapshot, uid) {
  const profile = snapshot.data();
  if (!snapshot.exists || profile?.uid !== uid || profile?.role !== 'owner' || profile?.status !== 'active') {
    throw new Error('The actor must be an active Platform Owner.');
  }
}

function parseOptions(args) {
  const values = Object.fromEntries(args
    .filter((argument) => argument.startsWith('--') && argument.includes('='))
    .map((argument) => argument.slice(2).split(/=(.*)/s, 2)));
  const credentialFile = path.resolve(String(values['credential-file'] || ''));
  const projectId = String(values['project-id'] || '').trim();
  const actorUid = String(values['actor-uid'] || '').trim();
  const targetUid = String(values['target-uid'] || '').trim();
  const coins = Number(values.coins ?? 10_000);
  const diamonds = Number(values.diamonds ?? 1_000);
  if (!fs.existsSync(credentialFile)) throw new Error('--credential-file must point to the service-account JSON.');
  if (!/^[a-z][a-z0-9-]{4,29}$/.test(projectId)) throw new Error('--project-id is invalid.');
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(actorUid)) throw new Error('--actor-uid is invalid.');
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(targetUid)) throw new Error('--target-uid is invalid.');
  if (!Number.isSafeInteger(coins) || coins < 1 || !Number.isSafeInteger(diamonds) || diamonds < 1) {
    throw new Error('--coins and --diamonds must be positive integers.');
  }
  return {
    actorUid,
    apply: args.includes('--apply'),
    coins,
    credentialFile,
    diamonds,
    projectId,
    targetUid,
  };
}

function readAmount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function readAvatarLabel(value) {
  return typeof value === 'string' && [...value.trim()].length === 1 ? value.trim() : '';
}

function readCountryCode(value) {
  return typeof value === 'string' && /^[A-Z]{2}$/.test(value) ? value : 'IQ';
}

function readDisplayName(value) {
  return typeof value === 'string' ? value.trim().slice(0, 40) : '';
}

function timestampIso(value) {
  return isTimestampLike(value) ? new Date(value.toMillis()).toISOString() : '';
}
