import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { colors, radius, spacing, typography } from '../../theme';
import { RoomChatMessage } from '../../voice/roomChat';
import type { CosmeticsFeatureFlags } from '../../cosmetics/featureFlags';
import { AvatarPresentation } from '../AvatarPresentation';
import { EquipmentCosmeticAsset } from '../EquipmentCosmeticAsset';
import { useEquipmentCosmetics } from '../../social/useEquipmentCosmetics';
import type { EquipmentCosmetics } from '../../cosmetics/equipmentCosmetics';
import { RoomSheet } from './VoiceRoomSheets';

type RoomChatSheetProps = {
  canManage: boolean;
  canSend: boolean;
  chatEnabled: boolean;
  cosmeticsFlags: CosmeticsFeatureFlags;
  currentUid?: string;
  errorMessage: string;
  hasOlderMessages: boolean;
  isLoadingOlder: boolean;
  messages: RoomChatMessage[];
  onBlock: (message: RoomChatMessage) => void;
  onClose: () => void;
  onDelete: (message: RoomChatMessage) => void;
  onLoadOlder: () => void;
  onOpenProfile: (uid: string) => void;
  onPin: (message: RoomChatMessage) => void;
  onReport: (message: RoomChatMessage) => void;
  onRetry: (message: RoomChatMessage) => void;
  onSend: (text: string) => Promise<unknown>;
  pinnedMessageId: string;
  safetyEnabled: boolean;
  visible: boolean;
};

export function RoomChatSheet({
  canManage,
  canSend,
  chatEnabled,
  cosmeticsFlags,
  currentUid,
  errorMessage,
  hasOlderMessages,
  isLoadingOlder,
  messages,
  onBlock,
  onClose,
  onDelete,
  onLoadOlder,
  onOpenProfile,
  onPin,
  onReport,
  onRetry,
  onSend,
  pinnedMessageId,
  safetyEnabled,
  visible,
}: RoomChatSheetProps) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const equipmentByUid = useEquipmentCosmetics(messages.map((message) => message.senderUid));
  const pinnedMessage = useMemo(
    () => messages.find((message) => message.id === pinnedMessageId && message.status === 'active'),
    [messages, pinnedMessageId],
  );
  const submit = async () => {
    const value = draft.trim();
    if (!value || sending) return;
    setSending(true);
    setDraft('');
    try {
      await onSend(value);
    } catch {
      setDraft(value);
    } finally {
      setSending(false);
    }
  };

  return (
    <RoomSheet onClose={onClose} title="دردشة الغرفة" visible={visible}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={24}
        style={styles.root}
      >
        {pinnedMessage ? (
          <View style={styles.pinned}>
            <SymbolView
              name={{ ios: 'pin.fill', android: 'push_pin', web: 'push_pin' }}
              size={14}
              tintColor={colors.goldSoft}
            />
            <View style={styles.pinnedCopy}>
              <Text style={styles.pinnedLabel}>الرسالة المثبتة</Text>
              <Text numberOfLines={2} style={styles.pinnedText}>{pinnedMessage.text}</Text>
            </View>
          </View>
        ) : null}

        <ScrollView
          contentContainerStyle={styles.messageList}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {hasOlderMessages ? (
            <Pressable
              accessibilityRole="button"
              disabled={isLoadingOlder}
              onPress={onLoadOlder}
              style={styles.loadOlder}
            >
              {isLoadingOlder ? <ActivityIndicator color={colors.goldSoft} size="small" /> : null}
              <Text style={styles.loadOlderText}>تحميل رسائل أقدم</Text>
            </Pressable>
          ) : null}
          {messages.map((message) => (
            <MessageRow
              canDelete={message.senderUid === currentUid || canManage}
              canManage={canManage}
              cosmeticsFlags={cosmeticsFlags}
              currentUid={currentUid}
              key={message.id}
              message={message}
              equipment={equipmentByUid[message.senderUid]}
              onBlock={() => onBlock(message)}
              onDelete={() => onDelete(message)}
              onOpenProfile={() => onOpenProfile(message.senderUid)}
              onPin={() => onPin(message)}
              onReport={() => onReport(message)}
              onRetry={() => onRetry(message)}
              pinned={message.id === pinnedMessageId}
              safetyEnabled={safetyEnabled}
            />
          ))}
          {!messages.length ? (
            <Text style={styles.emptyText}>
              {chatEnabled ? 'لا توجد رسائل بعد. ابدأ الحديث بلطف.' : 'الدردشة غير مفعّلة حالياً.'}
            </Text>
          ) : null}
        </ScrollView>

        {errorMessage ? (
          <Text accessibilityLiveRegion="polite" style={styles.errorText}>{errorMessage}</Text>
        ) : null}
        <View style={styles.composer}>
          <Pressable
            accessibilityLabel="إرسال الرسالة"
            accessibilityRole="button"
            disabled={!canSend || sending || !draft.trim()}
            onPress={() => { void submit(); }}
            style={({ pressed }) => [
              styles.send,
              (!canSend || sending || !draft.trim()) && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            {sending ? (
              <ActivityIndicator color="#251504" size="small" />
            ) : (
              <SymbolView
                name={{ ios: 'paperplane.fill', android: 'send', web: 'send' }}
                size={19}
                tintColor="#251504"
              />
            )}
          </Pressable>
          <TextInput
            accessibilityLabel="نص رسالة الغرفة"
            editable={canSend && !sending}
            maxLength={280}
            multiline
            onChangeText={setDraft}
            onSubmitEditing={() => { void submit(); }}
            placeholder={canSend ? 'اكتب رسالة…' : 'إرسال الرسائل غير متاح'}
            placeholderTextColor={colors.textSubtle}
            style={styles.input}
            textAlign="right"
            value={draft}
          />
        </View>
        <Text style={styles.counter}>{draft.length}/280</Text>
      </KeyboardAvoidingView>
    </RoomSheet>
  );
}

function MessageRow({
  canDelete,
  canManage,
  cosmeticsFlags,
  currentUid,
  message,
  equipment,
  onBlock,
  onDelete,
  onOpenProfile,
  onPin,
  onReport,
  onRetry,
  pinned,
  safetyEnabled,
}: {
  canDelete: boolean;
  canManage: boolean;
  cosmeticsFlags: CosmeticsFeatureFlags;
  currentUid?: string;
  message: RoomChatMessage;
  equipment?: EquipmentCosmetics;
  onBlock: () => void;
  onDelete: () => void;
  onOpenProfile: () => void;
  onPin: () => void;
  onReport: () => void;
  onRetry: () => void;
  pinned: boolean;
  safetyEnabled: boolean;
}) {
  const isOwn = message.senderUid === currentUid;
  const isNotice = message.kind === 'moderation' || message.kind === 'system';
  const deleted = message.status === 'deleted';
  return (
    <View style={[styles.message, isOwn && styles.ownMessage, isNotice && styles.noticeMessage]}>
      {!isNotice ? <EquipmentCosmeticAsset category="chat-bubble" enabled={cosmeticsFlags.chatBubbles} flags={cosmeticsFlags} projection={equipment?.chatBubble} style={styles.chatBubbleCosmetic} /> : null}
      <View style={styles.messageHeader}>
        <Text style={styles.messageStatus}>
          {message.deliveryStatus === 'pending'
            ? 'جارٍ الإرسال'
            : message.deliveryStatus === 'failed'
              ? 'فشل الإرسال'
              : pinned
                ? 'مثبتة'
                : ''}
        </Text>
        <View style={styles.senderNameShell}>
          {!isNotice ? <EquipmentCosmeticAsset category="nameplate" enabled={cosmeticsFlags.nameplates} flags={cosmeticsFlags} projection={equipment?.nameplate} style={styles.senderNameplate} /> : null}
        <Text numberOfLines={1} style={styles.sender}>
          {isNotice ? 'إشعار الغرفة' : message.senderDisplayName || 'عضو'}
        </Text>
          {!isNotice ? <EquipmentCosmeticAsset category="cosmetic-badge" enabled={cosmeticsFlags.cosmeticBadges} flags={cosmeticsFlags} projection={equipment?.cosmeticBadge} style={styles.senderCosmeticBadge} /> : null}
        </View>
        {!isNotice ? (
          <Pressable accessibilityRole="button" onPress={onOpenProfile} style={styles.senderAvatarButton}>
            <AvatarPresentation
              flags={cosmeticsFlags}
              frame={message.senderAvatarFrame}
              label={message.senderAvatarLabel || message.senderDisplayName}
              size={30}
            />
          </Pressable>
        ) : null}
      </View>
      <Text style={[styles.messageText, deleted && styles.deletedText]}>
        {deleted ? 'تم حذف هذه الرسالة.' : message.text}
      </Text>
      {!deleted ? (
        <View style={styles.actions}>
          {message.deliveryStatus === 'failed' ? (
            <ChatAction label="إعادة" onPress={onRetry} />
          ) : null}
          {canManage && message.deliveryStatus === 'sent' ? (
            <ChatAction label={pinned ? 'إلغاء التثبيت' : 'تثبيت'} onPress={onPin} />
          ) : null}
          {canDelete && message.deliveryStatus === 'sent' ? (
            <ChatAction danger label="حذف" onPress={onDelete} />
          ) : null}
          {safetyEnabled && !isOwn && !isNotice && message.deliveryStatus === 'sent' ? (
            <>
              <ChatAction label="إبلاغ" onPress={onReport} />
              <ChatAction label="حظر" onPress={onBlock} />
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function ChatAction({
  danger = false,
  label,
  onPress,
}: {
  danger?: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.action}>
      <Text style={[styles.actionText, danger && styles.dangerText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flexShrink: 1,
    minHeight: 400,
  },
  pinned: {
    alignItems: 'center',
    backgroundColor: 'rgba(232,190,97,0.10)',
    borderColor: colors.borderGold,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    padding: spacing.sm,
  },
  pinnedCopy: {
    flex: 1,
  },
  pinnedLabel: {
    color: colors.goldSoft,
    fontSize: 9,
    fontWeight: typography.weights.black,
    textAlign: 'right',
  },
  pinnedText: {
    color: colors.text,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  messageList: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  loadOlder: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.sm,
  },
  loadOlderText: {
    color: colors.goldSoft,
    fontSize: 10,
    fontWeight: typography.weights.bold,
  },
  message: {
    alignSelf: 'stretch',
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
    padding: spacing.sm,
  },
  ownMessage: {
    backgroundColor: 'rgba(232,190,97,0.10)',
    borderColor: 'rgba(232,190,97,0.30)',
  },
  noticeMessage: {
    backgroundColor: 'rgba(184,41,75,0.10)',
    borderColor: 'rgba(255,122,148,0.30)',
  },
  messageHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  messageStatus: {
    color: colors.textSubtle,
    fontSize: 8,
  },
  sender: {
    color: colors.goldSoft,
    flex: 1,
    fontSize: 10,
    fontWeight: typography.weights.black,
    textAlign: 'right',
  },
  chatBubbleCosmetic: { bottom: 0, left: 0, opacity: 0.46, position: 'absolute', right: 0, top: 0 },
  senderNameShell: { alignItems: 'center', flex: 1, flexDirection: 'row-reverse', position: 'relative' },
  senderNameplate: { bottom: 0, left: 0, opacity: 0.65, position: 'absolute', right: 0, top: 0 },
  senderCosmeticBadge: { height: 20, width: 20 },
  senderAvatarButton: {
    marginLeft: spacing.xs,
  },
  messageText: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  deletedText: {
    color: colors.textSubtle,
    fontStyle: 'italic',
  },
  actions: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  action: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 3,
  },
  actionText: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: typography.weights.bold,
  },
  dangerText: {
    color: '#FF9DB1',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 12,
    paddingVertical: spacing.xl,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  errorText: {
    color: '#FF9DB1',
    fontSize: 10,
    marginBottom: spacing.xs,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  composer: {
    alignItems: 'flex-end',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  input: {
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    color: colors.text,
    flex: 1,
    fontSize: 13,
    maxHeight: 92,
    minHeight: 46,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    writingDirection: 'rtl',
  },
  send: {
    alignItems: 'center',
    backgroundColor: colors.gold,
    borderRadius: radius.full,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  counter: {
    color: colors.textSubtle,
    fontSize: 8,
    marginTop: 2,
    textAlign: 'right',
  },
  disabled: {
    opacity: 0.42,
  },
  pressed: {
    opacity: 0.72,
  },
});
