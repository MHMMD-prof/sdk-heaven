import type { DirectChatUiMessage } from '../directChatModels';

export type ChatMessageActionAvailability = {
  canCopy: boolean;
  canReply: boolean;
  canReport: boolean;
  canRetry: boolean;
  canUnsend: boolean;
};

export function buildMessageActionAvailability(message: DirectChatUiMessage, viewerUid: string): ChatMessageActionAvailability {
  const mine = message.senderUid === viewerUid;
  const visible = message.visibilityState === 'visible';
  return {
    canCopy: visible && Boolean(message.text),
    canReply: message.kind !== 'system',
    canReport: !mine && message.kind !== 'system' && message.deliveryState !== 'failed',
    canRetry: mine && message.deliveryState === 'failed',
    canUnsend: mine && message.deliveryState === 'sent' && visible,
  };
}
