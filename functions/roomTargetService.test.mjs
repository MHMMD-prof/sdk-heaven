import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'vitest';

const require = createRequire(import.meta.url);
const { resolveCycleRosterContext, searchRoomTargetRosterUsers } = require('./roomTargetService');

function snapshot(data) {
  return { data: () => data, exists: data !== undefined };
}

function fakeDb({ draft, room, transfer }) {
  return {
    doc(path) {
      assert.equal(path, 'rooms/room-one');
      return {
        async get() {
          return snapshot(room);
        },
        collection(name) {
          return {
            doc(id) {
              return {
                async get() {
                  if (name === 'targetRosterDrafts') return snapshot(draft);
                  if (name === 'ownershipTransfers') return snapshot(transfer);
                  throw new Error(`Unexpected collection ${name}/${id}`);
                },
              };
            },
          };
        },
      };
    },
  };
}

test('locks the owner and prepared selected users into the cycle roster', async () => {
  const result = await resolveCycleRosterContext({
    clock: {},
    cycleId: 'weekly-cycle',
    cycleStartAtMillis: 1_000,
    db: fakeDb({
      draft: { selectedUids: ['selected', 'owner'] },
      room: { ownerUid: 'owner' },
    }),
    roomId: 'room-one',
  });
  assert.deepEqual(result, {
    ownerUid: 'owner',
    roster: [
      { role: 'owner', uid: 'owner' },
      { role: 'selected', uid: 'selected' },
    ],
  });
});

test('preserves the prior owner when ownership transfers after cycle start', async () => {
  const result = await resolveCycleRosterContext({
    clock: {},
    cycleId: 'weekly-cycle',
    cycleStartAtMillis: 1_000,
    db: fakeDb({
      draft: { selectedUids: ['selected'] },
      room: {
        lastOwnershipTransferId: 'transfer-one',
        lastOwnershipTransferredAt: { toMillis: () => 1_001 },
        ownerUid: 'new-owner',
      },
      transfer: {
        fromUid: 'prior-owner',
        status: 'accepted',
        toUid: 'new-owner',
      },
    }),
    roomId: 'room-one',
  });
  assert.equal(result.ownerUid, 'prior-owner');
  assert.deepEqual(result.roster[0], { role: 'owner', uid: 'prior-owner' });
});

test('room target roster search is owner-only and uses the privacy-safe discovery mapper', async () => {
  const documents = new Map([
    ['rooms/room-one', { ownerUid: 'owner', status: 'active' }],
    ['appConfig/voiceRoomFeatures', { voice_room_owner_targets: true }],
    ['publicProfiles/owner', { moderationStatus: 'active', uid: 'owner' }],
  ]);
  const db = {
    doc(path) {
      return {
        async get() {
          return snapshot(documents.get(path));
        },
      };
    },
  };
  let forwarded;
  const result = await searchRoomTargetRosterUsers({
    db,
    decodedToken: { uid: 'owner' },
    discoverUsers: async (input) => {
      forwarded = input;
      return { result: { users: [{ displayName: 'Safe profile', uid: 'candidate' }] } };
    },
    input: { action: 'search-roster-users', query: 'sa', roomId: 'room-one' },
  });
  assert.equal(result.ok, true);
  assert.equal(forwarded.skipFeatureGate, true);
  assert.deepEqual(result.result.users, [{ displayName: 'Safe profile', uid: 'candidate' }]);
});

test('room target roster search rejects a moderator', async () => {
  const documents = new Map([
    ['rooms/room-one', { ownerUid: 'owner', status: 'active' }],
    ['appConfig/voiceRoomFeatures', { voice_room_owner_targets: true }],
    ['publicProfiles/mod', { moderationStatus: 'active', uid: 'mod' }],
  ]);
  const result = await searchRoomTargetRosterUsers({
    db: {
      doc(path) {
        return { get: async () => snapshot(documents.get(path)) };
      },
    },
    decodedToken: { uid: 'mod' },
    discoverUsers: async () => {
      throw new Error('must not search');
    },
    input: { action: 'search-roster-users', query: 'sa', roomId: 'room-one' },
  });
  assert.equal(result.code, 'OWNER_REQUIRED');
  assert.equal(result.status, 403);
});
