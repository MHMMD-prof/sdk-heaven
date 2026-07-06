import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { resolveRoomCommand } = require('./roomCommandCore');

const decodedToken = {
  email: 'salem@example.com',
  email_verified: true,
  uid: 'host-1',
};
const profile = {
  avatarLabel: 'S',
  displayName: 'Salem',
  email: 'salem@example.com',
  uid: 'host-1',
};
const room = {
  id: 'room-1',
  status: 'active',
};
const hostMembership = {
  uid: 'host-1',
  role: 'host',
  status: 'active',
};
const listenerMembership = {
  uid: 'listener-1',
  role: 'listener',
  status: 'active',
};

describe('roomCommandCore', () => {
  it('allows an active host to run moderation commands', () => {
    expect(
      resolveRoomCommand({
        actorMembership: hostMembership,
        body: { roomId: 'room-1', action: 'promote-speaker', targetUid: 'listener-1' },
        decodedToken,
        profile,
        room,
        targetMembership: listenerMembership,
      }),
    ).toMatchObject({
      ok: true,
      value: {
        action: 'promote-speaker',
        targetUid: 'listener-1',
      },
    });

    expect(
      resolveRoomCommand({
        actorMembership: hostMembership,
        body: { roomId: 'room-1', action: 'close-room' },
        decodedToken,
        profile,
        room,
      }),
    ).toMatchObject({ ok: true, value: { action: 'close-room' } });
  });

  it('rejects destructive commands from non-host members', () => {
    expect(
      resolveRoomCommand({
        actorMembership: { ...listenerMembership, uid: 'host-1' },
        body: { roomId: 'room-1', action: 'remove-member', targetUid: 'listener-1' },
        decodedToken,
        profile,
        room,
        targetMembership: listenerMembership,
      }),
    ).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it('allows active members to report another member', () => {
    expect(
      resolveRoomCommand({
        actorMembership: { ...listenerMembership, uid: 'host-1' },
        body: { roomId: 'room-1', action: 'report-member', targetUid: 'listener-1', reason: 'spam' },
        decodedToken,
        profile,
        room,
        targetMembership: listenerMembership,
      }),
    ).toMatchObject({
      ok: true,
      value: {
        action: 'report-member',
        reason: 'spam',
      },
    });
  });

  it('rejects invalid rooms, targets, and unverified actors', () => {
    expect(
      resolveRoomCommand({
        actorMembership: hostMembership,
        body: { roomId: 'room-1', action: 'promote-speaker', targetUid: 'listener-1' },
        decodedToken: { ...decodedToken, email_verified: false },
        profile,
        room,
        targetMembership: listenerMembership,
      }),
    ).toMatchObject({ ok: false, status: 403 });

    expect(
      resolveRoomCommand({
        actorMembership: hostMembership,
        body: { roomId: 'room-1', action: 'promote-speaker' },
        decodedToken,
        profile,
        room: { ...room, status: 'closed' },
      }),
    ).toMatchObject({ ok: false, status: 400 });
  });
});
