import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createDirectConversationId } = require('./directChatCore');
const { createFriendshipId } = require('./socialFriendsCore');
const sharp = require('sharp');
const {
  cleanupDirectChatCommands,
  executeDirectChatCommand,
  expirePendingDirectMessageRequests,
} = require('./directChatService');

describe('directChatService', () => {
  it('creates one deterministic friend conversation and exactly-once messages under concurrency', async () => {
    const db = createFakeDb();
    seedPair(db, { friends: true });
    const first = execute(db, 'user-1', directMessage('user-2', 'friend_send_000001', 'First'));
    const second = execute(db, 'user-2', directMessage('user-1', 'friend_send_000002', 'Second'));
    const [left, right] = await Promise.all([first, second]);
    expect(left).toMatchObject({ ok: true, replayed: false, result: { sequence: 1 } });
    expect(right).toMatchObject({ ok: true, replayed: false, result: { sequence: 2 } });
    const conversationId = createDirectConversationId('user-1', 'user-2');
    expect(db.read(`directConversations/${conversationId}`)).toMatchObject({
      lastSequence: 2,
      memberUids: ['user-1', 'user-2'],
      requestState: 'accepted',
    });
    expect(db.paths(`directConversations/${conversationId}/messages/`)).toHaveLength(2);
    expect(db.read('directChatInboxSummaries/user-1')).toMatchObject({ totalUnreadCount: 1, uid: 'user-1' });
    expect(db.read('directChatInboxSummaries/user-2')).toMatchObject({ totalUnreadCount: 1, uid: 'user-2' });

    const replay = await execute(db, 'user-1', directMessage('user-2', 'friend_send_000001', 'First'));
    expect(replay).toMatchObject({ ok: true, replayed: true, result: left.result });
    const conflict = await execute(db, 'user-1', directMessage('user-2', 'friend_send_000001', 'Changed'));
    expect(conflict).toMatchObject({ code: 'REQUEST_CONFLICT', ok: false });
    expect(db.paths(`directConversations/${conversationId}/messages/`)).toHaveLength(2);
  });

  it('records status commands with the same replay and conflict contract', async () => {
    const db = createFakeDb();
    seedPair(db, { friends: true });
    const body = targetCommand('get-direct-chat-status', 'user-2', 'chat_status_00001');
    await expect(execute(db, 'user-1', body)).resolves.toMatchObject({
      ok: true,
      replayed: false,
      result: { canSendDirectly: true, isFriend: true },
    });
    await expect(execute(db, 'user-1', body)).resolves.toMatchObject({ ok: true, replayed: true });
    db.write('publicProfiles/user-3', { displayName: 'Three', moderationStatus: 'active', uid: 'user-3' });
    await expect(execute(db, 'user-1', targetCommand('get-direct-chat-status', 'user-3', 'chat_status_00001')))
      .resolves.toMatchObject({ code: 'REQUEST_CONFLICT' });
  });

  it('uses one non-friend request thread, accepts it, and continues after friendship removal', async () => {
    const db = createFakeDb();
    seedPair(db);
    await expect(execute(db, 'user-1', directMessage('user-2', 'direct_send_000001', 'No request')))
      .resolves.toMatchObject({ code: 'NOT_FRIEND', ok: false });

    const pending = await execute(db, 'user-1', messageRequest('user-2', 'request_send_00001', 'Hello'));
    expect(pending).toMatchObject({ ok: true, result: { requestState: 'pending', sequence: 1 } });
    const duplicate = await execute(db, 'user-1', messageRequest('user-2', 'request_send_00002', 'Again'));
    expect(duplicate).toMatchObject({ code: 'REQUEST_PENDING', ok: false });

    const accepted = await execute(db, 'user-2', targetCommand('accept-message-request', 'user-1', 'request_accept_001'));
    expect(accepted).toMatchObject({ ok: true, result: { requestState: 'accepted', sequence: 2 } });
    const conversationId = createDirectConversationId('user-1', 'user-2');
    expect(db.read(`directMessageRequests/${conversationId}`)).toMatchObject({ status: 'accepted' });

    db.delete(`friendships/${createFriendshipId('user-1', 'user-2')}`);
    const continued = await execute(db, 'user-1', directMessage('user-2', 'direct_send_000002', 'Still accepted'));
    expect(continued).toMatchObject({ ok: true, result: { requestState: 'accepted', sequence: 3 } });
  });

  it('promotes a pending request in place when the pair becomes friends', async () => {
    const db = createFakeDb();
    seedPair(db);
    await execute(db, 'user-1', messageRequest('user-2', 'request_send_00007', 'Pending'));
    const conversationId = createDirectConversationId('user-1', 'user-2');
    db.write(`friendships/${createFriendshipId('user-1', 'user-2')}`, { memberUids: ['user-1', 'user-2'] });
    const promoted = await execute(db, 'user-2', directMessage('user-1', 'friend_send_000007', 'Now friends'));
    expect(promoted).toMatchObject({ ok: true, result: { requestState: 'accepted', sequence: 3 } });
    expect(db.read(`directMessageRequests/${conversationId}`)).toMatchObject({ status: 'accepted' });
    expect(db.read(`directConversations/${conversationId}`)).toMatchObject({ requestState: 'accepted' });
    expect(db.paths('directConversations/')).toContain(`directConversations/${conversationId}`);
    expect(db.paths('directConversations/').filter((path) => path.split('/').length === 2)).toHaveLength(1);
  });

  it('enforces recipient-only decisions, expiry, rejection cooldown, blocks, and restrictions', async () => {
    const db = createFakeDb();
    const clock = seedPair(db);
    await execute(db, 'user-1', messageRequest('user-2', 'request_send_00003', 'Hello'));
    await expect(execute(db, 'user-1', targetCommand('accept-message-request', 'user-2', 'request_accept_002')))
      .resolves.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(execute(db, 'user-2', targetCommand('reject-message-request', 'user-1', 'request_reject_001')))
      .resolves.toMatchObject({ ok: true, result: { requestState: 'rejected' } });
    await expect(execute(db, 'user-1', messageRequest('user-2', 'request_send_00004', 'Too soon')))
      .resolves.toMatchObject({ code: 'REQUEST_COOLDOWN' });

    clock.now += 31 * 24 * 60 * 60 * 1_000;
    await expect(execute(db, 'user-1', messageRequest('user-2', 'request_send_00005', 'After cooldown')))
      .resolves.toMatchObject({ ok: true, result: { requestState: 'pending' } });
    db.write('blocks/user-2/blocked/user-1', { blockerUid: 'user-2' });
    await expect(execute(db, 'user-1', directMessage('user-2', 'direct_send_000003', 'Blocked')))
      .resolves.toMatchObject({ code: 'BLOCKED' });
    db.delete('blocks/user-2/blocked/user-1');
    db.write('directChatRestrictions/user-1', {
      actorUid: 'platform-owner',
      reason: 'Safety',
      startsAt: clock.now - 1,
      state: 'restricted',
      uid: 'user-1',
    });
    await expect(execute(db, 'user-1', directMessage('user-2', 'direct_send_000004', 'Restricted')))
      .resolves.toMatchObject({ code: 'ACCOUNT_RESTRICTED' });
  });

  it('validates replies, supports five-minute unsend, and records delete-for-me clear markers', async () => {
    const db = createFakeDb();
    const clock = seedPair(db, { friends: true });
    const first = await execute(db, 'user-1', directMessage('user-2', 'friend_send_000003', 'Original'));
    const messageId = first.result.messageId;
    await expect(execute(db, 'user-2', directMessage('user-1', 'friend_send_000004', 'Reply', messageId)))
      .resolves.toMatchObject({ ok: true, result: { sequence: 2 } });
    await expect(execute(db, 'user-2', directMessage('user-1', 'friend_send_000005', 'Bad reply', 'dmm_missing_message_00001')))
      .resolves.toMatchObject({ code: 'REPLY_TARGET_UNAVAILABLE' });

    const unsent = await execute(db, 'user-1', unsend('user-2', 'message_unsend_001', messageId));
    expect(unsent).toMatchObject({ ok: true, result: { visibilityState: 'unsent' } });
    const conversationId = createDirectConversationId('user-1', 'user-2');
    expect(db.read(`directConversations/${conversationId}/messages/${messageId}`)).toMatchObject({ text: '', visibilityState: 'unsent' });

    const third = await execute(db, 'user-1', directMessage('user-2', 'friend_send_000006', 'Late'));
    clock.now += (5 * 60 * 1_000) + 1;
    await expect(execute(db, 'user-1', unsend('user-2', 'message_unsend_002', third.result.messageId)))
      .resolves.toMatchObject({ code: 'UNSEND_WINDOW_EXPIRED' });
    const cleared = await execute(db, 'user-1', targetCommand('delete-conversation-for-me', 'user-2', 'conversation_clear_1'));
    expect(cleared).toMatchObject({ ok: true, result: { clearedThroughSequence: 3 } });
    expect(db.read(`directConversationMembers/user-1/items/${conversationId}`)).toMatchObject({
      archived: true,
      clearedThroughSequence: 3,
      ownerUid: 'user-1',
    });
  });

  it('filters blocked text before creating messages and keeps all staff roles policy-neutral', async () => {
    const db = createFakeDb();
    seedPair(db, { friends: true });
    db.write('appConfig/voiceRoomModeration', { keywordTerms: ['forbidden phrase'] });
    db.write('blocks/user-2/blocked/user-1', { blockerUid: 'user-2' });
    await expect(execute(db, 'user-1', directMessage('user-2', 'staff_bypass_00001', 'hello'), { platformOwner: true, role: 'super-moderator' }))
      .resolves.toMatchObject({ code: 'BLOCKED' });
    db.delete('blocks/user-2/blocked/user-1');
    await expect(execute(db, 'user-1', directMessage('user-2', 'filtered_send_0001', 'a forbidden phrase')))
      .resolves.toMatchObject({ code: 'CONTENT_FILTERED' });
    const conversationId = createDirectConversationId('user-1', 'user-2');
    expect(db.paths(`directConversations/${conversationId}/messages/`)).toHaveLength(0);
  });

  it('sends only an active owned and available immutable sticker', async () => {
    const db = createFakeDb();
    seedPair(db, { friends: true });
    const stickerAsset = { assetId: 'ruby-reaction', assetVersionId: 'v1-123456789abc' };
    db.write('storeCatalog/ruby-sticker', { availability: 'available', category: 'stickers', itemId: 'ruby-sticker', stickerAsset });
    db.write('storeOwnerships/user-1/items/ruby-sticker', { category: 'stickers', itemId: 'ruby-sticker', state: 'active', uid: 'user-1' });
    db.write('cosmeticAssets/ruby-reaction', { assetId: 'ruby-reaction', moderationStatus: 'approved', publicationStatus: 'published', publishedVersionId: 'v1-123456789abc', renderingEnabled: true });
    db.write('cosmeticAssets/ruby-reaction/versions/v1-123456789abc', { assetId: 'ruby-reaction', assetVersionId: 'v1-123456789abc', category: 'room-reaction', format: 'png' });
    const sent = await execute(db, 'user-1', {
      action: 'send-direct-message', payload: { kind: 'sticker', stickerItemId: 'ruby-sticker', targetUid: 'user-2' }, requestId: 'sticker_send_00001', version: 1,
    });
    expect(sent).toMatchObject({ ok: true, result: { sequence: 1 } });
    const conversationId = createDirectConversationId('user-1', 'user-2');
    expect(db.read(`directConversations/${conversationId}/messages/${sent.result.messageId}`)).toMatchObject({ kind: 'sticker', sticker: { ...stickerAsset, itemId: 'ruby-sticker' }, text: '' });
    db.write('storeOwnerships/user-1/items/ruby-sticker', { category: 'stickers', itemId: 'ruby-sticker', state: 'expired', uid: 'user-1' });
    await expect(execute(db, 'user-1', {
      action: 'send-direct-message', payload: { kind: 'sticker', stickerItemId: 'ruby-sticker', targetUid: 'user-2' }, requestId: 'sticker_send_00002', version: 1,
    })).resolves.toMatchObject({ code: 'STICKER_UNAVAILABLE', ok: false });
  });

  it('authorizes, validates, sanitizes, and atomically commits protected image uploads', async () => {
    const db = createFakeDb();
    const bucket = createFakeBucket();
    seedPair(db, { friends: true });
    db.write('appConfig/socialFeatures', { directMessageMedia: true, directMessageRequests: true, directMessages: true });
    const source = await sharp({ create: { background: '#D41836', channels: 4, height: 2, width: 2 } }).png().toBuffer();
    const authorized = await execute(db, 'user-1', {
      action: 'create-direct-chat-upload', payload: { contentType: 'image/png', kind: 'image', sizeBytes: source.length, targetUid: 'user-2' }, requestId: 'media_create_000001', version: 1,
    }, {}, { bucket, safetyAdapter: { inspectImage: async () => ({ ok: true, provider: 'test' }) } });
    expect(authorized).toMatchObject({ ok: true, result: { contentType: 'image/png', kind: 'image' } });
    bucket.seed(authorized.result.storagePath, source, {
      contentType: 'image/png', metadata: { conversationId: authorized.result.conversationId, kind: 'image', uploaderUid: 'user-1', uploadId: authorized.result.uploadId }, size: source.length,
    });
    const finalized = await execute(db, 'user-1', {
      action: 'finalize-direct-chat-upload', payload: { targetUid: 'user-2', uploadId: authorized.result.uploadId }, requestId: 'media_finish_00001', version: 1,
    }, {}, { bucket, safetyAdapter: { inspectImage: async () => ({ ok: true, provider: 'test' }) } });
    expect(finalized).toMatchObject({ ok: true, result: { sequence: 1 } });
    const message = db.read(`directConversations/${authorized.result.conversationId}/messages/${finalized.result.messageId}`);
    expect(message).toMatchObject({ attachmentId: authorized.result.uploadId, kind: 'image', mediaContentType: 'image/webp', mediaHeight: 2, mediaWidth: 2, text: '' });
    expect(bucket.read(authorized.result.storagePath)).toBeUndefined();
    expect(bucket.read(message.mediaPath)?.metadata.contentType).toBe('image/webp');
  });

  it('rechecks blocking after upload and never commits or leaves a processed derivative', async () => {
    const db = createFakeDb();
    const bucket = createFakeBucket();
    seedPair(db, { friends: true });
    db.write('appConfig/socialFeatures', { directMessageMedia: true, directMessageRequests: true, directMessages: true });
    const source = await sharp({ create: { background: '#D41836', channels: 4, height: 2, width: 2 } }).png().toBuffer();
    const authorized = await execute(db, 'user-1', {
      action: 'create-direct-chat-upload', payload: { contentType: 'image/png', kind: 'image', sizeBytes: source.length, targetUid: 'user-2' }, requestId: 'media_create_000002', version: 1,
    }, {}, { bucket, safetyAdapter: { inspectImage: async () => ({ ok: true, provider: 'test' }) } });
    bucket.seed(authorized.result.storagePath, source, { contentType: 'image/png', metadata: { conversationId: authorized.result.conversationId, kind: 'image', uploaderUid: 'user-1', uploadId: authorized.result.uploadId }, size: source.length });
    db.write('blocks/user-2/blocked/user-1', { blockerUid: 'user-2' });
    const denied = await execute(db, 'user-1', {
      action: 'finalize-direct-chat-upload', payload: { targetUid: 'user-2', uploadId: authorized.result.uploadId }, requestId: 'media_finish_00002', version: 1,
    }, {}, { bucket, safetyAdapter: { inspectImage: async () => ({ ok: true, provider: 'test' }) } });
    expect(denied).toMatchObject({ code: 'BLOCKED', ok: false });
    expect(db.paths(`directConversations/${authorized.result.conversationId}/messages/`)).toHaveLength(0);
    expect(bucket.paths('direct-chat-media/')).toHaveLength(0);
  });

  it('keeps inbox projections and unread state convergent across devices', async () => {
    const db = createFakeDb();
    seedPair(db, { friends: true });
    await execute(db, 'user-1', directMessage('user-2', 'projection_send_001', 'One'));
    await execute(db, 'user-2', directMessage('user-1', 'projection_send_002', 'Two'));
    await execute(db, 'user-1', directMessage('user-2', 'projection_send_003', 'Three'));
    const conversationId = createDirectConversationId('user-1', 'user-2');
    expect(db.read(`directConversationMembers/user-1/items/${conversationId}`)).toMatchObject({ lastSequence: 3, unreadCount: 1 });
    expect(db.read(`directConversationMembers/user-2/items/${conversationId}`)).toMatchObject({ lastSequence: 3, unreadCount: 2 });

    await expect(execute(db, 'user-2', markRead('user-1', 'mark_read_device_01', 3)))
      .resolves.toMatchObject({ ok: true, result: { changed: true, lastReadSequence: 3, unreadCount: 0 } });
    expect(db.read('directChatInboxSummaries/user-2')).toMatchObject({ totalUnreadCount: 0 });
    expect(db.read(`directConversations/${conversationId}/receipts/user-2`)).toMatchObject({
      conversationId,
      lastReadSequence: 3,
      uid: 'user-2',
    });
    await expect(execute(db, 'user-2', markRead('user-1', 'mark_read_device_02', 2)))
      .resolves.toMatchObject({ ok: true, result: { changed: false, lastReadSequence: 3, unreadCount: 0 } });
    await expect(execute(db, 'user-1', markRead('user-2', 'mark_read_partial_1', 2)))
      .resolves.toMatchObject({ code: 'READ_SEQUENCE_INVALID' });

    await expect(execute(db, 'user-1', toggleCommand('set-direct-chat-mute', 'user-2', 'mute_thread_00001', 'muted', true)))
      .resolves.toMatchObject({ ok: true, result: { muted: true } });
    await expect(execute(db, 'user-1', toggleCommand('set-direct-chat-archive', 'user-2', 'archive_thread_01', 'archived', true)))
      .resolves.toMatchObject({ ok: true, result: { archived: true } });
    expect(db.read(`directConversationMembers/user-1/items/${conversationId}`)).toMatchObject({ archived: true, muted: true });
    await execute(db, 'user-2', directMessage('user-1', 'projection_send_004', 'Returns to inbox'));
    expect(db.read(`directConversationMembers/user-1/items/${conversationId}`)).toMatchObject({ archived: false, muted: true, unreadCount: 2 });
  });

  it('paginates a 10,000-message thread with bounded opaque cursor pages', async () => {
    const db = createFakeDb();
    seedPair(db, { friends: true });
    const conversationId = createDirectConversationId('user-1', 'user-2');
    db.write(`directConversations/${conversationId}`, {
      conversationId,
      lastMessageId: 'dmm_seed_10000',
      lastMessageKind: 'text',
      lastMessagePreview: '10000',
      lastMessageSenderUid: 'user-2',
      lastSequence: 10_000,
      lifecycleState: 'active',
      memberUids: ['user-1', 'user-2'],
      requestState: 'accepted',
    });
    db.write(`directConversationMembers/user-1/items/${conversationId}`, {
      archived: false,
      clearedThroughSequence: 0,
      conversationId,
      lastReadSequence: 0,
      ownerUid: 'user-1',
      peerUid: 'user-2',
      unreadCount: 10_000,
      updatedAt: db.clock.now,
    });
    for (let sequence = 1; sequence <= 10_000; sequence += 1) {
      const id = `dmm_seed_${String(sequence).padStart(5, '0')}`;
      db.write(`directConversations/${conversationId}/messages/${id}`, {
        conversationId,
        createdAt: sequence,
        id,
        kind: 'text',
        senderUid: 'user-2',
        sequence,
        text: String(sequence),
        visibilityState: 'visible',
      });
    }
    const first = await execute(db, 'user-1', threadPage('user-2', 'thread_page_00001'));
    expect(first).toMatchObject({ ok: true, result: { hasMore: true } });
    expect(first.result.messages).toHaveLength(40);
    expect(first.result.messages[0].sequence).toBe(9_961);
    expect(first.result.messages.at(-1).sequence).toBe(10_000);
    expect(first.result.nextCursor).toMatch(/^[A-Za-z0-9_-]{16,512}$/);
    const second = await execute(db, 'user-1', threadPage('user-2', 'thread_page_00002', first.result.nextCursor));
    expect(second.result.messages).toHaveLength(40);
    expect(second.result.messages[0].sequence).toBe(9_921);
    expect(second.result.messages.at(-1).sequence).toBe(9_960);
    expect(db.queryLimits.slice(-2)).toEqual([41, 41]);
  });

  it('paginates inbox projections and rejects a cursor reused by another account', async () => {
    const db = createFakeDb();
    seedPair(db);
    for (let index = 0; index < 4; index += 1) {
      const peerUid = `peer-${index}`;
      const conversationId = createDirectConversationId('user-1', peerUid);
      db.write(`directConversationMembers/user-1/items/${conversationId}`, {
        archived: false,
        clearedThroughSequence: 0,
        conversationId,
        lastReadSequence: 0,
        lastSequence: index + 1,
        ownerUid: 'user-1',
        peerUid,
        requestState: 'accepted',
        unreadCount: index,
        updatedAt: db.clock.now - index,
      });
    }
    db.write('directChatInboxSummaries/user-1', { totalUnreadCount: 6, uid: 'user-1', updatedAt: db.clock.now });
    const first = await execute(db, 'user-1', inboxPage('inbox_page_00001', '', 2));
    expect(first.result.items).toHaveLength(2);
    expect(first.result.hasMore).toBe(true);
    expect(first.result.totalUnreadCount).toBe(6);
    const second = await execute(db, 'user-1', inboxPage('inbox_page_00002', first.result.nextCursor, 2));
    expect(second.result.items).toHaveLength(2);
    db.write('publicProfiles/user-3', { moderationStatus: 'active', uid: 'user-3' });
    await expect(execute(db, 'user-3', inboxPage('inbox_page_00003', first.result.nextCursor, 2)))
      .resolves.toMatchObject({ code: 'CURSOR_INVALID' });
  });

  it('expires pending requests and deletes only bounded expired direct-chat commands', async () => {
    const db = createFakeDb();
    const clock = seedPair(db);
    await execute(db, 'user-1', messageRequest('user-2', 'request_send_00006', 'Will expire'));
    clock.now += 31 * 24 * 60 * 60 * 1_000;
    await expect(expirePendingDirectMessageRequests({ clock, db, limit: 20 }))
      .resolves.toEqual({ expired: 1, scanned: 1 });
    const conversationId = createDirectConversationId('user-1', 'user-2');
    expect(db.read(`directMessageRequests/${conversationId}`)).toMatchObject({ status: 'expired' });
    expect(db.read(`directConversations/${conversationId}`)).toMatchObject({ requestState: 'expired' });

    db.write('directChatCommands/user-1/requests/expired_command_001', {
      commandKind: 'direct-chat',
      purgeAfter: clock.now - 1,
    });
    db.write('directChatCommands/user-1/requests/future_command_001', {
      commandKind: 'direct-chat',
      purgeAfter: clock.now + 1,
    });
    await expect(cleanupDirectChatCommands({ clock, db, limit: 20 }))
      .resolves.toEqual({ deleted: 2, scanned: 2 });
    expect(db.read('directChatCommands/user-1/requests/expired_command_001')).toBeUndefined();
    expect(db.read('directChatCommands/user-1/requests/future_command_001')).toBeDefined();
  });
});

function directMessage(targetUid, requestId, text, replyToMessageId = '') {
  return {
    action: 'send-direct-message',
    payload: { kind: 'text', ...(replyToMessageId ? { replyToMessageId } : {}), targetUid, text },
    requestId,
    version: 1,
  };
}

function messageRequest(targetUid, requestId, text) {
  return { action: 'send-message-request', payload: { targetUid, text }, requestId, version: 1 };
}

function targetCommand(action, targetUid, requestId) {
  return { action, payload: { targetUid }, requestId, version: 1 };
}

function unsend(targetUid, requestId, messageId) {
  return { action: 'unsend-direct-message', payload: { messageId, targetUid }, requestId, version: 1 };
}

function markRead(targetUid, requestId, throughSequence) {
  return { action: 'mark-direct-chat-read', payload: { targetUid, throughSequence }, requestId, version: 1 };
}

function toggleCommand(action, targetUid, requestId, field, value) {
  return { action, payload: { [field]: value, targetUid }, requestId, version: 1 };
}

function threadPage(targetUid, requestId, cursor = '') {
  return { action: 'get-direct-chat-thread', payload: { ...(cursor ? { cursor } : {}), targetUid }, requestId, version: 1 };
}

function inboxPage(requestId, cursor = '', limit = 30) {
  return { action: 'get-direct-chat-inbox', payload: { ...(cursor ? { cursor } : {}), limit }, requestId, version: 1 };
}

function execute(db, uid, body, claims = {}, services = {}) {
  return executeDirectChatCommand({
    body,
    ...services,
    clock: db.clock,
    db,
    decodedToken: { email: `${uid}@example.test`, email_verified: true, uid, ...claims },
  });
}

function seedPair(db, { friends = false } = {}) {
  db.write('appConfig/socialFeatures', { directMessageRequests: true, directMessages: true });
  db.write('appConfig/voiceRoomModeration', { keywordTerms: [] });
  db.write('publicProfiles/user-1', { displayName: 'One', moderationStatus: 'active', uid: 'user-1' });
  db.write('publicProfiles/user-2', { displayName: 'Two', moderationStatus: 'active', uid: 'user-2' });
  if (friends) {
    db.write(`friendships/${createFriendshipId('user-1', 'user-2')}`, { memberUids: ['user-1', 'user-2'] });
  }
  return db.clock;
}

function createFakeDb() {
  const documents = new Map();
  const clock = {
    now: Date.UTC(2026, 7, 2, 12),
    nowMillis() { return this.now; },
    timestampFromMillis(value) { return value; },
  };
  const makeRef = (path) => ({
    id: path.split('/').at(-1),
    path,
    collection(name) { return makeCollection(`${path}/${name}`); },
    async get() { return snapshot(makeRef(path)); },
  });
  const snapshot = (reference) => ({
    exists: documents.has(reference.path),
    id: reference.id,
    data: () => documents.get(reference.path),
    ref: reference,
  });
  const makeQuery = (collectionId, prefix = '') => {
    const filters = [];
    const ordering = [];
    let afterValues;
    let maximum = Number.POSITIVE_INFINITY;
    const query = {
      __query: true,
      where(field, operator, value) { filters.push([field, operator, value]); return query; },
      orderBy(field, direction = 'asc') { ordering.push([field, direction]); return query; },
      startAfter(...values) { afterValues = values; return query; },
      limit(value) { maximum = value; db.queryLimits.push(value); return query; },
      async get() {
        let entries = [...documents.entries()]
          .filter(([path]) => matchesCollection(path, collectionId, prefix))
          .filter(([, value]) => filters.every(([field, operator, expected]) => compare(value?.[field], operator, expected)));
        entries.sort((left, right) => compareOrdered(left[1], right[1], ordering));
        if (afterValues) {
          entries = entries.filter(([, value]) => isAfter(value, ordering, afterValues));
        }
        const docs = entries.slice(0, maximum).map(([path]) => snapshot(makeRef(path)));
        return { docs, empty: docs.length === 0, size: docs.length };
      },
    };
    return query;
  };
  const makeCollection = (path) => ({
    doc(id) { return makeRef(`${path}/${id}`); },
    ...makeQuery(path.split('/').at(-1), path),
  });
  const transaction = {
    async get(reference) { return reference?.__query ? reference.get() : snapshot(reference); },
    create(reference, value) {
      if (documents.has(reference.path)) throw new Error(`already exists: ${reference.path}`);
      documents.set(reference.path, structuredClone(value));
    },
    delete(reference) { documents.delete(reference.path); },
    set(reference, value, options) {
      documents.set(reference.path, options?.merge
        ? { ...(documents.get(reference.path) || {}), ...structuredClone(value) }
        : structuredClone(value));
    },
    update(reference, value) {
      if (!documents.has(reference.path)) throw new Error(`missing: ${reference.path}`);
      documents.set(reference.path, { ...documents.get(reference.path), ...structuredClone(value) });
    },
  };
  let transactionTail = Promise.resolve();
  const db = {
    clock,
    queryLimits: [],
    batch() {
      const deletes = [];
      return { delete(reference) { deletes.push(reference); }, async commit() { deletes.forEach((reference) => documents.delete(reference.path)); } };
    },
    collection(path) { return makeCollection(path); },
    collectionGroup(id) { return makeQuery(id); },
    delete(path) { documents.delete(path); },
    doc(path) { return makeRef(path); },
    async getAll(...references) { return references.map(snapshot); },
    paths(prefix) { return [...documents.keys()].filter((path) => path.startsWith(prefix)); },
    read(path) { return documents.get(path); },
    runTransaction(callback) {
      const result = transactionTail.then(() => callback(transaction));
      transactionTail = result.catch(() => undefined);
      return result;
    },
    write(path, value) { documents.set(path, structuredClone(value)); },
  };
  return db;
}

function createFakeBucket() {
  const objects = new Map();
  const file = (path) => ({
    async delete() { objects.delete(path); },
    async download() { const object = objects.get(path); if (!object) throw new Error('missing'); return [Buffer.from(object.bytes)]; },
    async getMetadata() { const object = objects.get(path); if (!object) throw new Error('missing'); return [{ ...object.metadata, size: String(object.bytes.length) }]; },
    async save(bytes, options) {
      if (options?.preconditionOpts?.ifGenerationMatch === 0 && objects.has(path)) { const error = new Error('exists'); error.code = 412; throw error; }
      objects.set(path, { bytes: Buffer.from(bytes), metadata: options.metadata });
    },
  });
  return {
    file,
    paths(prefix) { return [...objects.keys()].filter((path) => path.startsWith(prefix)); },
    read(path) { return objects.get(path); },
    seed(path, bytes, metadata) { objects.set(path, { bytes: Buffer.from(bytes), metadata }); },
  };
}

function matchesCollection(path, collectionId, prefix) {
  const parts = path.split('/');
  if (prefix) return path.startsWith(`${prefix}/`) && parts.length === prefix.split('/').length + 1;
  return parts.length >= 2 && parts.at(-2) === collectionId;
}

function compare(actual, operator, expected) {
  if (operator === '==') return actual === expected;
  if (operator === '<=') return actual <= expected;
  if (operator === '>') return actual > expected;
  if (operator === '<') return actual < expected;
  throw new Error(`unsupported operator ${operator}`);
}

function compareOrdered(left, right, ordering) {
  for (const [field, direction] of ordering) {
    const comparison = left?.[field] === right?.[field] ? 0 : left?.[field] < right?.[field] ? -1 : 1;
    if (comparison !== 0) return direction === 'desc' ? -comparison : comparison;
  }
  return 0;
}

function isAfter(value, ordering, afterValues) {
  for (let index = 0; index < ordering.length; index += 1) {
    const [field, direction] = ordering[index];
    const current = value?.[field];
    const boundary = afterValues[index];
    if (current === boundary) continue;
    return direction === 'desc' ? current < boundary : current > boundary;
  }
  return false;
}
