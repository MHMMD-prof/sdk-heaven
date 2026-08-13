import { I18nManager, Pressable, StyleSheet, Text, View } from 'react-native';

import { EquipmentCosmeticAsset } from '../../components/EquipmentCosmeticAsset';
import type { EquipmentCosmeticProjection } from '../../cosmetics/equipmentCosmetics';
import type { CosmeticsFeatureFlags } from '../../cosmetics/featureFlags';
import { DirectChatAttachment } from '../DirectChatAttachment';
import type { DirectChatUiMessage } from '../directChatModels';
import type { ChatTimelineItem } from './buildMessageGroups';
import { chatColors, chatMetrics, chatTypography } from './chatTheme';

const ar = I18nManager.isRTL;
const tr = (arabic: string, english: string) => ar ? arabic : english;

export function ChatTimelineRow({
  cosmetics,
  item,
  messages,
  onMessageAction,
  peerBubble,
  peerName,
  peerReadSequence,
  selfBubble,
  uid,
}: {
  cosmetics: CosmeticsFeatureFlags;
  item: ChatTimelineItem;
  messages: DirectChatUiMessage[];
  onMessageAction: (message: DirectChatUiMessage) => void;
  peerBubble?: EquipmentCosmeticProjection;
  peerName: string;
  peerReadSequence: number;
  selfBubble?: EquipmentCosmeticProjection;
  uid: string;
}) {
  if (item.kind === 'date') return <DateSeparator dateKey={item.dateKey} />;
  if (item.kind === 'unread-boundary') return <Boundary label={tr('رسائل غير مقروءة', 'Unread messages')} />;
  if (item.kind === 'system') return <SystemEvent message={item.message} />;
  const mine = item.senderUid === uid;
  return (
    <View style={[styles.group, mine ? styles.mineGroup : styles.peerGroup]}>
      {item.messages.map((message, index) => (
        <MessageBubble
          bubble={mine ? selfBubble : peerBubble}
          cosmetics={cosmetics}
          isLast={index === item.messages.length - 1}
          key={message.id}
          message={message}
          messages={messages}
          mine={mine}
          onLongPress={() => onMessageAction(message)}
          peerName={peerName}
          peerReadSequence={peerReadSequence}
          uid={uid}
        />
      ))}
    </View>
  );
}

function MessageBubble({ bubble, cosmetics, isLast, message, messages, mine, onLongPress, peerName, peerReadSequence, uid }: {
  bubble?: EquipmentCosmeticProjection;
  cosmetics: CosmeticsFeatureFlags;
  isLast: boolean;
  message: DirectChatUiMessage;
  messages: DirectChatUiMessage[];
  mine: boolean;
  onLongPress: () => void;
  peerName: string;
  peerReadSequence: number;
  uid: string;
}) {
  const replied = message.replyToMessageId ? messages.find((candidate) => candidate.id === message.replyToMessageId) : undefined;
  const content = messageContent(message);
  const delivery = mine ? deliveryLabel(message, peerReadSequence) : '';
  const time = formatMessageTime(message.createdAtMs);
  const sender = mine ? tr('أنت', 'You') : peerName;
  return (
    <Pressable
      accessibilityHint={tr('اضغط مطولاً لخيارات الرسالة', 'Long press for message actions')}
      accessibilityLabel={[sender, accessibilityContent(message), time, delivery].filter(Boolean).join(', ')}
      accessibilityRole="text"
      delayLongPress={320}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.bubble, mine ? styles.mine : styles.theirs, message.deliveryState === 'failed' && styles.failed, pressed && styles.pressed]}
    >
      <EquipmentCosmeticAsset category="chat-bubble" enabled={cosmetics.chatBubbles} flags={cosmetics} projection={bubble} style={styles.cosmetic} />
      {message.replyToMessageId ? (
        <View style={styles.reply}>
          <Text numberOfLines={1} style={styles.replyLabel}>{replied ? (replied.senderUid === uid ? tr('أنت', 'You') : peerName) : tr('رسالة غير متاحة', 'Message unavailable')}</Text>
          <Text numberOfLines={2} style={styles.replyText}>{replied ? messageContent(replied) : tr('أزيلت الرسالة أو انتهت مدة الاحتفاظ بها.', 'The message was removed or expired under retention.')}</Text>
        </View>
      ) : null}
      <DirectChatAttachment flags={cosmetics} message={message} uid={uid} />
      {content ? <Text maxFontSizeMultiplier={2} selectable style={[styles.text, message.visibilityState !== 'visible' && styles.unavailable]}>{content}</Text> : null}
      {isLast || message.deliveryState !== 'sent' ? (
        <View style={styles.meta}>
          <Text style={styles.time}>{time}</Text>
          {delivery ? <Text style={[styles.delivery, message.deliveryState === 'failed' && styles.deliveryFailed]}>{delivery}</Text> : null}
        </View>
      ) : null}
    </Pressable>
  );
}

function DateSeparator({ dateKey }: { dateKey: string }) {
  const label = dateKey === 'unknown' ? tr('تاريخ غير متاح', 'Date unavailable') : new Intl.DateTimeFormat(ar ? 'ar-IQ' : 'en', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${dateKey}T12:00:00`));
  return <Boundary label={label} />;
}

function Boundary({ label }: { label: string }) {
  return <View accessibilityRole="text" style={styles.boundary}><View style={styles.line} /><Text style={styles.boundaryText}>{label}</Text><View style={styles.line} /></View>;
}

function SystemEvent({ message }: { message: DirectChatUiMessage }) {
  return <View accessibilityLabel={systemLabel(message)} style={styles.system}><Text style={styles.systemText}>{systemLabel(message)}</Text></View>;
}

export function formatMessageTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '';
  return new Intl.DateTimeFormat(ar ? 'ar-IQ' : 'en', { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

export function messageContent(message: DirectChatUiMessage) {
  if (message.visibilityState === 'unsent') return tr('تم إلغاء إرسال هذه الرسالة', 'This message was unsent');
  if (message.visibilityState === 'removed') return tr('أزيلت هذه الرسالة بقرار الإشراف', 'This message was removed by moderation');
  return message.text || '';
}

export function accessibilityContent(message: DirectChatUiMessage) {
  if (message.visibilityState !== 'visible') return messageContent(message);
  if (message.kind === 'image') return tr('صورة مشتركة', 'Shared image');
  if (message.kind === 'voice-note') return tr('رسالة صوتية', 'Voice message');
  if (message.kind === 'sticker') return tr('ملصق', 'Sticker');
  if (message.kind === 'emoji') return tr(`رمز تعبيري ${message.text}`, `Emoji ${message.text}`);
  return message.text || tr('مرفق غير متاح', 'Unavailable attachment');
}

function deliveryLabel(message: DirectChatUiMessage, peerReadSequence: number) {
  if (message.deliveryState === 'sending') return tr('جارٍ الإرسال', 'Sending');
  if (message.deliveryState === 'failed') return tr('فشل الإرسال', 'Failed');
  if (message.sequence <= peerReadSequence) return tr('تمت القراءة', 'Read');
  return tr('تم الإرسال', 'Sent');
}

function systemLabel(message: DirectChatUiMessage) {
  if (message.text) return message.text;
  const labels: Record<string, [string, string]> = {
    'request-accepted': ['تم قبول طلب المحادثة', 'Chat request accepted'],
    'request-expired': ['انتهت صلاحية طلب المحادثة', 'Chat request expired'],
    'request-rejected': ['تم رفض طلب المحادثة', 'Chat request rejected'],
  };
  const label = labels[message.systemType];
  return label ? tr(label[0], label[1]) : tr('تم تحديث المحادثة', 'Chat updated');
}

const styles = StyleSheet.create({
  boundary: { alignItems: 'center', flexDirection: 'row', gap: 10, marginVertical: 12 },
  boundaryText: { color: chatColors.textTertiary, fontSize: 11, fontWeight: '700' },
  bubble: { borderColor: chatColors.divider, borderRadius: 18, borderWidth: 1, gap: 6, maxWidth: chatMetrics.bubbleMaxWidth, minWidth: 92, overflow: 'hidden', paddingHorizontal: 13, paddingVertical: 9 },
  cosmetic: { bottom: 0, left: 0, opacity: 0.22, position: 'absolute', right: 0, top: 0 },
  delivery: { color: chatColors.goldBright, fontSize: 10, fontWeight: '700' },
  deliveryFailed: { color: chatColors.danger },
  failed: { borderColor: chatColors.danger },
  group: { gap: 3, marginVertical: 4, width: '100%' },
  line: { backgroundColor: chatColors.divider, flex: 1, height: 1 },
  meta: { alignItems: 'center', flexDirection: ar ? 'row-reverse' : 'row', gap: 7 },
  mine: { alignSelf: ar ? 'flex-start' : 'flex-end', backgroundColor: chatColors.surfaceOutgoing },
  mineGroup: { alignItems: ar ? 'flex-start' : 'flex-end' },
  peerGroup: { alignItems: ar ? 'flex-end' : 'flex-start' },
  pressed: { opacity: 0.78 },
  reply: { borderColor: chatColors.gold, borderRadius: 8, borderStartWidth: 3, gap: 2, paddingHorizontal: 8, paddingVertical: 5 },
  replyLabel: { color: chatColors.goldBright, fontSize: 10, fontWeight: '800', textAlign: ar ? 'right' : 'left' },
  replyText: { color: chatColors.textSecondary, fontSize: 11, textAlign: ar ? 'right' : 'left' },
  system: { alignSelf: 'center', backgroundColor: 'rgba(224,185,103,0.08)', borderColor: chatColors.divider, borderRadius: 14, borderWidth: 1, marginVertical: 8, paddingHorizontal: 14, paddingVertical: 7 },
  systemText: { color: chatColors.goldBright, fontSize: 11, fontWeight: '700', textAlign: 'center' },
  text: { ...chatTypography.body, color: chatColors.textPrimary, lineHeight: 21, textAlign: ar ? 'right' : 'left', writingDirection: ar ? 'rtl' : 'ltr' },
  theirs: { alignSelf: ar ? 'flex-end' : 'flex-start', backgroundColor: chatColors.surface },
  time: { color: chatColors.textTertiary, fontSize: 10 },
  unavailable: { color: chatColors.textSecondary, fontStyle: 'italic' },
});
