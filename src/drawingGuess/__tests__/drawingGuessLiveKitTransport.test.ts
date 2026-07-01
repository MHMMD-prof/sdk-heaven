import { afterEach, describe, expect, it, vi } from 'vitest';

import { DRAWING_GUESS_PROTOCOL_VERSION, DRAWING_GUESS_TOPICS } from '../model/constants';
import { createDrawingGuessTransport } from '../transport/createDrawingGuessTransport';
import { LiveKitDrawingGuessTransport, __testing } from '../transport/LiveKitDrawingGuessTransport';
import { createControlMessage, createStrokePreviewMessage } from '../transport/drawingGuessMessages';
import {
  decodeDrawingGuessLiveKitPayload,
  encodeDrawingGuessLiveKitPayload,
} from '../transport/liveKitDrawingGuessPayload';
import { requestDrawingGuessLiveKitConnectOptions } from '../transport/requestDrawingGuessLiveKitConnectOptions';
import { DrawingGuessOutboundMessage } from '../transport/types';

const connectOptions = {
  roomId: 'DG-ROOM',
  playerId: 'local-user',
  displayName: 'Local User',
};

const createMessage = (): DrawingGuessOutboundMessage =>
  createControlMessage({
    matchId: 'match-1',
    messageId: 'message-1',
    senderId: 'local-user',
    clientTime: 1000,
    sequence: 1,
    payload: {
      type: 'start-match-applied',
      matchId: 'match-2',
      now: 1000,
    },
  });

describe('requestDrawingGuessLiveKitConnectOptions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('maps a valid token response into drawing connect options', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          serverUrl: 'wss://livekit.example.test',
          token: 'token-1',
        }),
        { status: 200 },
      ),
    );

    await expect(
      requestDrawingGuessLiveKitConnectOptions(connectOptions, 'https://token.example.test'),
    ).resolves.toEqual({
      ...connectOptions,
      serverUrl: 'wss://livekit.example.test',
      token: 'token-1',
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://token.example.test',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          roomId: 'DG-ROOM',
          userId: 'local-user',
          displayName: 'Local User',
          canPublishAudio: false,
        }),
      }),
    );
  });

  it('reports token timeout, network, bad status, and malformed response errors', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );

    const request = requestDrawingGuessLiveKitConnectOptions(connectOptions, 'https://token.example.test');
    const expectation = expect(request).rejects.toThrow('Drawing Guess token request timed out.');
    await vi.advanceTimersByTimeAsync(10000);
    await expectation;

    vi.useRealTimers();
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('nope'));
    await expect(
      requestDrawingGuessLiveKitConnectOptions(connectOptions, 'https://token.example.test'),
    ).rejects.toThrow('Drawing Guess token request failed.');

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{}', { status: 500 }));
    await expect(
      requestDrawingGuessLiveKitConnectOptions(connectOptions, 'https://token.example.test'),
    ).rejects.toThrow('Drawing Guess token request failed with status 500.');

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await expect(
      requestDrawingGuessLiveKitConnectOptions(connectOptions, 'https://token.example.test'),
    ).rejects.toThrow('Drawing Guess token response must include serverUrl and token.');
  });
});

describe('LiveKit drawing payloads', () => {
  it('encodes outbound envelopes and decodes valid inbound bytes', () => {
    const message = createMessage();
    const encoded = encodeDrawingGuessLiveKitPayload(message);

    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(decodeDrawingGuessLiveKitPayload(encoded, 2000)).toEqual({
      ...message,
      receivedAt: 2000,
    });
  });

  it('rejects malformed inbound bytes', () => {
    expect(decodeDrawingGuessLiveKitPayload(new TextEncoder().encode('{bad'), 2000)).toBeUndefined();
    expect(
      decodeDrawingGuessLiveKitPayload(
        new TextEncoder().encode(JSON.stringify({ protocolVersion: DRAWING_GUESS_PROTOCOL_VERSION })),
        2000,
      ),
    ).toBeUndefined();
  });
});

describe('LiveKitDrawingGuessTransport', () => {
  it('publishes reliable topic-tagged messages and maps presence', async () => {
    const room = createFakeLiveKitRoom();
    const transport = new LiveKitDrawingGuessTransport(
      () => room,
      async (options) => ({
        ...options,
        serverUrl: 'wss://livekit.example.test',
        token: 'token-1',
      }),
    );
    const connection = await transport.connect(connectOptions);
    const presenceUpdates: string[][] = [];

    connection.onPresence((players) => {
      presenceUpdates.push(players.map((player) => player.id));
    });
    await connection.publish(createMessage());

    expect(room.connectCalls).toEqual([
      ['wss://livekit.example.test', 'token-1'],
    ]);
    expect(room.published[0].options).toEqual({
      reliable: true,
      topic: DRAWING_GUESS_TOPICS.control,
    });
    expect(presenceUpdates[0]).toEqual(['local-user', 'remote-user']);
    expect(__testing.mapLiveKitPresenceParticipant({ identity: 'p1', name: 'Dana' })).toMatchObject({
      id: 'p1',
      displayName: 'Dana',
      isConnected: true,
    });
  });

  it('publishes stroke previews as lossy and keeps other topics reliable', async () => {
    const room = createFakeLiveKitRoom();
    const transport = new LiveKitDrawingGuessTransport(
      () => room,
      async (options) => ({
        ...options,
        serverUrl: 'wss://livekit.example.test',
        token: 'token-1',
      }),
    );
    const connection = await transport.connect(connectOptions);

    await connection.publish(
      createStrokePreviewMessage({
        matchId: 'match-1',
        messageId: 'preview-1',
        senderId: 'local-user',
        clientTime: 1000,
        sequence: 2,
        payload: {
          type: 'stroke-preview',
          strokeId: 'stroke-1',
          authorId: 'local-user',
          tool: 'brush',
          color: '#111827',
          width: 8,
          revision: 1,
          points: [{ x: 0.2, y: 0.2 }],
          status: 'begin',
        },
      }),
    );
    await connection.publish(createMessage());

    expect(room.published[0].options).toEqual({
      reliable: false,
      topic: DRAWING_GUESS_TOPICS.strokePreview,
    });
    expect(room.published[1].options).toEqual({
      reliable: true,
      topic: DRAWING_GUESS_TOPICS.control,
    });
    expect(__testing.isReliableDrawingGuessTopic(DRAWING_GUESS_TOPICS.strokePreview)).toBe(false);
    expect(__testing.isReliableDrawingGuessTopic(DRAWING_GUESS_TOPICS.snapshot)).toBe(true);
  });

  it('decodes data received events and disconnects cleanly', async () => {
    const room = createFakeLiveKitRoom();
    const transport = new LiveKitDrawingGuessTransport(
      () => room,
      async (options) => ({
        ...options,
        serverUrl: 'wss://livekit.example.test',
        token: 'token-1',
      }),
    );
    const connection = await transport.connect(connectOptions);
    const receivedMessages: string[] = [];

    connection.onMessage((message) => receivedMessages.push(message.messageId));
    room.emit('dataReceived', encodeDrawingGuessLiveKitPayload(createMessage()), {
      identity: 'local-user',
      name: 'Local User',
    });
    room.emit('dataReceived', new TextEncoder().encode('{bad'), {
      identity: 'local-user',
      name: 'Local User',
    });

    expect(receivedMessages).toEqual(['message-1']);

    await connection.disconnect();
    expect(room.disconnectCalls).toBe(1);
    expect(room.removedAllListeners).toBe(true);
  });

  it('selects LiveKit transport for online mode', () => {
    expect(createDrawingGuessTransport('online')).toBeInstanceOf(LiveKitDrawingGuessTransport);
  });
});

function createFakeLiveKitRoom() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const fakeRoom = {
    connectCalls: [] as string[][],
    disconnectCalls: 0,
    removedAllListeners: false,
    published: [] as Array<{ data: Uint8Array; options?: { reliable?: boolean; topic?: string } }>,
    localParticipant: {
      identity: 'local-user',
      name: 'Local User',
      publishData: vi.fn(async (data: Uint8Array, options?: { reliable?: boolean; topic?: string }) => {
        fakeRoom.published.push({ data, options });
      }),
    },
    remoteParticipants: new Map([
      ['remote-user', { identity: 'remote-user', name: 'Remote User' }],
    ]),
    async connect(serverUrl: string, token: string) {
      fakeRoom.connectCalls.push([serverUrl, token]);
    },
    disconnect() {
      fakeRoom.disconnectCalls += 1;
    },
    on(event: string, listener: (...args: unknown[]) => void) {
      const eventListeners = listeners.get(event) ?? new Set();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
      return fakeRoom;
    },
    off(event: string, listener: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(listener);
      return fakeRoom;
    },
    removeAllListeners() {
      fakeRoom.removedAllListeners = true;
      listeners.clear();
      return fakeRoom;
    },
    emit(event: string, ...args: unknown[]) {
      listeners.get(event)?.forEach((listener) => listener(...args));
    },
  };

  return fakeRoom;
}
