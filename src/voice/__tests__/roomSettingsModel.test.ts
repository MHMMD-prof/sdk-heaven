import { describe, expect, it } from 'vitest';

import type { RoomSettingsPatch } from '../requestRoomCommand';
import {
  roomChatSettings,
  roomCopySettings,
  roomSettingsEqual,
} from '../roomSettingsModel';

const settings: Required<RoomSettingsPatch> = {
  announcement: 'Welcome',
  welcomeMessage: 'Hello',
  chatMode: 'everyone',
  slowModeSeconds: 5,
  historyVisibility: 'after-join',
  keywordFilterMode: 'standard',
  effectsPolicy: 'full',
};

describe('room settings model', () => {
  it('creates independent Room and Chat patches', () => {
    expect(roomCopySettings(settings)).toEqual({
      announcement: 'Welcome',
      welcomeMessage: 'Hello',
    });
    expect(roomChatSettings(settings)).toEqual({
      chatMode: 'everyone',
      slowModeSeconds: 5,
      historyVisibility: 'after-join',
      keywordFilterMode: 'standard',
      effectsPolicy: 'full',
    });
  });

  it('detects clean and dirty section drafts', () => {
    const room = roomCopySettings(settings);
    expect(roomSettingsEqual(room, { ...room })).toBe(true);
    expect(roomSettingsEqual(room, { ...room, announcement: 'Changed' })).toBe(false);
  });
});
