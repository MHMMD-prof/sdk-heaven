import { describe, expect, it } from 'vitest';

import {
  hasRoomCommandCenterCapability,
  roomCommandCenterCapabilities,
} from '../roomCommandCenterModel';

describe('roomCommandCenterModel', () => {
  it('shows ordinary members only useful, permitted tools', () => {
    expect(roomCommandCenterCapabilities('member')).toEqual([
      'share',
      'games',
      'gifts',
      'reactions',
      'participants',
      'report',
    ]);
    expect(hasRoomCommandCenterCapability('member', 'room-settings')).toBe(false);
  });

  it('adds operational tools for room moderators without owner-only settings', () => {
    expect(hasRoomCommandCenterCapability('moderator', 'microphones')).toBe(true);
    expect(hasRoomCommandCenterCapability('moderator', 'people')).toBe(true);
    expect(hasRoomCommandCenterCapability('moderator', 'safety')).toBe(true);
    expect(hasRoomCommandCenterCapability('moderator', 'ownership')).toBe(false);
  });

  it('gives the owner settings and lifecycle tools independent of seat state', () => {
    expect(hasRoomCommandCenterCapability('owner', 'room-settings')).toBe(true);
    expect(hasRoomCommandCenterCapability('owner', 'ownership')).toBe(true);
  });
});
