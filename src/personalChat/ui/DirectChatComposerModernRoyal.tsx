import { useState, type RefObject } from 'react';
import { I18nManager, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { DirectChatUiMessage } from '../directChatModels';
import { triggerChatSelectionFeedback, triggerChatSuccessFeedback, triggerChatWarningFeedback } from './chatFeedback';
import { ChatAttachmentTray } from './ChatAttachmentTray';
import { ChatIcon } from './ChatIcon';
import { chatColors, chatMetrics } from './chatTheme';
import { buildComposerState } from './buildComposerState';

const ar = I18nManager.isRTL;
const tr = (arabic: string, english: string) => ar ? arabic : english;

export function DirectChatComposerModernRoyal({
  accepted,
  bottomInset,
  draft,
  inputRef,
  mediaDisabled,
  onCancelReply,
  onChangeDraft,
  onCompleteAttachment,
  onEmoji,
  onHeightChange,
  onSend,
  onSticker,
  reply,
  requestIncoming,
  requestOutgoing,
  statusReady,
  targetUid,
}: {
  accepted: boolean;
  bottomInset: number;
  draft: string;
  inputRef?: RefObject<TextInput | null>;
  mediaDisabled: boolean;
  onCancelReply: () => void;
  onChangeDraft: (value: string) => void;
  onCompleteAttachment: () => Promise<unknown>;
  onEmoji: (emoji: string) => Promise<boolean>;
  onHeightChange?: (height: number) => void;
  onSend: () => Promise<boolean>;
  onSticker: (itemId: string) => Promise<boolean>;
  reply?: DirectChatUiMessage;
  requestIncoming: boolean;
  requestOutgoing: boolean;
  statusReady: boolean;
  targetUid: string;
}) {
  const [trayOpen, setTrayOpen] = useState(false);
  const state = buildComposerState({ accepted, draft, requestIncoming, requestOutgoing, statusReady });

  if (state.mode === 'incoming-request' || state.mode === 'outgoing-request') {
    return (
      <View onLayout={(event) => onHeightChange?.(event.nativeEvent.layout.height)} style={[styles.root, { paddingBottom: bottomInset }]}>
        <View accessibilityRole="summary" style={styles.locked}>
          <ChatIcon color={chatColors.gold} name="message" size={19} />
          <View style={styles.lockedCopy}>
            <Text style={styles.lockedTitle}>{state.mode === 'incoming-request' ? tr('اقبل الطلب للرد', 'Accept the request to reply') : tr('بانتظار قبول الطلب', 'Waiting for approval')}</Text>
            <Text style={styles.lockedBody}>{state.mode === 'incoming-request' ? tr('لن يتمكن المرسل من إرسال المزيد حتى تتخذ قراراً.', 'The sender cannot send more until you decide.') : tr('أرسلت الرسالة الوحيدة المسموحة مع الطلب. سنفتح المحرر عند القبول.', 'You sent the one message allowed with the request. The composer unlocks after acceptance.')}</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View onLayout={(event) => onHeightChange?.(event.nativeEvent.layout.height)} style={[styles.root, { paddingBottom: bottomInset }]}>
      {reply ? (
        <View style={styles.reply}>
          <View style={styles.replyCopy}>
            <Text style={styles.replyLabel}>{tr('رد على رسالة', 'Replying to a message')}</Text>
            <Text numberOfLines={1} style={styles.replyText}>{reply.text || tr('رسالة غير متاحة', 'Message unavailable')}</Text>
          </View>
          <Pressable accessibilityLabel={tr('إلغاء الرد', 'Cancel reply')} accessibilityRole="button" onPress={() => { onCancelReply(); triggerChatSelectionFeedback(); }} style={styles.iconButton}>
            <ChatIcon color={chatColors.textSecondary} name="close" size={18} />
          </Pressable>
        </View>
      ) : null}
      {state.mode === 'request' ? <Text style={styles.requestHint}>{tr('ستُرسل هذه الرسالة كطلب محادثة واحد.', 'This message will be sent as your single chat request.')}</Text> : null}
      {state.mode === 'loading' ? <Text accessibilityLiveRegion="polite" style={styles.requestHint}>{tr('جارٍ تجهيز المحادثة…', 'Preparing conversation…')}</Text> : null}
      <ChatAttachmentTray
        disabled={!accepted}
        mediaDisabled={mediaDisabled}
        onClose={() => setTrayOpen(false)}
        onComplete={onCompleteAttachment}
        onEmoji={onEmoji}
        onSticker={onSticker}
        open={trayOpen}
        replyToMessageId={reply?.id}
        targetUid={targetUid}
      />
      <View style={styles.row}>
        <Pressable
          accessibilityLabel={tr('إضافة مرفق أو رمز', 'Add attachment or emoji')}
          accessibilityRole="button"
          accessibilityState={{ disabled: !state.canOpenAttachments }}
          disabled={!state.canOpenAttachments}
          onPress={() => {
            setTrayOpen(true);
            triggerChatSelectionFeedback();
          }}
          style={({ pressed }) => [styles.attach, !state.canOpenAttachments && styles.disabled, pressed && styles.pressed]}
        >
          <ChatIcon color={chatColors.goldBright} name="attach" size={21} />
        </Pressable>
        <TextInput
          accessibilityLabel={tr('نص الرسالة', 'Message text')}
          maxLength={2_000}
          multiline
          onChangeText={onChangeDraft}
          placeholder={state.mode === 'accepted' ? tr('اكتب رسالة…', 'Write a message…') : state.mode === 'request' ? tr('اكتب رسالة طلب واحدة…', 'Write one request message…') : tr('جارٍ التحميل…', 'Loading…')}
          placeholderTextColor={chatColors.textTertiary}
          readOnly={!state.canEditText}
          ref={inputRef}
          style={styles.input}
          value={draft}
        />
        <Pressable
          accessibilityLabel={accepted ? tr('إرسال الرسالة', 'Send message') : tr('إرسال طلب المحادثة', 'Send chat request')}
          accessibilityRole="button"
          accessibilityState={{ disabled: !state.canSend }}
          disabled={!state.canSend}
          onPress={() => {
            triggerChatSelectionFeedback();
            void onSend().then((sent) => sent ? triggerChatSuccessFeedback() : triggerChatWarningFeedback());
          }}
          style={({ pressed }) => [styles.send, !state.canSend && styles.disabled, pressed && styles.pressed]}
        >
          <ChatIcon color={chatColors.goldForeground} name="send" size={21} />
        </Pressable>
      </View>
      {draft.length > 1_800 ? <Text accessibilityLiveRegion="polite" style={[styles.counter, draft.length >= 2_000 && styles.counterLimit]}>{draft.length}/2000</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  attach: { alignItems: 'center', borderColor: chatColors.divider, borderRadius: 22, borderWidth: 1, height: chatMetrics.controlMinHeight, justifyContent: 'center', width: chatMetrics.controlMinHeight },
  counter: { color: chatColors.goldBright, fontSize: 10, textAlign: ar ? 'left' : 'right' },
  counterLimit: { color: chatColors.danger, fontWeight: '800' },
  disabled: { opacity: 0.34 },
  iconButton: { alignItems: 'center', height: chatMetrics.controlMinHeight, justifyContent: 'center', width: chatMetrics.controlMinHeight },
  input: { backgroundColor: chatColors.canvas, borderColor: chatColors.divider, borderRadius: 19, borderWidth: 1, color: chatColors.textPrimary, flex: 1, fontSize: 15, lineHeight: 21, maxHeight: chatMetrics.composerInputMaxHeight, minHeight: chatMetrics.controlMinHeight, minWidth: 0, paddingHorizontal: 14, paddingVertical: 10, textAlign: ar ? 'right' : 'left', writingDirection: ar ? 'rtl' : 'ltr' },
  locked: { alignItems: 'center', backgroundColor: chatColors.surface, borderColor: chatColors.divider, borderRadius: 15, borderWidth: 1, flexDirection: ar ? 'row-reverse' : 'row', gap: 10, paddingHorizontal: 13, paddingVertical: 10 },
  lockedBody: { color: chatColors.textSecondary, fontSize: 11, lineHeight: 16, textAlign: ar ? 'right' : 'left' },
  lockedCopy: { flex: 1, gap: 2 },
  lockedTitle: { color: chatColors.goldBright, fontSize: 13, fontWeight: '800', textAlign: ar ? 'right' : 'left' },
  pressed: { opacity: 0.76, transform: [{ scale: 0.97 }] },
  reply: { alignItems: 'center', backgroundColor: chatColors.surface, borderColor: chatColors.divider, borderRadius: 13, borderWidth: 1, flexDirection: ar ? 'row-reverse' : 'row', gap: 8, paddingStart: 11 },
  replyCopy: { borderStartColor: chatColors.gold, borderStartWidth: 3, flex: 1, gap: 2, paddingStart: 8, paddingVertical: 7 },
  replyLabel: { color: chatColors.goldBright, fontSize: 10, fontWeight: '800', textAlign: ar ? 'right' : 'left' },
  replyText: { color: chatColors.textSecondary, fontSize: 11, textAlign: ar ? 'right' : 'left' },
  requestHint: { color: chatColors.goldBright, fontSize: 11, textAlign: 'center' },
  root: { backgroundColor: chatColors.canvasRaised, borderTopColor: chatColors.divider, borderTopWidth: 1, gap: 7, paddingHorizontal: 12, paddingTop: 8 },
  row: { alignItems: 'flex-end', flexDirection: ar ? 'row-reverse' : 'row', gap: 8 },
  send: { alignItems: 'center', backgroundColor: chatColors.gold, borderRadius: 22, height: chatMetrics.controlMinHeight, justifyContent: 'center', width: chatMetrics.controlMinHeight },
});
