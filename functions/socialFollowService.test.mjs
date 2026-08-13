import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createFriendshipId } = require('./socialFriendsCore');
const { mutateFollow } = require('./socialFollowService');
const { mutateUserBlock } = require('./socialBlocksService');

describe('socialFollowService + block hygiene', () => {
  it('follows and unfollows with count updates and safe replay', async () => {
    const db = fakeDb();
    seedReadyProfiles(db, 'user-1', 'user-2');
    db.write('appConfig/socialFeatures', { following: true });

    const stamp = { __serverTimestamp: true };
    const followArgs = {
      action: 'follow-user',
      db,
      fieldValue: { serverTimestamp: () => stamp },
      input: { targetUid: 'user-2' },
      requestId: 'follow_request_0001',
      uid: 'user-1',
    };

    await expect(mutateFollow(followArgs)).resolves.toEqual({
      result: { followedBy: false, status: 'following' },
    });
    await expect(mutateFollow(followArgs)).resolves.toEqual({
      result: { followedBy: false, status: 'following' },
    });
    expect(db.read('following/user-1/items/user-2')).toMatchObject({ targetUid: 'user-2' });
    expect(db.read('followers/user-2/items/user-1')).toMatchObject({ followerUid: 'user-1' });
    expect(db.read('publicProfiles/user-1').followingCount).toBe(1);
    expect(db.read('publicProfiles/user-2').followerCount).toBe(1);

    const unfollowArgs = {
      ...followArgs,
      action: 'unfollow-user',
      requestId: 'unfollow_request_0001',
    };
    await expect(mutateFollow(unfollowArgs)).resolves.toEqual({
      result: { followedBy: false, status: 'none' },
    });
    expect(db.read('following/user-1/items/user-2')).toBeUndefined();
    expect(db.read('followers/user-2/items/user-1')).toBeUndefined();
    expect(db.read('publicProfiles/user-1').followingCount).toBe(0);
    expect(db.read('publicProfiles/user-2').followerCount).toBe(0);
  });

  it('heals orphan follower mirror on re-follow without drifting counts', async () => {
    const db = fakeDb();
    seedReadyProfiles(db, 'user-1', 'user-2');
    db.write('appConfig/socialFeatures', { following: true });
    const stamp = { __serverTimestamp: true };
    db.write('followers/user-2/items/user-1', { createdAt: stamp, followerUid: 'user-1' });
    db.write('publicProfiles/user-1', { ...db.read('publicProfiles/user-1'), followingCount: 1 });
    db.write('publicProfiles/user-2', { ...db.read('publicProfiles/user-2'), followerCount: 1 });

    await expect(mutateFollow({
      action: 'follow-user',
      db,
      fieldValue: { serverTimestamp: () => stamp },
      input: { targetUid: 'user-2' },
      requestId: 'follow_orphan_heal_01',
      uid: 'user-1',
    })).resolves.toEqual({ result: { followedBy: false, status: 'following' } });

    expect(db.read('following/user-1/items/user-2')).toMatchObject({ targetUid: 'user-2' });
    expect(db.read('followers/user-2/items/user-1')).toMatchObject({ followerUid: 'user-1' });
    expect(db.read('publicProfiles/user-1').followingCount).toBe(1);
    expect(db.read('publicProfiles/user-2').followerCount).toBe(1);
  });

  it('heals undercounted orphan mirrors by restoring zero counts to one', async () => {
    const db = fakeDb();
    seedReadyProfiles(db, 'user-1', 'user-2');
    db.write('appConfig/socialFeatures', { following: true });
    const stamp = { __serverTimestamp: true };
    db.write('followers/user-2/items/user-1', { createdAt: stamp, followerUid: 'user-1' });

    await expect(mutateFollow({
      action: 'follow-user',
      db,
      fieldValue: { serverTimestamp: () => stamp },
      input: { targetUid: 'user-2' },
      requestId: 'follow_orphan_undercount_01',
      uid: 'user-1',
    })).resolves.toEqual({ result: { followedBy: false, status: 'following' } });

    expect(db.read('following/user-1/items/user-2')).toMatchObject({ targetUid: 'user-2' });
    expect(db.read('followers/user-2/items/user-1')).toMatchObject({ followerUid: 'user-1' });
    expect(db.read('publicProfiles/user-1').followingCount).toBe(1);
    expect(db.read('publicProfiles/user-2').followerCount).toBe(1);
    expect(db.read('socialCommandRequests/user-1/requests/follow_orphan_undercount_01').notificationKind)
      .toBeUndefined();
  });

  it('unfollow clears orphan follower mirrors and corrects counts', async () => {
    const db = fakeDb();
    seedReadyProfiles(db, 'user-1', 'user-2');
    db.write('appConfig/socialFeatures', { following: true });
    const stamp = { __serverTimestamp: true };
    db.write('followers/user-2/items/user-1', { createdAt: stamp, followerUid: 'user-1' });
    db.write('publicProfiles/user-1', { ...db.read('publicProfiles/user-1'), followingCount: 1 });
    db.write('publicProfiles/user-2', { ...db.read('publicProfiles/user-2'), followerCount: 1 });

    await expect(mutateFollow({
      action: 'unfollow-user',
      db,
      fieldValue: { serverTimestamp: () => stamp },
      input: { targetUid: 'user-2' },
      requestId: 'unfollow_orphan_01',
      uid: 'user-1',
    })).resolves.toEqual({ result: { followedBy: false, status: 'none' } });

    expect(db.read('followers/user-2/items/user-1')).toBeUndefined();
    expect(db.read('publicProfiles/user-1').followingCount).toBe(0);
    expect(db.read('publicProfiles/user-2').followerCount).toBe(0);
  });

  it('block clears friendship counts and follow edges both ways', async () => {
    const db = fakeDb();
    seedReadyProfiles(db, 'user-1', 'user-2');
    const friendshipId = createFriendshipId('user-1', 'user-2');
    db.write(`friendships/${friendshipId}`, { memberUids: ['user-1', 'user-2'] });
    db.write('following/user-1/items/user-2', { targetUid: 'user-2', createdAt: 1 });
    db.write('followers/user-2/items/user-1', { followerUid: 'user-1', createdAt: 1 });
    db.write('following/user-2/items/user-1', { targetUid: 'user-1', createdAt: 1 });
    db.write('followers/user-1/items/user-2', { followerUid: 'user-2', createdAt: 1 });
    db.write('publicProfiles/user-1', {
      ...db.read('publicProfiles/user-1'),
      friendCount: 1,
      followerCount: 1,
      followingCount: 1,
    });
    db.write('publicProfiles/user-2', {
      ...db.read('publicProfiles/user-2'),
      friendCount: 1,
      followerCount: 1,
      followingCount: 1,
    });

    await expect(mutateUserBlock({
      action: 'block-user',
      db,
      fieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
      input: { targetUid: 'user-2' },
      requestId: 'block_follow_0001',
      uid: 'user-1',
    })).resolves.toEqual({ result: { blocked: true, targetUid: 'user-2' } });

    expect(db.read(`friendships/${friendshipId}`)).toBeUndefined();
    expect(db.read('following/user-1/items/user-2')).toBeUndefined();
    expect(db.read('following/user-2/items/user-1')).toBeUndefined();
    expect(db.read('publicProfiles/user-1')).toMatchObject({
      friendCount: 0,
      followerCount: 0,
      followingCount: 0,
    });
    expect(db.read('publicProfiles/user-2')).toMatchObject({
      friendCount: 0,
      followerCount: 0,
      followingCount: 0,
    });
  });
});

function seedReadyProfiles(db, uidA, uidB) {
  const stamp = { __serverTimestamp: true };
  for (const uid of [uidA, uidB]) {
    const publicId = uid === uidA ? '1111111' : '2222222';
    db.write(`publicProfiles/${uid}`, {
      avatarModerationStatus: 'clear',
      avatarUrl: '',
      bio: '',
      countryCode: 'IQ',
      coupleLevel: 0,
      createdAt: stamp,
      displayName: uid,
      followerCount: 0,
      followingCount: 0,
      friendCount: 0,
      giftScore: 0,
      moderationStatus: 'active',
      normalizedName: uid,
      publicId,
      uid,
      updatedAt: stamp,
    });
    db.write(`publicIds/${publicId}`, { createdAt: stamp, uid });
  }
}

function fakeDb() {
  const values = new Map();
  const ref = (path) => ({ path });
  const snapshot = (reference) => ({
    exists: values.has(reference.path),
    data: () => values.get(reference.path),
    id: reference.path.split('/').at(-1),
    ref: reference,
  });
  const transaction = {
    create(reference, value) {
      if (values.has(reference.path)) throw new Error('exists');
      values.set(reference.path, structuredClone(value));
    },
    delete(reference) { values.delete(reference.path); },
    async get(reference) { return snapshot(reference); },
    set(reference, value, options) {
      values.set(
        reference.path,
        options?.merge ? { ...(values.get(reference.path) || {}), ...structuredClone(value) } : structuredClone(value),
      );
    },
    update(reference, value) {
      values.set(reference.path, { ...(values.get(reference.path) || {}), ...structuredClone(value) });
    },
  };
  return {
    collection: () => ({
      orderBy: () => ({
        limit: () => ({
          get: async () => ({ docs: [], empty: true }),
        }),
      }),
    }),
    doc: ref,
    getAll: async (...refs) => refs.map((reference) => snapshot(reference)),
    read: (path) => values.get(path),
    runTransaction: (callback) => callback(transaction),
    write: (path, value) => values.set(path, structuredClone(value)),
  };
}
