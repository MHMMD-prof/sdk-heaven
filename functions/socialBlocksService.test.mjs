import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createDirectConversationId } = require('./directChatCore');
const { createFriendshipId } = require('./socialFriendsCore');
const { mutateUserBlock } = require('./socialBlocksService');

describe('socialBlocksService', () => {
  it('atomically closes a pending request, removes friendship state, and replays safely', async () => {
    const db = fakeDb();
    const conversationId = createDirectConversationId('user-1', 'user-2');
    const friendshipId = createFriendshipId('user-1', 'user-2');
    db.write('publicProfiles/user-1', { moderationStatus: 'active', uid: 'user-1', friendCount: 1, followerCount: 0, followingCount: 0 });
    db.write('publicProfiles/user-2', { moderationStatus: 'active', uid: 'user-2', friendCount: 1, followerCount: 0, followingCount: 0 });
    db.write(`friendships/${friendshipId}`, { memberUids: ['user-1', 'user-2'] });
    db.write(`friendRequests/${friendshipId}`, { status: 'pending' });
    db.write(`directConversations/${conversationId}`, { memberUids: ['user-1', 'user-2'], requestState: 'pending' });
    db.write(`directMessageRequests/${conversationId}`, { recipientUid: 'user-1', senderUid: 'user-2', status: 'pending' });

    const args = {
      action: 'block-user',
      db,
      fieldValue: { serverTimestamp: () => 123 },
      input: { targetUid: 'user-2' },
      requestId: 'block_request_0001',
      uid: 'user-1',
    };
    await expect(mutateUserBlock(args)).resolves.toEqual({ result: { blocked: true, targetUid: 'user-2' } });
    await expect(mutateUserBlock(args)).resolves.toEqual({ result: { blocked: true, targetUid: 'user-2' } });
    expect(db.read('blocks/user-1/blocked/user-2')).toMatchObject({ blockerUid: 'user-1' });
    expect(db.read(`friendships/${friendshipId}`)).toBeUndefined();
    expect(db.read(`friendRequests/${friendshipId}`)).toBeUndefined();
    expect(db.read('publicProfiles/user-1')).toMatchObject({ friendCount: 0 });
    expect(db.read('publicProfiles/user-2')).toMatchObject({ friendCount: 0 });
    expect(db.read(`directMessageRequests/${conversationId}`)).toMatchObject({ blockedByUid: 'user-1', status: 'blocked' });
    expect(db.read(`directConversations/${conversationId}`)).toMatchObject({ requestState: 'blocked' });
  });
});

function fakeDb() {
  const values = new Map();
  const ref = (path) => ({ path });
  const snapshot = (reference) => ({ exists: values.has(reference.path), data: () => values.get(reference.path) });
  const transaction = {
    create(reference, value) { if (values.has(reference.path)) throw new Error('exists'); values.set(reference.path, structuredClone(value)); },
    delete(reference) { values.delete(reference.path); },
    async get(reference) { return snapshot(reference); },
    set(reference, value, options) { values.set(reference.path, options?.merge ? { ...(values.get(reference.path) || {}), ...structuredClone(value) } : structuredClone(value)); },
    update(reference, value) { values.set(reference.path, { ...(values.get(reference.path) || {}), ...structuredClone(value) }); },
  };
  return {
    doc: ref,
    read: (path) => values.get(path),
    runTransaction: (callback) => callback(transaction),
    write: (path, value) => values.set(path, structuredClone(value)),
  };
}
