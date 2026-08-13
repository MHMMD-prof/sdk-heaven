import { describe, expect, it } from 'vitest';

import {
  deriveRoomAttendanceCommandEndpoint,
  deriveRoomChatCommandEndpoint,
  deriveRoomCommandEndpoint,
  deriveRoomEntryEffectCommandEndpoint,
  deriveRoomGameCommandEndpoint,
  deriveRoomPkCommandEndpoint,
  deriveRoomGiftCommandEndpoint,
  deriveRoomMediaCommandEndpoint,
  deriveRoomMusicCommandEndpoint,
  deriveRoomOwnershipCommandEndpoint,
  deriveRoomRecordingCommandEndpoint,
  deriveRoomTargetCommandEndpoint,
  shouldUseMockVoiceProvider,
} from '../activeVoiceProviderConfig';

describe('deriveRoomTargetCommandEndpoint', () => {
  it('derives first and second generation Room Target endpoints', () => {
    expect(deriveRoomTargetCommandEndpoint('https://us-central1-yallgame-ebd19.cloudfunctions.net/roomCommand'))
      .toBe('https://us-central1-yallgame-ebd19.cloudfunctions.net/roomTargetCommand');
    expect(deriveRoomTargetCommandEndpoint('https://roomcommand-2dr73d3xua-uc.a.run.app'))
      .toBe('https://roomtargetcommand-2dr73d3xua-uc.a.run.app');
  });
});

describe('deriveRoomAttendanceCommandEndpoint', () => {
  it('derives first and second generation attendance endpoints', () => {
    expect(deriveRoomAttendanceCommandEndpoint('https://us-central1-yallgame-ebd19.cloudfunctions.net/roomCommand'))
      .toBe('https://us-central1-yallgame-ebd19.cloudfunctions.net/roomAttendanceCommand');
    expect(deriveRoomAttendanceCommandEndpoint('https://roomcommand-2dr73d3xua-uc.a.run.app'))
      .toBe('https://roomattendancecommand-2dr73d3xua-uc.a.run.app');
  });
});

describe('production voice provider gate', () => {
  it('allows mock voice only through an explicit non-production override', () => {
    expect(shouldUseMockVoiceProvider({})).toBe(false);
    expect(shouldUseMockVoiceProvider({
      EXPO_PUBLIC_APP_ENV: 'production',
      EXPO_PUBLIC_VOICE_ALLOW_MOCK_PROVIDER: 'true',
    })).toBe(false);
    expect(shouldUseMockVoiceProvider({
      EXPO_PUBLIC_APP_ENV: 'development',
      EXPO_PUBLIC_VOICE_ALLOW_MOCK_PROVIDER: 'true',
    })).toBe(true);
  });
});

describe('deriveRoomCommandEndpoint', () => {
  it('derives first-gen Firebase Functions URLs', () => {
    expect(
      deriveRoomCommandEndpoint('https://us-central1-yallgame-ebd19.cloudfunctions.net/livekitToken'),
    ).toBe('https://us-central1-yallgame-ebd19.cloudfunctions.net/roomCommand');
  });

  it('derives second-gen run.app URLs', () => {
    expect(
      deriveRoomCommandEndpoint('https://livekittoken-2dr73d3xua-uc.a.run.app'),
    ).toBe('https://roomcommand-2dr73d3xua-uc.a.run.app');
  });
});

describe('deriveRoomOwnershipCommandEndpoint', () => {
  it('derives first and second generation room ownership endpoints', () => {
    expect(
      deriveRoomOwnershipCommandEndpoint('https://us-central1-yallgame-ebd19.cloudfunctions.net/roomCommand'),
    ).toBe('https://us-central1-yallgame-ebd19.cloudfunctions.net/roomOwnershipCommand');
    expect(
      deriveRoomOwnershipCommandEndpoint('https://roomcommand-2dr73d3xua-uc.a.run.app'),
    ).toBe('https://roomownershipcommand-2dr73d3xua-uc.a.run.app');
  });
});

describe('deriveRoomGiftCommandEndpoint', () => {
  it('derives first and second generation room gift endpoints', () => {
    expect(
      deriveRoomGiftCommandEndpoint('https://us-central1-yallgame-ebd19.cloudfunctions.net/roomCommand'),
    ).toBe('https://us-central1-yallgame-ebd19.cloudfunctions.net/roomGiftCommand');
    expect(
      deriveRoomGiftCommandEndpoint('https://roomcommand-2dr73d3xua-uc.a.run.app'),
    ).toBe('https://roomgiftcommand-2dr73d3xua-uc.a.run.app');
  });
});

describe('deriveRoomEntryEffectCommandEndpoint', () => {
  it('derives first and second generation room entry-effect endpoints', () => {
    expect(
      deriveRoomEntryEffectCommandEndpoint('https://us-central1-yallgame-ebd19.cloudfunctions.net/roomCommand'),
    ).toBe('https://us-central1-yallgame-ebd19.cloudfunctions.net/roomEntryEffectCommand');
    expect(
      deriveRoomEntryEffectCommandEndpoint('https://roomcommand-2dr73d3xua-uc.a.run.app'),
    ).toBe('https://roomentryeffectcommand-2dr73d3xua-uc.a.run.app');
  });
});

describe('deriveRoomGameCommandEndpoint', () => {
  it('derives first and second generation room game endpoints', () => {
    expect(
      deriveRoomGameCommandEndpoint('https://us-central1-yallgame-ebd19.cloudfunctions.net/roomCommand'),
    ).toBe('https://us-central1-yallgame-ebd19.cloudfunctions.net/roomGameCommand');
    expect(
      deriveRoomGameCommandEndpoint('https://roomcommand-2dr73d3xua-uc.a.run.app'),
    ).toBe('https://roomgamecommand-2dr73d3xua-uc.a.run.app');
  });
});

describe('deriveRoomPkCommandEndpoint', () => {
  it('derives first and second generation room PK endpoints', () => {
    expect(
      deriveRoomPkCommandEndpoint('https://us-central1-yallgame-ebd19.cloudfunctions.net/roomCommand'),
    ).toBe('https://us-central1-yallgame-ebd19.cloudfunctions.net/roomPkCommand');
    expect(
      deriveRoomPkCommandEndpoint('https://roomcommand-2dr73d3xua-uc.a.run.app'),
    ).toBe('https://roompkcommand-2dr73d3xua-uc.a.run.app');
  });
});

describe('deriveRoomMusicCommandEndpoint', () => {
  it('derives first and second generation room music endpoints', () => {
    expect(
      deriveRoomMusicCommandEndpoint('https://us-central1-yallgame-ebd19.cloudfunctions.net/roomCommand'),
    ).toBe('https://us-central1-yallgame-ebd19.cloudfunctions.net/roomMusicCommand');
    expect(
      deriveRoomMusicCommandEndpoint('https://roomcommand-2dr73d3xua-uc.a.run.app'),
    ).toBe('https://roommusiccommand-2dr73d3xua-uc.a.run.app');
  });
});

describe('deriveRoomRecordingCommandEndpoint', () => {
  it('derives first and second generation room recording endpoints', () => {
    expect(
      deriveRoomRecordingCommandEndpoint('https://us-central1-yallgame-ebd19.cloudfunctions.net/roomCommand'),
    ).toBe('https://us-central1-yallgame-ebd19.cloudfunctions.net/roomRecordingCommand');
    expect(
      deriveRoomRecordingCommandEndpoint('https://roomcommand-2dr73d3xua-uc.a.run.app'),
    ).toBe('https://roomrecordingcommand-2dr73d3xua-uc.a.run.app');
  });
});

describe('deriveRoomChatCommandEndpoint', () => {
  it('derives first and second generation room chat endpoints', () => {
    expect(
      deriveRoomChatCommandEndpoint('https://us-central1-yallgame-ebd19.cloudfunctions.net/roomCommand'),
    ).toBe('https://us-central1-yallgame-ebd19.cloudfunctions.net/roomChatCommand');
    expect(
      deriveRoomChatCommandEndpoint('https://roomcommand-2dr73d3xua-uc.a.run.app'),
    ).toBe('https://roomchatcommand-2dr73d3xua-uc.a.run.app');
  });
});

describe('deriveRoomMediaCommandEndpoint', () => {
  it('derives first and second generation room media endpoints', () => {
    expect(
      deriveRoomMediaCommandEndpoint('https://us-central1-yallgame-ebd19.cloudfunctions.net/roomCommand'),
    ).toBe('https://us-central1-yallgame-ebd19.cloudfunctions.net/roomMediaCommand');
    expect(
      deriveRoomMediaCommandEndpoint('https://roomcommand-2dr73d3xua-uc.a.run.app'),
    ).toBe('https://roommediacommand-2dr73d3xua-uc.a.run.app');
  });
});
