import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { cleanupExpiredRoomChatMessages, executeRoomChatCommand } = require('./roomChatService');

describe('roomChatService', () => {
  it('creates an idempotent, server-authoritative message and rate record', async () => {
    const db = createFakeDb();
    seedRoom(db);
    const options = {
      body: {
        action: 'send-message',
        requestId: 'chat_request_000001',
        roomId: 'room-1',
        text: '  مرحبا   بالجميع  ',
      },
      clock: fakeClock,
      db,
      decodedToken: { uid: 'member-1' },
      fieldValue: fakeFieldValue,
    };

    expect(await executeRoomChatCommand(options)).toMatchObject({
      ok: true,
      replayed: false,
      result: { messageId: 'chat_chat_request_000001' },
    });
    expect(await executeRoomChatCommand(options)).toMatchObject({
      ok: true,
      replayed: true,
    });
    expect(db.data.get('rooms/room-1/messages/chat_chat_request_000001')).toMatchObject({
      kind: 'chat',
      senderDisplayName: 'Member',
      senderUid: 'member-1',
      status: 'active',
      text: 'مرحبا بالجميع',
    });
    expect(db.data.get('rooms/room-1/chatRateLimits/member-1')).toMatchObject({
      messageCount: 1,
    });
  });

  it('soft-deletes an own message and retains a moderation record', async () => {
    const db = createFakeDb();
    seedRoom(db);
    db.data.set('rooms/room-1/messages/message-1', {
      id: 'message-1',
      revision: 2,
      roomId: 'room-1',
      senderUid: 'member-1',
      status: 'active',
      text: 'remove me',
    });

    const result = await executeRoomChatCommand({
      body: {
        action: 'delete-message',
        messageId: 'message-1',
        requestId: 'chat_delete_000001',
        roomId: 'room-1',
      },
      clock: fakeClock,
      db,
      decodedToken: { uid: 'member-1' },
      fieldValue: fakeFieldValue,
    });

    expect(result).toMatchObject({ ok: true });
    expect(db.data.get('rooms/room-1/messages/message-1')).toMatchObject({
      deletedBy: 'member-1',
      revision: 3,
      status: 'deleted',
      text: '',
    });
    expect(db.data.get('rooms/room-1/moderationEvents/chat_chat_delete_000001')).toMatchObject({
      action: 'delete-message',
      targetUid: 'member-1',
    });
  });

  it('creates a block and dissolves existing social state', async () => {
    const db = createFakeDb();
    seedRoom(db);
    seedTarget(db);
    const { createFriendshipId } = require('./socialFriendsCore');
    const { createDirectConversationId } = require('./directChatCore');
    const relationshipId = createFriendshipId('member-1', 'target-1');
    const conversationId = createDirectConversationId('member-1', 'target-1');
    db.data.set('publicProfiles/member-1', {
      ...db.data.get('publicProfiles/member-1'),
      friendCount: 1,
      followerCount: 1,
      followingCount: 1,
    });
    db.data.set('publicProfiles/target-1', {
      ...db.data.get('publicProfiles/target-1'),
      friendCount: 1,
      followerCount: 1,
      followingCount: 1,
    });
    db.data.set(`friendships/${relationshipId}`, { memberUids: ['member-1', 'target-1'] });
    db.data.set(`friendRequests/${relationshipId}`, { status: 'pending' });
    db.data.set('following/member-1/items/target-1', { targetUid: 'target-1' });
    db.data.set('followers/target-1/items/member-1', { followerUid: 'member-1' });
    db.data.set('following/target-1/items/member-1', { targetUid: 'member-1' });
    db.data.set('followers/member-1/items/target-1', { followerUid: 'target-1' });
    db.data.set(`directConversations/${conversationId}`, { requestState: 'pending' });
    db.data.set(`directMessageRequests/${conversationId}`, { status: 'pending' });

    expect(await executeRoomChatCommand({
      body: {
        action: 'block-user',
        requestId: 'chat_block_0000001',
        roomId: 'room-1',
        targetUid: 'target-1',
      },
      clock: fakeClock,
      db,
      decodedToken: { uid: 'member-1' },
      fieldValue: fakeFieldValue,
    })).toMatchObject({ ok: true });

    expect(db.data.get('blocks/member-1/blocked/target-1')).toMatchObject({
      blockerUid: 'member-1',
      blockedUid: 'target-1',
      source: 'voice-room',
    });
    expect(db.data.has(`friendships/${relationshipId}`)).toBe(false);
    expect(db.data.has(`friendRequests/${relationshipId}`)).toBe(false);
    expect(db.data.has('following/member-1/items/target-1')).toBe(false);
    expect(db.data.has('followers/target-1/items/member-1')).toBe(false);
    expect(db.data.has('following/target-1/items/member-1')).toBe(false);
    expect(db.data.has('followers/member-1/items/target-1')).toBe(false);
    expect(db.data.get('publicProfiles/member-1')).toMatchObject({
      friendCount: 0,
      followerCount: 0,
      followingCount: 0,
    });
    expect(db.data.get('publicProfiles/target-1')).toMatchObject({
      friendCount: 0,
      followerCount: 0,
      followingCount: 0,
    });
    expect(db.data.get(`directMessageRequests/${conversationId}`)).toMatchObject({
      blockedByUid: 'member-1',
      status: 'blocked',
    });
    expect(db.data.get(`directConversations/${conversationId}`)).toMatchObject({ requestState: 'blocked' });
  });

  it('snapshots reported message evidence and places the message on hold', async () => {
    const db = createFakeDb();
    seedRoom(db);
    seedTarget(db);
    db.data.set('rooms/room-1/messages/message-2', {
      createdAt: 1_000,
      id: 'message-2',
      kind: 'chat',
      revision: 1,
      roomId: 'room-1',
      senderUid: 'target-1',
      status: 'active',
      text: 'reported content',
    });

    expect(await executeRoomChatCommand({
      body: {
        action: 'report-content',
        category: 'harassment',
        details: 'Repeated abuse',
        messageId: 'message-2',
        requestId: 'chat_report_000001',
        roomId: 'room-1',
        subjectType: 'message',
      },
      clock: fakeClock,
      db,
      decodedToken: { uid: 'member-1' },
      fieldValue: fakeFieldValue,
    })).toMatchObject({ ok: true });

    expect(db.data.get('reports/room_chat_report_000001')).toMatchObject({
      category: 'harassment',
      messageId: 'message-2',
      subjectType: 'message',
      targetUid: 'target-1',
      messageSnapshot: {
        senderUid: 'target-1',
        text: 'reported content',
      },
    });
    expect(db.data.get('rooms/room-1/messages/message-2')).toMatchObject({
      evidenceHold: true,
    });
  });

  it('fails closed when the corresponding production flag is absent', async () => {
    const db = createFakeDb();
    seedRoom(db);
    db.data.set('appConfig/voiceRoomFeatures', {});

    expect(await executeRoomChatCommand({
      body: {
        action: 'send-message',
        requestId: 'chat_request_000002',
        roomId: 'room-1',
        text: 'hello',
      },
      clock: fakeClock,
      db,
      decodedToken: { uid: 'member-1' },
      fieldValue: fakeFieldValue,
    })).toMatchObject({ code: 'FEATURE_DISABLED', ok: false });
  });

  it('deletes only messages selected by the retention query', async () => {
    const deleted = [];
    const documents = [
      { ref: { path: 'rooms/room-1/messages/expired-1' } },
      { ref: { path: 'rooms/room-2/messages/expired-2' } },
    ];
    const query = {
      where: () => query,
      orderBy: () => query,
      limit: () => query,
      get: async () => ({ docs: documents, empty: false, size: documents.length }),
    };
    const db = {
      batch: () => ({
        commit: async () => undefined,
        delete: (reference) => deleted.push(reference.path),
      }),
      collectionGroup: () => query,
    };

    await expect(cleanupExpiredRoomChatMessages({
      clock: fakeClock,
      db,
    })).resolves.toEqual({ deleted: 2, scanned: 2 });
    expect(deleted).toEqual([
      'rooms/room-1/messages/expired-1',
      'rooms/room-2/messages/expired-2',
    ]);
  });
});

const fakeFieldValue = {
  serverTimestamp: () => 'SERVER_TIMESTAMP',
};

const fakeClock = {
  nowMillis: () => 10_000,
  timestampFromMillis: (value) => value,
};

function seedRoom(db) {
  db.data.set('appConfig/voiceRoomFeatures', {
    voice_room_chat: true,
    voice_room_safety: true,
  });
  db.data.set('appConfig/voiceRoomModeration', { keywordTerms: ['blocked phrase'] });
  db.data.set('users/member-1', { uid: 'member-1' });
  db.data.set('publicProfiles/member-1', {
    avatarLabel: 'M',
    displayName: 'Member',
    moderationStatus: 'active',
    publicId: '10001',
    uid: 'member-1',
  });
  db.data.set('rooms/room-1', {
    availability: 'active',
    chatMode: 'everyone',
    countryCode: 'IQ',
    keywordFilterMode: 'standard',
    ownerUid: 'owner-1',
    slowModeSeconds: 0,
    status: 'active',
  });
  db.data.set('rooms/room-1/members/member-1', {
    authorityRole: 'member',
    status: 'active',
    uid: 'member-1',
  });
}

function seedTarget(db) {
  db.data.set('publicProfiles/target-1', {
    moderationStatus: 'active',
    uid: 'target-1',
  });
  db.data.set('rooms/room-1/members/target-1', {
    authorityRole: 'member',
    status: 'active',
    uid: 'target-1',
  });
}

function createFakeDb() {
  const data = new Map();
  const snapshot = (reference) => ({
    exists: data.has(reference.path),
    data: () => data.get(reference.path),
    ref: reference,
  });
  const collection = (path) => ({
    doc(id) { return ref(`${path}/${id}`); },
  });
  const ref = (path) => ({
    path,
    collection(name) { return collection(`${path}/${name}`); },
  });
  const transaction = {
    get: async (reference) => snapshot(reference),
    create(reference, value) {
      if (data.has(reference.path)) throw new Error(`already exists: ${reference.path}`);
      data.set(reference.path, value);
    },
    delete(reference) {
      data.delete(reference.path);
    },
    set(reference, value, options) {
      data.set(
        reference.path,
        options?.merge ? { ...(data.get(reference.path) || {}), ...value } : value,
      );
    },
    update(reference, value) {
      data.set(reference.path, { ...(data.get(reference.path) || {}), ...value });
    },
  };
  return {
    data,
    doc: ref,
    runTransaction: (callback) => callback(transaction),
  };
}
