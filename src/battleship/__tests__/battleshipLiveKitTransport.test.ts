import { afterEach, describe, expect, it, vi } from 'vitest';

import { BATTLESHIP_PROTOCOL_VERSION, BATTLESHIP_TOPICS } from '../transport/constants';
import { createBattleshipTransport } from '../transport/createBattleshipTransport';
import { LiveKitBattleshipTransport, __testing } from '../transport/LiveKitBattleshipTransport';
import { createControlMessage } from '../transport/battleshipMessages';
import {
  decodeBattleshipLiveKitPayload,
  encodeBattleshipLiveKitPayload,
} from '../transport/liveKitBattleshipPayload';
import { requestBattleshipLiveKitConnectOptions } from '../transport/requestBattleshipLiveKitConnectOptions';
import { BattleshipOutboundMessage } from '../transport/types';

const connectOptions = {
  roomId: 'ROOM-1',
  playerId: 'local-user',
  displayName: 'Local User',
};

const createMessage = (): BattleshipOutboundMessage =>
  createControlMessage({
    matchId: 'match-1',
    messageId: 'message-1',
    senderId: 'local-user',
    clientTime: 1000,
    sequence: 1,
    payload: {
      type: 'lobby-announce',
      matchId: 'match-1',
      hostId: 'local-user',
      players: [
        {
          id: 'local-user',
          displayName: 'Local User',
          joinedAt: 1000,
          isConnected: true,
        },
      ],
    },
  });

describe('requestBattleshipLiveKitConnectOptions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('maps a valid token response into battleship connect options', async () => {
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
      requestBattleshipLiveKitConnectOptions(
        connectOptions,
        'https://token.example.test',
        async () => 'id-token-1',
      ),
    ).resolves.toEqual({
      ...connectOptions,
      serverUrl: 'wss://livekit.example.test',
      token: 'token-1',
    });
  });

  it('binds a voice-room launch to its isolated game session and Firebase identity', async () => {
    const sessionOptions = {
      ...connectOptions,
      sessionId: 'rgs_session_000000000001',
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          gameSessionId: sessionOptions.sessionId,
          participantId: sessionOptions.playerId,
          serverUrl: 'wss://livekit.example.test',
          token: 'token-1',
          transportRoomId: 'vrg_1234',
        }),
        { status: 200 },
      ),
    );

    await expect(
      requestBattleshipLiveKitConnectOptions(
        sessionOptions,
        'https://token.example.test',
        async () => 'id-token-1',
      ),
    ).resolves.toMatchObject(sessionOptions);

    const request = vi.mocked(globalThis.fetch).mock.calls[0][1];
    expect(JSON.parse(String(request?.body))).toEqual({
      roomId: 'ROOM-1',
      canPublishAudio: false,
      gameSessionId: sessionOptions.sessionId,
    });
  });

  it('rejects mismatched game transport identity', async () => {
    const sessionOptions = {
      ...connectOptions,
      sessionId: 'rgs_session_000000000001',
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          gameSessionId: sessionOptions.sessionId,
          participantId: 'other-user',
          serverUrl: 'wss://livekit.example.test',
          token: 'token-2',
          transportRoomId: 'vrg_1234',
        }),
        { status: 200 },
      ),
    );

    await expect(
      requestBattleshipLiveKitConnectOptions(
        sessionOptions,
        'https://token.example.test',
        async () => 'id-token-1',
      ),
    ).rejects.toThrow(/identity did not match/);
  });
});

describe('LiveKit battleship payloads', () => {
  it('round-trips control messages', () => {
    const message = createMessage();
    const encoded = encodeBattleshipLiveKitPayload(message);

    expect(decodeBattleshipLiveKitPayload(encoded, 2000)).toEqual({
      ...message,
      receivedAt: 2000,
      protocolVersion: BATTLESHIP_PROTOCOL_VERSION,
    });
    expect(decodeBattleshipLiveKitPayload(new TextEncoder().encode('{bad'), 2000)).toBeUndefined();
  });
});

describe('LiveKitBattleshipTransport', () => {
  it('connects, publishes reliable control, and reports presence', async () => {
    const room = createFakeLiveKitRoom();
    const transport = new LiveKitBattleshipTransport(
      () => room,
      async (options) => ({
        ...options,
        serverUrl: 'wss://livekit.example.test',
        token: 'token-1',
      }),
    );
    const connection = await transport.connect(connectOptions);
    const presenceSnapshots: number[] = [];

    connection.onPresence((players) => presenceSnapshots.push(players.length));
    await connection.publish(createMessage());

    expect(room.connectCalls).toEqual([['wss://livekit.example.test', 'token-1']]);
    expect(room.published[0].options).toEqual({
      reliable: true,
      topic: BATTLESHIP_TOPICS.control,
    });
    expect(presenceSnapshots[0]).toBe(2);
    expect(__testing.mapLiveKitPresenceParticipant({ identity: 'p1', name: 'Dana' })).toMatchObject({
      id: 'p1',
      displayName: 'Dana',
      isConnected: true,
    });

    await connection.disconnect();
    expect(room.disconnectCalls).toBe(1);
  });

  it('selects LiveKit transport for online mode', () => {
    expect(createBattleshipTransport('online')).toBeInstanceOf(LiveKitBattleshipTransport);
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
