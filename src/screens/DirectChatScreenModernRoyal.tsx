import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  I18nManager,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../auth/AuthProvider';
import { useCosmeticsFeatureFlags } from '../cosmetics/featureFlags';
import { useStatusFeatureFlags } from '../status/featureFlags';
import { clearDirectChatDraft, readDirectChatDraft, writeDirectChatDraft } from '../personalChat/directChatDrafts';
import { DirectChatReportSheet } from '../personalChat/DirectChatReportSheet';
import { DIRECT_CHAT_MAX_REPORT_MESSAGES, type DirectChatReportCategory } from '../personalChat/directChatContract';
import { directChatCopy } from '../personalChat/directChatCopy';
import type { DirectChatUiMessage } from '../personalChat/directChatModels';
import { useDirectChats } from '../personalChat/DirectChatProvider';
import {
  buildMessageGroups,
  buildMessageActionAvailability,
  ChatAvatar,
  ChatIcon,
  ChatMessageActionSheet,
  ChatRequestDecisionCard,
  ChatRoyalBackdrop,
  ChatTimelineRow,
  ChatTopBar,
  ChatThreadCanvas,
  DirectChatComposerModernRoyal,
  chatColors,
  chatMetrics,
  type ChatMessageAction,
  type ChatTimelineItem,
} from '../personalChat/ui';
import { useDirectChatThread } from '../personalChat/useDirectChatThread';
import { usePublicProfile } from '../social/usePublicProfile';
import { requestBlockMutation } from '../social/requestSocialCommand';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'DirectChat'>;
const ar = I18nManager.isRTL;
const tr = (arabic: string, english: string) => ar ? arabic : english;
const copy = directChatCopy(ar ? 'ar' : 'en');

export function DirectChatScreenModernRoyal({ navigation, route }: Props) {
  const { user } = useAuth();
  const inbox = useDirectChats();
  const insets = useSafeAreaInsets();
  const cosmetics = useCosmeticsFeatureFlags();
  const statusFlags = useStatusFeatureFlags();
  const profileState = usePublicProfile(route.params.targetUid);
  const selfProfileState = usePublicProfile(user?.uid);
  const thread = useDirectChatThread(route.params.targetUid);
  const [draft, setDraft] = useState('');
  const [draftReady, setDraftReady] = useState(false);
  const [reply, setReply] = useState<DirectChatUiMessage>();
  const [selected, setSelected] = useState<DirectChatUiMessage>();
  const [reportMessageIds, setReportMessageIds] = useState<string[]>([]);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [unreadAfterSequence, setUnreadAfterSequence] = useState<number>();
  const listRef = useRef<FlatList<ChatTimelineItem>>(null);
  const typingActive = useRef(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const nearBottom = useRef(true);
  const initialPositioned = useRef(false);
  const previousLastMessageId = useRef('');
  const inputRef = useRef<TextInput>(null);
  const composerHeight = useRef(0);

  const displayName = profileState.profile?.displayName || tr('مستخدم', 'User');
  const requestIncoming = thread.status?.requestStatus === 'pending' && thread.status.requestDirection === 'incoming';
  const requestOutgoing = thread.status?.requestStatus === 'pending' && thread.status.requestDirection === 'outgoing';

  useEffect(() => {
    if (unreadAfterSequence === undefined && thread.projection?.unreadCount) {
      setUnreadAfterSequence(thread.projection.lastReadSequence);
    }
  }, [thread.projection?.lastReadSequence, thread.projection?.unreadCount, unreadAfterSequence]);

  const timeline = useMemo(() => buildMessageGroups({
    messages: thread.messages,
    unreadAfterSequence,
    viewerUid: user?.uid || '',
  }), [thread.messages, unreadAfterSequence, user?.uid]);

  useEffect(() => {
    if (!user?.uid || !thread.conversationId) return undefined;
    let active = true;
    setDraftReady(false);
    void readDirectChatDraft(user.uid, thread.conversationId).then((value) => {
      if (active) {
        setDraft(value);
        setDraftReady(true);
      }
    }).catch(() => {
      if (active) {
        setDraft('');
        setDraftReady(true);
      }
    });
    return () => { active = false; };
  }, [thread.conversationId, user?.uid]);

  useEffect(() => {
    if (!draftReady || !user?.uid || !thread.conversationId) return undefined;
    const timer = setTimeout(() => {
      void writeDirectChatDraft(user.uid, thread.conversationId, draft).catch(() => undefined);
    }, 350);
    return () => clearTimeout(timer);
  }, [draft, draftReady, thread.conversationId, user?.uid]);

  useEffect(() => () => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
    if (typingActive.current) thread.setTyping(false);
  }, [thread.setTyping]);

  useEffect(() => {
    const last = thread.messages.at(-1);
    if (!last || thread.loading) return;
    if (!initialPositioned.current) {
      initialPositioned.current = true;
      previousLastMessageId.current = last.id;
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
      return;
    }
    if (last.id === previousLastMessageId.current) return;
    previousLastMessageId.current = last.id;
    if (nearBottom.current || last.senderUid === user?.uid) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
      setNewMessageCount(0);
    } else {
      setNewMessageCount((value) => value + 1);
    }
  }, [thread.loading, thread.messages, user?.uid]);

  const updateDraft = (value: string) => {
    setDraft(value);
    if (value.trim() && !typingActive.current) {
      typingActive.current = true;
      thread.setTyping(true);
    }
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      typingActive.current = false;
      thread.setTyping(false);
    }, 2_500);
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || text.length > 2_000) return false;
    const replyId = reply?.id || '';
    setDraft('');
    setReply(undefined);
    thread.setTyping(false);
    typingActive.current = false;
    if (user?.uid && thread.conversationId) {
      void clearDirectChatDraft(user.uid, thread.conversationId).catch(() => undefined);
    }
    const sent = await thread.send(text, replyId);
    if (!sent) setDraft((current) => current.trim() ? current : text);
    return sent;
  };

  const submitReport = async (category: DirectChatReportCategory, details: string) => {
    await thread.report(category, reportMessageIds, details);
    setReportMessageIds([]);
    Alert.alert(tr('تم إرسال البلاغ', 'Report sent'), tr('استلم فريق السلامة الرسائل المحددة للمراجعة.', 'The safety team received the selected messages for review.'));
  };

  const reportPeerMessages = () => {
    const ids = thread.messages
      .filter((message) => message.senderUid === route.params.targetUid && message.deliveryState !== 'failed' && message.kind !== 'system')
      .slice(-DIRECT_CHAT_MAX_REPORT_MESSAGES)
      .map((message) => message.id);
    if (!ids.length) return Alert.alert(tr('الإبلاغ', 'Report'), tr('لا توجد رسالة قابلة للإبلاغ.', 'There is no reportable message.'));
    setReportMessageIds(ids);
  };

  const blockUser = () => Alert.alert(
    tr('حظر المستخدم', 'Block user'),
    tr('ستتوقف الرسائل والطلبات وستبقى المحادثة مرئية لك.', 'Messages and requests will stop; your chat history remains visible.'),
    [
      { style: 'cancel', text: tr('إلغاء', 'Cancel') },
      {
        onPress: () => void requestBlockMutation('block-user', route.params.targetUid).then((result) => {
          if (!result.ok) throw new Error(result.error.messageAr);
          navigation.goBack();
        }).catch((error) => Alert.alert(tr('تعذر الحظر', 'Unable to block'), error instanceof Error ? error.message : tr('حاول مرة أخرى.', 'Try again.'))),
        style: 'destructive',
        text: tr('حظر', 'Block'),
      },
    ],
  );

  const messageActions = useMemo<ChatMessageAction[]>(() => {
    if (!selected) return [];
    const availability = buildMessageActionAvailability(selected, user?.uid || '');
    return [
      ...(availability.canReply ? [{ id: 'reply' as const, label: tr('رد', 'Reply'), onPress: () => setReply(selected) }] : []),
      ...(availability.canCopy ? [{ id: 'copy' as const, label: tr('نسخ النص', 'Copy text'), onPress: () => void Clipboard.setStringAsync(selected.text) }] : []),
      ...(availability.canRetry ? [{ id: 'retry' as const, label: tr('إعادة الإرسال', 'Retry send'), onPress: () => void thread.send(selected.text, selected.replyToMessageId, selected.clientRequestId) }] : []),
      ...(availability.canUnsend ? [{
        danger: true,
        id: 'unsend' as const,
        label: tr('إلغاء الإرسال', 'Unsend'),
        onPress: () => Alert.alert(tr('إلغاء إرسال الرسالة؟', 'Unsend message?'), tr('سيظهر للطرفين أن الرسالة أُلغيت.', 'Both participants will see that the message was unsent.'), [
          { style: 'cancel', text: tr('إلغاء', 'Cancel') },
          { onPress: () => void thread.unsend(selected.id).catch((error) => Alert.alert(tr('تعذر إلغاء الإرسال', 'Unable to unsend'), error.message)), style: 'destructive', text: tr('إلغاء الإرسال', 'Unsend') },
        ]),
      }] : []),
      ...(availability.canReport ? [{ danger: true, id: 'report' as const, label: tr('إبلاغ', 'Report'), onPress: () => setReportMessageIds([selected.id]) }] : []),
    ];
  }, [selected, thread, user?.uid]);

  const subtitle = thread.peerTyping
    ? tr('يكتب الآن…', 'Typing…')
    : thread.peerOnline
      ? tr('متصل الآن', 'Online')
      : requestIncoming
        ? tr('طلب محادثة وارد', 'Incoming chat request')
        : requestOutgoing
          ? tr('بانتظار قبول الطلب', 'Waiting for approval')
          : tr('محادثة خاصة', 'Private chat');

  return (
    <View style={styles.root}>
      <ChatRoyalBackdrop />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0} style={styles.foreground}>
        <View style={{ paddingTop: insets.top }}>
          <ChatTopBar
            actionIcon="more"
            actionLabel={tr('خيارات المحادثة', 'Chat options')}
            leading={(
              <View style={styles.leading}>
                <Pressable accessibilityLabel={tr('رجوع', 'Back')} accessibilityRole="button" onPress={navigation.goBack} style={styles.headerButton}>
                  <ChatIcon color={chatColors.goldBright} name="back" size={20} />
                </Pressable>
                <Pressable accessibilityLabel={tr(`فتح ملف ${displayName}`, `Open ${displayName}'s profile`)} onPress={() => navigation.navigate('UserProfile', { uid: route.params.targetUid })}>
                  <ChatAvatar
                    avatarUrl={profileState.profile?.avatarModerationStatus === 'clear' ? profileState.profile.avatarUrl : ''}
                    flags={cosmetics}
                    frame={profileState.profile?.equippedAvatarFrame}
                    label={displayName}
                    online={thread.peerOnline}
                    onlineAccessibilityLabel={tr('متصل الآن', 'Online')}
                    size={chatMetrics.avatarThread + 4}
                  />
                </Pressable>
              </View>
            )}
            onAction={() => Alert.alert(tr('خيارات المحادثة', 'Chat options'), '', [
              { onPress: () => navigation.navigate('UserProfile', { uid: route.params.targetUid }), text: tr('فتح الملف الشخصي', 'Open profile') },
              { onPress: reportPeerMessages, text: tr('إبلاغ عن المحادثة', 'Report chat') },
              { onPress: blockUser, style: 'destructive', text: tr('حظر المستخدم', 'Block user') },
              { style: 'cancel', text: tr('إلغاء', 'Cancel') },
            ])}
            subtitle={subtitle}
            title={displayName}
          />
        </View>

        {!inbox.enabled ? <CenteredState body={copy.unavailableBody} title={copy.unavailableTitle} /> : null}
        {inbox.enabled && thread.errorMessage ? (
          <Pressable accessibilityRole="button" onPress={() => void thread.loadInitial()} style={styles.errorBanner}>
            <Text numberOfLines={2} style={styles.errorText}>{thread.errorMessage} — {tr('اضغط للمحاولة', 'tap to retry')}</Text>
          </Pressable>
        ) : null}
        {inbox.enabled && requestIncoming ? (
          <ChatRequestDecisionCard
            acceptLabel={tr('قبول', 'Accept')}
            blockLabel={tr('حظر', 'Block')}
            body={tr('لن يتمكن المرسل من إرسال المزيد حتى تقبل الطلب. يمكنك الإبلاغ أو الحظر قبل القبول.', 'The sender cannot send more until you accept. You can report or block before accepting.')}
            busy={thread.loading}
            onAccept={() => void thread.decideRequest('accept').catch((error) => Alert.alert(tr('تعذر القبول', 'Unable to accept'), error.message))}
            onBlock={blockUser}
            onReject={() => Alert.alert(tr('رفض طلب المحادثة؟', 'Reject chat request?'), tr('لن يتمكن المرسل من متابعة هذه المحادثة.', 'The sender will not be able to continue this request.'), [
              { style: 'cancel', text: tr('إلغاء', 'Cancel') },
              { onPress: () => void thread.decideRequest('reject').catch((error) => Alert.alert(tr('تعذر الرفض', 'Unable to reject'), error.message)), style: 'destructive', text: tr('رفض', 'Reject') },
            ])}
            onReport={reportPeerMessages}
            rejectLabel={tr('رفض', 'Reject')}
            reportLabel={tr('إبلاغ', 'Report')}
            title={tr('هذا المستخدم يريد بدء محادثة', 'This user wants to start a chat')}
          />
        ) : null}

        {inbox.enabled && thread.loading ? (
          <View style={styles.center}><ActivityIndicator color={chatColors.gold} size="large" /></View>
        ) : inbox.enabled ? (
          <ChatThreadCanvas>
            <FlatList
              contentContainerStyle={[styles.timeline, timeline.length === 0 && styles.emptyTimeline]}
              data={timeline}
              initialNumToRender={14}
              keyExtractor={(item) => item.id}
              ListEmptyComponent={<CenteredState body={tr('المحادثة مرئية للمشاركين فقط وليست مشفرة من طرف إلى طرف.', 'This chat is visible only to participants and is not end-to-end encrypted.')} title={requestOutgoing ? tr('تم إرسال طلب المحادثة', 'Chat request sent') : tr('ابدأ محادثة جديدة', 'Start a new conversation')} />}
              ListHeaderComponent={thread.hasMore ? (
                <Pressable accessibilityRole="button" disabled={thread.loadingOlder} onPress={() => void thread.loadOlder()} style={styles.loadOlder}>
                  {thread.loadingOlder ? <ActivityIndicator color={chatColors.gold} /> : <Text style={styles.loadOlderText}>{tr('تحميل رسائل أقدم', 'Load older messages')}</Text>}
                </Pressable>
              ) : thread.retentionPurgedThroughSequence > 0 ? <Text style={styles.retention}>{tr('أزيلت الرسائل الأقدم وفق سياسة الاحتفاظ.', 'Older messages were removed under the retention policy.')}</Text> : null}
              maintainVisibleContentPosition={{ autoscrollToTopThreshold: 0, minIndexForVisible: 0 }}
              maxToRenderPerBatch={10}
              onScroll={({ nativeEvent }) => {
                const distance = nativeEvent.contentSize.height - nativeEvent.layoutMeasurement.height - nativeEvent.contentOffset.y;
                nearBottom.current = distance < 120;
                if (nearBottom.current && newMessageCount) setNewMessageCount(0);
              }}
              ref={listRef}
              removeClippedSubviews={false}
              renderItem={({ item }) => (
                <ChatTimelineRow
                  cosmetics={cosmetics}
                  item={item}
                  messages={thread.messages}
                  onMessageAction={setSelected}
                  peerBubble={profileState.profile?.equippedCosmetics?.chatBubble}
                  peerStatus={statusFlags.statusPresentation ? profileState.profile?.statusPresentation : undefined}
                  peerName={displayName}
                  peerReadSequence={thread.peerReadSequence}
                  selfBubble={selfProfileState.profile?.equippedCosmetics?.chatBubble}
                  selfStatus={statusFlags.statusPresentation ? selfProfileState.profile?.statusPresentation : undefined}
                  uid={user?.uid || ''}
                />
              )}
              scrollEventThrottle={80}
              showsVerticalScrollIndicator={false}
              windowSize={8}
            />
            {newMessageCount ? (
              <Pressable accessibilityRole="button" onPress={() => {
                listRef.current?.scrollToEnd({ animated: true });
                setNewMessageCount(0);
              }} style={styles.newMessages}>
                <Text style={styles.newMessagesText}>{tr(`${newMessageCount} رسائل جديدة`, `${newMessageCount} new message${newMessageCount === 1 ? '' : 's'}`)}</Text>
              </Pressable>
            ) : null}
          </ChatThreadCanvas>
        ) : null}

        {inbox.enabled ? (
          <DirectChatComposerModernRoyal
            accepted={thread.status?.accepted === true}
            bottomInset={Math.max(insets.bottom, 8)}
            draft={draft}
            inputRef={inputRef}
            mediaDisabled={!thread.mediaEnabled}
            onCancelReply={() => setReply(undefined)}
            onChangeDraft={updateDraft}
            onCompleteAttachment={thread.loadInitial}
            onEmoji={(emoji) => thread.sendEmoji(emoji, reply?.id || '')}
            onHeightChange={(height) => {
              if (Math.abs(composerHeight.current - height) < 1) return;
              composerHeight.current = height;
              if (nearBottom.current) requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
            }}
            onSend={send}
            onSticker={(itemId) => thread.sendSticker(itemId, reply?.id || '')}
            reply={reply}
            requestIncoming={requestIncoming}
            requestOutgoing={requestOutgoing}
            statusReady={Boolean(thread.status)}
            targetUid={route.params.targetUid}
          />
        ) : null}

        <ChatMessageActionSheet actions={messageActions} cancelLabel={tr('إلغاء', 'Cancel')} onClose={() => setSelected(undefined)} open={Boolean(selected)} title={tr('خيارات الرسالة', 'Message actions')} />
        <DirectChatReportSheet messageCount={reportMessageIds.length} onClose={() => setReportMessageIds([])} onSubmit={submitReport} open={inbox.enabled && reportMessageIds.length > 0} />
      </KeyboardAvoidingView>
    </View>
  );
}

function CenteredState({ body, title }: { body: string; title: string }) {
  return <View style={styles.state}><ChatIcon color={chatColors.gold} name="message" size={28} /><Text accessibilityRole="header" style={styles.stateTitle}>{title}</Text><Text style={styles.stateBody}>{body}</Text></View>;
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  emptyTimeline: { flexGrow: 1, justifyContent: 'center' },
  errorBanner: { backgroundColor: 'rgba(242,103,114,0.12)', borderBottomColor: 'rgba(242,103,114,0.3)', borderBottomWidth: 1, paddingHorizontal: 14, paddingVertical: 8 },
  errorText: { color: chatColors.danger, fontSize: 12, textAlign: 'center' },
  foreground: { flex: 1 },
  headerButton: { alignItems: 'center', borderColor: chatColors.divider, borderRadius: 20, borderWidth: 1, height: 40, justifyContent: 'center', width: 40 },
  leading: { alignItems: 'center', flexDirection: ar ? 'row-reverse' : 'row', gap: 7 },
  loadOlder: { alignItems: 'center', alignSelf: 'center', borderColor: chatColors.divider, borderRadius: 16, borderWidth: 1, justifyContent: 'center', marginBottom: 8, minHeight: 38, paddingHorizontal: 16 },
  loadOlderText: { color: chatColors.goldBright, fontSize: 12, fontWeight: '700' },
  newMessages: { alignSelf: 'center', backgroundColor: chatColors.gold, borderRadius: 18, bottom: 12, position: 'absolute', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 7 },
  newMessagesText: { color: chatColors.goldForeground, fontSize: 12, fontWeight: '900', paddingHorizontal: 14, paddingVertical: 9 },
  pressed: { opacity: 0.78 },
  retention: { color: chatColors.textTertiary, fontSize: 11, marginBottom: 12, textAlign: 'center' },
  root: { backgroundColor: chatColors.canvas, flex: 1 },
  state: { alignItems: 'center', gap: 8, padding: 24 },
  stateBody: { color: chatColors.textSecondary, fontSize: 13, lineHeight: 20, maxWidth: 330, textAlign: 'center' },
  stateTitle: { color: chatColors.textPrimary, fontSize: 18, fontWeight: '900', textAlign: 'center' },
  timeline: { paddingBottom: 16, paddingHorizontal: 14, paddingTop: 12 },
});
