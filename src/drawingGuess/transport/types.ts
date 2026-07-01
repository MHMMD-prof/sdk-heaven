import { DrawingGuessTopic } from '../model/types';

export type DrawingGuessPresencePlayer = {
  id: string;
  displayName: string;
  joinedAt: number;
  isConnected: boolean;
};

export type DrawingGuessMessageEnvelope<TPayload = unknown> = {
  protocolVersion: number;
  matchId: string;
  messageId: string;
  senderId: string;
  clientTime: number;
  sequence: number;
  topic: DrawingGuessTopic;
  payload: TPayload;
};

export type DrawingGuessOutboundMessage = DrawingGuessMessageEnvelope;

export type DrawingGuessInboundMessage = DrawingGuessMessageEnvelope & {
  receivedAt: number;
};

export type DrawingGuessConnectOptions = {
  roomId: string;
  playerId: string;
  displayName: string;
  matchId?: string;
};

export type DrawingGuessConnection = {
  localPlayerId: string;
  publish(message: DrawingGuessOutboundMessage): Promise<void>;
  onMessage(listener: (message: DrawingGuessInboundMessage) => void): () => void;
  onPresence(listener: (players: DrawingGuessPresencePlayer[]) => void): () => void;
  disconnect(): Promise<void>;
};

export type DrawingGuessTransport = {
  connect(options: DrawingGuessConnectOptions): Promise<DrawingGuessConnection>;
};
