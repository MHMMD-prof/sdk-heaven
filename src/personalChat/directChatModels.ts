import type { DirectChatRealtimeMessage, DirectChatRealtimeProjection } from './directChatRealtime';

export type DirectChatInboxPage = {
  action: 'get-direct-chat-inbox';
  hasMore: boolean;
  items: DirectChatRealtimeProjection[];
  nextCursor: string;
  requestId: string;
  totalUnreadCount?: number;
};

export type DirectChatThreadPage = {
  action: 'get-direct-chat-thread';
  conversationId: string;
  hasMore: boolean;
  messages: DirectChatRealtimeMessage[];
  nextCursor: string;
  requestId: string;
  targetUid: string;
};

export type DirectChatStatus = {
  accepted: boolean;
  action: 'get-direct-chat-status';
  canSendDirectly: boolean;
  conversationId: string;
  conversationState: string;
  isFriend: boolean;
  recipientUid: string;
  requestDirection: 'incoming' | 'outgoing' | 'none';
  requestId: string;
  requesterUid: string;
  requestStatus: string;
  requiresRequest: boolean;
  targetUid: string;
};

export type DirectChatUiMessage = DirectChatRealtimeMessage & {
  clientRequestId?: string;
  deliveryState?: 'failed' | 'sending' | 'sent';
};
