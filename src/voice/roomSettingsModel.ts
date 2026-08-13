import type { RoomSettingsPatch } from './requestRoomCommand';

export type RoomSettingsSection = 'room' | 'appearance' | 'chat';

export type RoomCopySettings = Required<Pick<
  RoomSettingsPatch,
  'announcement' | 'welcomeMessage'
>>;

export type RoomChatSettings = Required<Pick<
  RoomSettingsPatch,
  'chatMode' | 'slowModeSeconds' | 'historyVisibility' | 'keywordFilterMode' | 'effectsPolicy'
>>;

export function roomCopySettings(settings: Required<RoomSettingsPatch>): RoomCopySettings {
  return {
    announcement: settings.announcement,
    welcomeMessage: settings.welcomeMessage,
  };
}

export function roomChatSettings(settings: Required<RoomSettingsPatch>): RoomChatSettings {
  return {
    chatMode: settings.chatMode,
    slowModeSeconds: settings.slowModeSeconds,
    historyVisibility: settings.historyVisibility,
    keywordFilterMode: settings.keywordFilterMode,
    effectsPolicy: settings.effectsPolicy,
  };
}

export function roomSettingsEqual(
  left: RoomCopySettings | RoomChatSettings,
  right: RoomCopySettings | RoomChatSettings,
) {
  const keys = Object.keys(left) as Array<keyof typeof left>;
  return keys.every((key) => left[key] === right[key]);
}
