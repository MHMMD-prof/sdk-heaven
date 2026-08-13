import { validateTopicCompatibleBattleshipMessage } from './messageValidation';
import {
  BattleshipConnectOptions,
  BattleshipConnection,
  BattleshipInboundMessage,
  BattleshipOutboundMessage,
  BattleshipPresencePlayer,
  BattleshipTransport,
} from './types';

type MockRoom = {
  connections: Set<MockBattleshipConnection>;
};

/** Mock transport mirrors LiveKit: publishData is not echoed to the sender. */
export class MockBattleshipTransport implements BattleshipTransport {
  private rooms = new Map<string, MockRoom>();

  async connect(options: BattleshipConnectOptions): Promise<BattleshipConnection> {
    const room = this.getRoom(options.roomId);
    const connection = new MockBattleshipConnection(options, room);

    room.connections.add(connection);
    emitPresence(room);

    return connection;
  }

  private getRoom(roomId: string) {
    const existingRoom = this.rooms.get(roomId);

    if (existingRoom) {
      return existingRoom;
    }

    const room = {
      connections: new Set<MockBattleshipConnection>(),
    };
    this.rooms.set(roomId, room);

    return room;
  }
}

class MockBattleshipConnection implements BattleshipConnection {
  readonly localPlayerId: string;
  private readonly messageListeners = new Set<(message: BattleshipInboundMessage) => void>();
  private readonly presenceListeners = new Set<(players: BattleshipPresencePlayer[]) => void>();
  private isConnected = true;
  readonly presence: BattleshipPresencePlayer;

  constructor(
    options: BattleshipConnectOptions,
    private readonly room: MockRoom,
  ) {
    this.localPlayerId = options.playerId;
    this.presence = {
      id: options.playerId,
      displayName: options.displayName,
      joinedAt: Date.now(),
      isConnected: true,
    };
  }

  async publish(message: BattleshipOutboundMessage): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Naval Duel mock connection is disconnected.');
    }

    const validMessage = validateTopicCompatibleBattleshipMessage(message);

    if (!validMessage) {
      return;
    }

    const inboundMessage = {
      ...validMessage,
      receivedAt: Date.now(),
    };

    this.room.connections.forEach((connection) => {
      if (connection.isConnected && connection.localPlayerId !== this.localPlayerId) {
        connection.emitMessage(inboundMessage);
      }
    });
  }

  get connected() {
    return this.isConnected;
  }

  onMessage(listener: (message: BattleshipInboundMessage) => void) {
    this.messageListeners.add(listener);

    return () => this.messageListeners.delete(listener);
  }

  onPresence(listener: (players: BattleshipPresencePlayer[]) => void) {
    this.presenceListeners.add(listener);
    listener(getPresence(this.room));

    return () => this.presenceListeners.delete(listener);
  }

  async disconnect(): Promise<void> {
    if (!this.isConnected) {
      return;
    }

    this.isConnected = false;
    this.presence.isConnected = false;
    this.room.connections.delete(this);
    emitPresence(this.room);
  }

  emitMessage(message: BattleshipInboundMessage) {
    this.messageListeners.forEach((listener) => listener(message));
  }

  emitPresence(players: BattleshipPresencePlayer[]) {
    this.presenceListeners.forEach((listener) => listener(players));
  }
}

const getPresence = (room: MockRoom): BattleshipPresencePlayer[] =>
  Array.from(room.connections)
    .filter((connection) => connection.connected)
    .map((connection) => connection.presence);

const emitPresence = (room: MockRoom) => {
  const players = getPresence(room);
  room.connections.forEach((connection) => {
    if (connection.connected) {
      connection.emitPresence(players);
    }
  });
};
