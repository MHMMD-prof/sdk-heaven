import { describe, expect, it } from 'vitest';

import {
  deriveRoomChatCommandEndpoint,
  deriveRoomCommandEndpoint,
  deriveRoomMediaCommandEndpoint,
} from '../activeVoiceProviderConfig';

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
