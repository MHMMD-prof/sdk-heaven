import { BATTLESHIP_TOPICS } from './constants';

export type BattleshipTopic = (typeof BATTLESHIP_TOPICS)[keyof typeof BATTLESHIP_TOPICS];

export type BattleshipPresencePlayer = {
  id: string;
  displayName: string;
  joinedAt: number;
  isConnected: boolean;
};

export type BattleshipMessageEnvelope<TPayload = unknown> = {
  protocolVersion: number;
  matchId: string;
  messageId: string;
  senderId: string;
  clientTime: number;
  sequence: number;
  topic: BattleshipTopic;
  payload: TPayload;
};

export type BattleshipOutboundMessage = BattleshipMessageEnvelope;

export type BattleshipInboundMessage = BattleshipMessageEnvelope & {
  receivedAt: number;
};

export type BattleshipConnectOptions = {
  roomId: string;
  playerId: string;
  displayName: string;
  matchId?: string;
  sessionId?: string;
};

export type BattleshipConnection = {
  localPlayerId: string;
  publish(message: BattleshipOutboundMessage): Promise<void>;
  onMessage(listener: (message: BattleshipInboundMessage) => void): () => void;
  onPresence(listener: (players: BattleshipPresencePlayer[]) => void): () => void;
  disconnect(): Promise<void>;
};

export type BattleshipTransport = {
  connect(options: BattleshipConnectOptions): Promise<BattleshipConnection>;
};
