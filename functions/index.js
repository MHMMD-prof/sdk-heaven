const admin = require('firebase-admin');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { AccessToken, TrackSource } = require('livekit-server-sdk');

const {
  createAdminOverviewPayload,
  filterAdminUserRows,
  mapAdminUserProfileDocument,
  normalizeAdminUserNote,
  normalizeAdminUsersQuery,
  resolveAdminDashboardRequest,
} = require('./adminDashboardCore');
const { extractBearerToken, resolveTokenRequest } = require('./livekitTokenCore');
const { normalizeRoomCommandBody, resolveRoomCommand } = require('./roomCommandCore');

admin.initializeApp();

const liveKitUrl = defineSecret('LIVEKIT_URL');
const liveKitApiKey = defineSecret('LIVEKIT_API_KEY');
const liveKitApiSecret = defineSecret('LIVEKIT_API_SECRET');

exports.livekitToken = onRequest(
  {
    cors: true,
    invoker: 'public',
    region: 'us-central1',
    secrets: [liveKitUrl, liveKitApiKey, liveKitApiSecret],
  },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Use POST.' });
      return;
    }

    const idToken = extractBearerToken(request.headers);

    if (!idToken) {
      response.status(401).json({ error: 'Authentication is required.' });
      return;
    }

    let decodedToken;

    try {
      decodedToken = await admin.auth().verifyIdToken(idToken);
    } catch (error) {
      console.error('Invalid Firebase ID token:', error);
      response.status(401).json({ error: 'Authentication is invalid.' });
      return;
    }

    try {
      const requestedRoomId = typeof request.body?.roomId === 'string' ? request.body.roomId.trim() : '';
      const db = admin.firestore();
      const [profileSnapshot, roomSnapshot, membershipSnapshot] = await Promise.all([
        db.doc(`users/${decodedToken.uid}`).get(),
        requestedRoomId ? db.doc(`rooms/${requestedRoomId}`).get() : Promise.resolve(undefined),
        requestedRoomId ? db.doc(`rooms/${requestedRoomId}/members/${decodedToken.uid}`).get() : Promise.resolve(undefined),
      ]);
      const tokenRequest = resolveTokenRequest({
        body: request.body,
        decodedToken,
        membership: membershipSnapshot?.exists ? membershipSnapshot.data() : undefined,
        profile: profileSnapshot.exists ? profileSnapshot.data() : undefined,
        room: roomSnapshot?.exists ? roomSnapshot.data() : undefined,
      });

      if (!tokenRequest.ok) {
        response.status(tokenRequest.status).json({ error: tokenRequest.error });
        return;
      }

      const {
        avatarLabel,
        canPublish,
        displayName,
        participantId,
        role,
        roomId,
      } = tokenRequest.value;
      const token = new AccessToken(liveKitApiKey.value(), liveKitApiSecret.value(), {
        identity: participantId,
        name: displayName,
        ttl: '1h',
        metadata: JSON.stringify({
          avatarLabel,
          displayName,
          role,
          uid: participantId,
        }),
      });

      token.addGrant({
        room: roomId,
        roomJoin: true,
        canSubscribe: true,
        canPublish,
        canPublishData: true,
        canPublishSources: canPublish ? [TrackSource.MICROPHONE] : [],
      });

      response.json({
        serverUrl: liveKitUrl.value(),
        token: await token.toJwt(),
        canPublishAudio: canPublish,
      });
    } catch (error) {
      console.error('Failed to create LiveKit token:', error);
      response.status(500).json({ error: 'Failed to create LiveKit token.' });
    }
  },
);

exports.roomCommand = onRequest(
  {
    cors: true,
    invoker: 'public',
    region: 'us-central1',
  },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Use POST.' });
      return;
    }

    const idToken = extractBearerToken(request.headers);

    if (!idToken) {
      response.status(401).json({ error: 'Authentication is required.' });
      return;
    }

    let decodedToken;

    try {
      decodedToken = await admin.auth().verifyIdToken(idToken);
    } catch (error) {
      console.error('Invalid Firebase ID token:', error);
      response.status(401).json({ error: 'Authentication is invalid.' });
      return;
    }

    const commandBody = normalizeRoomCommandBody(request.body);

    if (!commandBody.roomId) {
      response.status(400).json({ error: 'roomId is required.' });
      return;
    }

    try {
      const db = admin.firestore();
      const result = await db.runTransaction(async (transaction) => {
        const profileRef = db.doc(`users/${decodedToken.uid}`);
        const roomRef = db.doc(`rooms/${commandBody.roomId}`);
        const actorMemberRef = db.doc(`rooms/${commandBody.roomId}/members/${decodedToken.uid}`);
        const targetMemberRef = commandBody.targetUid
          ? db.doc(`rooms/${commandBody.roomId}/members/${commandBody.targetUid}`)
          : undefined;
        const [profileSnapshot, roomSnapshot, actorMemberSnapshot, targetMemberSnapshot] = await Promise.all([
          transaction.get(profileRef),
          transaction.get(roomRef),
          transaction.get(actorMemberRef),
          targetMemberRef ? transaction.get(targetMemberRef) : Promise.resolve(undefined),
        ]);
        const command = resolveRoomCommand({
          actorMembership: actorMemberSnapshot.exists ? actorMemberSnapshot.data() : undefined,
          body: request.body,
          decodedToken,
          profile: profileSnapshot.exists ? profileSnapshot.data() : undefined,
          room: roomSnapshot.exists ? roomSnapshot.data() : undefined,
          targetMembership: targetMemberSnapshot?.exists ? targetMemberSnapshot.data() : undefined,
        });

        if (!command.ok) {
          return command;
        }

        const eventRef = roomRef.collection('moderationEvents').doc();
        const eventPayload = {
          action: command.value.action,
          actorUid: decodedToken.uid,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          reason: command.value.reason || '',
          roomId: command.value.roomId,
          targetUid: command.value.targetUid || '',
        };

        if (command.value.action === 'promote-speaker' && targetMemberRef) {
          transaction.update(targetMemberRef, {
            role: 'speaker',
            status: 'active',
            canPublishAudio: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedBy: decodedToken.uid,
          });
        }

        if (command.value.action === 'demote-listener' && targetMemberRef) {
          transaction.update(targetMemberRef, {
            role: 'listener',
            status: 'active',
            canPublishAudio: false,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedBy: decodedToken.uid,
          });
        }

        if (command.value.action === 'remove-member' && targetMemberRef) {
          transaction.update(targetMemberRef, {
            status: 'removed',
            canPublishAudio: false,
            removedAt: admin.firestore.FieldValue.serverTimestamp(),
            removedBy: decodedToken.uid,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedBy: decodedToken.uid,
          });
          transaction.update(roomRef, {
            participantCount: admin.firestore.FieldValue.increment(-1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }

        if (command.value.action === 'close-room') {
          transaction.update(roomRef, {
            status: 'closed',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedBy: decodedToken.uid,
          });
        }

        transaction.set(eventRef, eventPayload);

        return command;
      });

      if (!result.ok) {
        response.status(result.status).json({ error: result.error });
        return;
      }

      response.json({ ok: true, action: result.value.action });
    } catch (error) {
      console.error('Failed to execute room command:', error);
      response.status(500).json({ error: 'Failed to execute room command.' });
    }
  },
);

exports.adminDashboard = onRequest(
  {
    cors: true,
    invoker: 'public',
    region: 'us-central1',
  },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Use POST.' });
      return;
    }

    const idToken = extractBearerToken(request.headers);

    if (!idToken) {
      response.status(401).json({ error: 'Authentication is required.' });
      return;
    }

    let decodedToken;

    try {
      decodedToken = await admin.auth().verifyIdToken(idToken);
    } catch (error) {
      console.error('Invalid Firebase ID token:', error);
      response.status(401).json({ error: 'Authentication is invalid.' });
      return;
    }

    const dashboardRequest = resolveAdminDashboardRequest({
      body: request.body,
      decodedToken,
    });

    if (!dashboardRequest.ok) {
      response.status(dashboardRequest.status).json({ error: dashboardRequest.error });
      return;
    }

    if (dashboardRequest.value.action === 'overview') {
      try {
        const overview = await resolveAdminOverview(admin.firestore());
        response.json({
          ok: true,
          action: dashboardRequest.value.action,
          overview,
        });
      } catch (error) {
        console.error('Failed to resolve admin overview:', error);
        response.status(500).json({ error: 'Failed to resolve admin overview.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'users') {
      try {
        const users = await resolveAdminUsers(admin.firestore(), request.body);
        response.json({
          ok: true,
          action: dashboardRequest.value.action,
          users,
        });
      } catch (error) {
        console.error('Failed to resolve admin users:', error);
        response.status(500).json({ error: 'Failed to resolve admin users.' });
      }
      return;
    }

    if (dashboardRequest.value.action === 'user-note') {
      const note = normalizeAdminUserNote(request.body);

      if (!note.ok) {
        response.status(note.status).json({ error: note.error });
        return;
      }

      try {
        const noteId = await createAdminUserNote(admin.firestore(), decodedToken, note.value);
        response.json({
          ok: true,
          action: dashboardRequest.value.action,
          noteId,
        });
      } catch (error) {
        console.error('Failed to create admin user note:', error);
        response.status(500).json({ error: 'Failed to create admin user note.' });
      }
      return;
    }

    response.json({
      ok: true,
      action: dashboardRequest.value.action,
      admin: true,
      email: dashboardRequest.value.email,
      uid: dashboardRequest.value.uid,
    });
  },
);

async function resolveAdminOverview(db) {
  const [
    usersSnapshot,
    activeRoomsSnapshot,
    gameRoomsSnapshot,
    privateRoomsSnapshot,
    moderationEventsSnapshot,
    reportsSnapshot,
    auditEventsSnapshot,
  ] = await Promise.all([
    getCollectionCount(db.collection('users')),
    getCollectionCount(db.collection('rooms').where('status', '==', 'active')),
    getCollectionCount(db.collection('rooms').where('type', '==', 'game')),
    getCollectionCount(db.collection('rooms').where('visibility', '==', 'private')),
    getCollectionGroupCount(db.collectionGroup('moderationEvents')),
    getCollectionCount(db.collection('reports')),
    getCollectionCount(db.collection('adminAuditEvents')),
  ]);

  return createAdminOverviewPayload({
    activeRooms: activeRoomsSnapshot,
    adminAuditEvents: auditEventsSnapshot,
    gameRooms: gameRoomsSnapshot,
    moderationEvents: moderationEventsSnapshot,
    privateRooms: privateRoomsSnapshot,
    reports: reportsSnapshot,
    users: usersSnapshot,
  });
}

async function resolveAdminUsers(db, body) {
  const query = normalizeAdminUsersQuery(body);
  const snapshot = await db
    .collection('users')
    .orderBy('displayName')
    .limit(query.readLimit)
    .get();
  const rows = snapshot.docs
    .map((doc) => mapAdminUserProfileDocument(doc.id, doc.data()))
    .filter(Boolean);

  return filterAdminUserRows(rows, query.search).slice(0, query.limit);
}

async function createAdminUserNote(db, decodedToken, note) {
  const noteRef = db.collection('adminUserNotes').doc();

  await noteRef.set({
    actorEmail: decodedToken.email || '',
    actorUid: decodedToken.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    note: note.note,
    targetUid: note.targetUid,
  });

  return noteRef.id;
}

async function getCollectionCount(query) {
  const snapshot = await query.count().get();
  return snapshot.data().count;
}

async function getCollectionGroupCount(query) {
  const snapshot = await query.count().get();
  return snapshot.data().count;
}
