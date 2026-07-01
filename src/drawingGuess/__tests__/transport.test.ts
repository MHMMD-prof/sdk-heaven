import { describe, expect, it } from 'vitest';

import { DRAWING_GUESS_PROTOCOL_VERSION, DRAWING_GUESS_TOPICS } from '../model/constants';
import { MockDrawingGuessTransport } from '../transport/MockDrawingGuessTransport';
import {
  validateDrawingGuessMessage,
  validateTopicCompatibleDrawingGuessMessage,
} from '../transport/messageValidation';
import { DrawingGuessOutboundMessage } from '../transport/types';

const createMessage = (
  override: Partial<DrawingGuessOutboundMessage> = {},
): DrawingGuessOutboundMessage => ({
  protocolVersion: DRAWING_GUESS_PROTOCOL_VERSION,
  matchId: 'match-1',
  messageId: 'message-1',
  senderId: 'p1',
  clientTime: 1000,
  sequence: 1,
  topic: DRAWING_GUESS_TOPICS.chat,
  payload: { text: 'hello' },
  ...override,
});

describe('Drawing Guess transport validation', () => {
  it('rejects malformed messages', () => {
    expect(validateDrawingGuessMessage({})).toBeUndefined();
    expect(
      validateTopicCompatibleDrawingGuessMessage(createMessage({ payload: { nope: true } })),
    ).toBeUndefined();
  });

  it('ignores unsupported protocol versions', () => {
    expect(validateDrawingGuessMessage(createMessage({ protocolVersion: 999 }))).toBeUndefined();
  });
});

describe('MockDrawingGuessTransport', () => {
  it('connects multiple simulated players and delivers messages/presence', async () => {
    const transport = new MockDrawingGuessTransport();
    const p1 = await transport.connect({
      roomId: 'room-1',
      playerId: 'p1',
      displayName: 'Player 1',
    });
    const p2 = await transport.connect({
      roomId: 'room-1',
      playerId: 'p2',
      displayName: 'Player 2',
    });

    const receivedMessages: string[] = [];
    let presenceIds: string[] = [];

    p2.onMessage((message) => {
      if (message.topic === DRAWING_GUESS_TOPICS.chat) {
        receivedMessages.push((message.payload as { text: string }).text);
      }
    });
    p1.onPresence((players) => {
      presenceIds = players.map((player) => player.id);
    });

    await p1.publish(createMessage());

    expect(receivedMessages).toEqual(['hello']);
    expect(presenceIds).toEqual(['p1', 'p2']);

    await p2.disconnect();
    expect(presenceIds).toEqual(['p1']);
  });
});
