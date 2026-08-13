import type { RoomChatMessage } from './roomChat';

export type RoomActivityPreview = {
  empty: boolean;
  icon: 'chat' | 'entry' | 'game' | 'gift' | 'notice';
  message?: RoomChatMessage;
  sender: string;
  text: string;
};

const ICONS: Record<RoomChatMessage['kind'], RoomActivityPreview['icon']> = {
  chat: 'chat',
  entry: 'entry',
  game: 'game',
  gift: 'gift',
  moderation: 'notice',
  system: 'notice',
};

export function resolveRoomActivityPreview(messages: RoomChatMessage[]): RoomActivityPreview {
  const message = [...messages]
    .reverse()
    .find((candidate) => candidate.status !== 'deleted');

  if (!message) {
    return {
      empty: true,
      icon: 'chat',
      sender: 'دردشة الغرفة',
      text: 'ابدأ الحديث مع الموجودين في الغرفة',
    };
  }

  const isNotice = message.kind === 'moderation' || message.kind === 'system';
  return {
    empty: false,
    icon: ICONS[message.kind],
    message,
    sender: isNotice ? 'إشعار الغرفة' : message.senderDisplayName?.trim() || 'عضو',
    text: message.text.trim() || 'نشاط جديد في الغرفة',
  };
}
