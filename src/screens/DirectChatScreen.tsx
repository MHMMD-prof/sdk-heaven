import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  I18nManager,
  Image,
  type ImageSourcePropType,
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
import { AvatarPresentation } from '../components/AvatarPresentation';
import { RepresentativeBadge } from '../components/RepresentativeBadge';
import { EquipmentCosmeticAsset } from '../components/EquipmentCosmeticAsset';
import type { EquipmentCosmeticProjection } from '../cosmetics/equipmentCosmetics';
import type { CosmeticsFeatureFlags } from '../cosmetics/featureFlags';
import { useCosmeticsFeatureFlags } from '../cosmetics/featureFlags';
import { clearDirectChatDraft, readDirectChatDraft, writeDirectChatDraft } from '../personalChat/directChatDrafts';
import { DirectChatAttachment } from '../personalChat/DirectChatAttachment';
import { DirectChatComposerTools } from '../personalChat/DirectChatComposerTools';
import { DirectChatReportSheet } from '../personalChat/DirectChatReportSheet';
import { DIRECT_CHAT_MAX_REPORT_MESSAGES, type DirectChatReportCategory } from '../personalChat/directChatContract';
import { directChatCopy } from '../personalChat/directChatCopy';
import type { DirectChatUiMessage } from '../personalChat/directChatModels';
import { useDirectChats } from '../personalChat/DirectChatProvider';
import { useDirectChatThread } from '../personalChat/useDirectChatThread';
import { useReducedMotion } from '../personalChat/useReducedMotion';
import { usePersonalChatPresentation } from '../personalChat/ui';
import { usePublicProfile } from '../social/usePublicProfile';
import { requestBlockMutation } from '../social/requestSocialCommand';
import { colors, radius, spacing, typography } from '../theme';
import type { RootStackParamList } from '../types/navigation';
import { DirectChatScreenModernRoyal } from './DirectChatScreenModernRoyal';

const velvetStageArtwork = require('../../assets/login/velvet-invitation/velvet-stage-v1.png') as ImageSourcePropType;
const royalCrestArtwork = require('../../assets/login/velvet-invitation/royal-crest-v1.png') as ImageSourcePropType;

type DirectChatScreenProps = NativeStackScreenProps<RootStackParamList, 'DirectChat'>;
const t = (arabic: string, english: string) => I18nManager.isRTL ? arabic : english;
const COPY = directChatCopy(I18nManager.isRTL ? 'ar' : 'en');
const ROW_DIRECTION = I18nManager.isRTL ? 'row-reverse' as const : 'row' as const;
const TEXT_ALIGN = I18nManager.isRTL ? 'right' as const : 'left' as const;
const WRITING_DIRECTION = I18nManager.isRTL ? 'rtl' as const : 'ltr' as const;

export function DirectChatScreen(props: DirectChatScreenProps) {
  const presentation = usePersonalChatPresentation();
  return presentation === 'modern-royal'
    ? <DirectChatScreenModernRoyal key={props.route.params.targetUid} {...props} />
    : <LegacyDirectChatScreen key={props.route.params.targetUid} {...props} />;
}

function LegacyDirectChatScreen({ navigation, route }: DirectChatScreenProps) {
  const { user } = useAuth();
  const inbox = useDirectChats();
  const insets = useSafeAreaInsets();
  const cosmetics = useCosmeticsFeatureFlags();
  const profileState = usePublicProfile(route.params.targetUid);
  const selfProfileState = usePublicProfile(user?.uid);
  const thread = useDirectChatThread(route.params.targetUid);
  const [draft, setDraft] = useState('');
  const [reply, setReply] = useState<DirectChatUiMessage>();
  const [draftReady, setDraftReady] = useState(false);
  const [reportMessageIds, setReportMessageIds] = useState<string[]>([]);
  const listRef = useRef<FlatList<DirectChatUiMessage>>(null);
  const typingActive = useRef(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const preserveScrollOnNextResize = useRef(false);
  const listMountedRef = useRef(true);
  const reducedMotion = useReducedMotion();
  const bannerOpacity = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;

  useEffect(() => {
    listMountedRef.current = true;
    return () => {
      listMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      bannerOpacity.setValue(1);
      return undefined;
    }
    const animation = Animated.timing(bannerOpacity, { duration: 420, toValue: 1, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [bannerOpacity, reducedMotion]);

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
    if (!text || text.length > 2_000) return;
    const replyId = reply?.id || '';
    // Clear immediately so rapid sends don't resend the same draft and the input feels responsive.
    setDraft('');
    setReply(undefined);
    thread.setTyping(false);
    typingActive.current = false;
    if (user?.uid && thread.conversationId) {
      void clearDirectChatDraft(user.uid, thread.conversationId).catch(() => undefined);
    }
    const sent = await thread.send(text, replyId);
    if (!sent) {
      setDraft((current) => (current.trim() ? current : text));
    }
  };

  const displayName = profileState.profile?.displayName || t('مستخدم', 'User');
  const requestIncoming = thread.status?.requestStatus === 'pending' && thread.status.requestDirection === 'incoming';
  const requestOutgoing = thread.status?.requestStatus === 'pending' && thread.status.requestDirection === 'outgoing';
  const reportPeerMessages = () => {
    const peerMessages = thread.messages
      .filter((message) => message.senderUid === route.params.targetUid && message.deliveryState !== 'failed' && message.kind !== 'system')
      .slice(-DIRECT_CHAT_MAX_REPORT_MESSAGES)
      .map((message) => message.id);
    if (!peerMessages.length) {
      Alert.alert(t('الإبلاغ', 'Report'), t('لا توجد رسالة من هذا المستخدم للإبلاغ عنها.', 'There is no message from this user to report.'));
      return;
    }
    setReportMessageIds(peerMessages);
  };
  const submitReport = async (category: DirectChatReportCategory, details: string) => {
    await thread.report(category, reportMessageIds, details);
    setReportMessageIds([]);
    Alert.alert(
      t('تم إرسال البلاغ', 'Report sent'),
      t('استلم فريق السلامة الرسائل المحددة. سنراجعها ولن نتصفح بقية محادثتك.', 'The safety team received the selected messages. We will review them and will not browse the rest of your conversation.'),
    );
  };
  const blockUser = () => {
    Alert.alert('حظر المستخدم', 'سيتم إيقاف الرسائل والطلبات وإزالة علاقة الصداقة. سيبقى سجل محادثتك مرئياً لك.', [
      { style: 'cancel', text: 'إلغاء' },
      {
        style: 'destructive',
        text: 'حظر',
        onPress: () => void requestBlockMutation('block-user', route.params.targetUid).then((result) => {
          if (!result.ok) throw new Error(result.error.messageAr);
          navigation.goBack();
        }).catch((error) => Alert.alert('تعذر الحظر', error instanceof Error ? error.message : 'حاول مرة أخرى.')),
      },
    ]);
  };
  return (
    <View style={styles.root}>
      <View pointerEvents="none" style={styles.stageLayer}>
        <Image
          accessibilityElementsHidden
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          resizeMode="cover"
          source={velvetStageArtwork}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={['rgba(4,1,2,0.22)', 'rgba(8,2,4,0.48)', 'rgba(5,1,2,0.78)', 'rgba(5,1,2,0.9)']}
          locations={[0, 0.35, 0.72, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.foreground}>
        <Animated.View style={{ opacity: bannerOpacity }}>
          <LinearGradient
            colors={['rgba(91,8,15,0.72)', 'rgba(24,5,7,0.9)', 'rgba(8,2,3,0.94)']}
            end={{ x: 0.15, y: 1 }}
            start={{ x: 0.9, y: 0 }}
            style={[styles.header, { paddingTop: Math.max(insets.top, spacing.sm) }]}
          >
            <View style={styles.headerGoldRail} />
            <Pressable accessibilityLabel={t('رجوع', 'Back')} accessibilityRole="button" onPress={navigation.goBack} style={styles.roundButton}>
              <SymbolView name={{ ios: 'chevron.right', android: 'arrow_forward', web: 'arrow_forward' }} size={22} tintColor={colors.goldSoft} />
            </Pressable>
            <Pressable
              accessibilityLabel={t(`فتح ملف ${displayName}`, `Open ${displayName}'s profile`)}
              onPress={() => navigation.navigate('UserProfile', { uid: route.params.targetUid })}
              style={styles.headerIdentity}
            >
              <View style={styles.crestChip}>
                <Image accessibilityElementsHidden accessible={false} resizeMode="contain" source={royalCrestArtwork} style={styles.crestChipImage} />
              </View>
              <View style={styles.headerAvatarOuter}>
                <View style={styles.headerAvatarRing}>
                  <AvatarPresentation
                    avatarUrl={profileState.profile?.avatarModerationStatus === 'clear' ? profileState.profile.avatarUrl : ''}
                    flags={cosmetics}
                    frame={profileState.profile?.equippedAvatarFrame}
                    label={displayName}
                    size={36}
                    viewerMode="reduced"
                  />
                </View>
              </View>
              <View style={styles.headerCopy}>
                <View style={styles.nameLine}>
                  <EquipmentCosmeticAsset category="nameplate" enabled={cosmetics.nameplates} flags={cosmetics} projection={profileState.profile?.equippedCosmetics?.nameplate} style={styles.headerNameplate} />
                  <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.headerName}>{displayName}</Text>
                  <EquipmentCosmeticAsset category="cosmetic-badge" enabled={cosmetics.cosmeticBadges} flags={cosmetics} projection={profileState.profile?.equippedCosmetics?.cosmeticBadge} style={styles.headerCosmeticBadge} />
                  <RepresentativeBadge active={profileState.profile?.representativeBadgeActive} />
                </View>
                <Text accessibilityLiveRegion="polite" style={styles.presence}>
                  {thread.peerTyping ? t('يكتب الآن…', 'Typing…') : thread.peerOnline ? t('متصل الآن', 'Online') : requestIncoming ? t('طلب محادثة وارد', 'Incoming chat request') : requestOutgoing ? t('بانتظار قبول الطلب', 'Waiting for request approval') : t('محادثة خاصة', 'Private chat')}
                </Text>
              </View>
            </Pressable>
            <Pressable
              accessibilityLabel={t('خيارات المحادثة', 'Chat options')}
              accessibilityRole="button"
              onPress={() => showConversationOptions({ blockUser, navigation, targetUid: route.params.targetUid })}
              style={styles.roundButton}
            >
              <SymbolView name={{ ios: 'ellipsis', android: 'more_vert', web: 'more_vert' }} size={22} tintColor={colors.goldSoft} />
            </Pressable>
          </LinearGradient>
        </Animated.View>

        {!inbox.enabled ? (
          <View style={styles.center}>
            <Text accessibilityRole="header" style={styles.unavailableTitle}>{COPY.unavailableTitle}</Text>
            <Text style={styles.unavailableBody}>{COPY.unavailableBody}</Text>
          </View>
        ) : null}

        {inbox.enabled && thread.errorMessage ? (
          <Pressable onPress={() => void thread.loadInitial()} style={styles.errorBanner}>
            <Text numberOfLines={2} style={styles.errorText}>{thread.errorMessage} — {t('اضغط للمحاولة', 'tap to retry')}</Text>
          </Pressable>
        ) : null}

        {inbox.enabled && requestIncoming ? (
          <RequestPanel
            busy={thread.loading}
            onAccept={() => void thread.decideRequest('accept').catch((error) => Alert.alert('تعذر القبول', error.message))}
            onBlock={blockUser}
            onReject={() => void thread.decideRequest('reject').catch((error) => Alert.alert('تعذر الرفض', error.message))}
            onReport={reportPeerMessages}
          />
        ) : null}

        {inbox.enabled && thread.loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.gold} size="large" /></View>
        ) : inbox.enabled ? (
          <FlatList
            contentContainerStyle={[styles.messageList, thread.messages.length === 0 && styles.emptyMessages]}
            data={thread.messages}
            keyExtractor={(message) => message.id}
            ListEmptyComponent={<EmptyThread requestOutgoing={requestOutgoing} />}
            ListHeaderComponent={thread.hasMore ? (
              <Pressable accessibilityRole="button" disabled={thread.loadingOlder} onPress={() => {
                preserveScrollOnNextResize.current = true;
                void thread.loadOlder();
              }} style={styles.loadOlder}>
                {thread.loadingOlder ? <ActivityIndicator color={colors.gold} /> : <Text style={styles.loadOlderText}>{t('تحميل رسائل أقدم', 'Load older messages')}</Text>}
              </Pressable>
            ) : thread.retentionPurgedThroughSequence > 0 ? (
              <Text maxFontSizeMultiplier={1.45} style={styles.retentionNotice}>
                {t('أُزيلت الرسائل الأقدم وفق سياسة الاحتفاظ.', 'Older messages were removed under the retention policy.')}
              </Text>
            ) : null}
            maxToRenderPerBatch={10}
            onContentSizeChange={() => {
              if (!listMountedRef.current) return;
              if (preserveScrollOnNextResize.current) {
                preserveScrollOnNextResize.current = false;
                return;
              }
              requestAnimationFrame(() => {
                if (!listMountedRef.current) return;
                listRef.current?.scrollToEnd({ animated: false });
              });
            }}
            ref={listRef}
            removeClippedSubviews={false}
            renderItem={({ item }) => (
              <MessageBubble
                bubble={item.senderUid === user?.uid ? selfProfileState.profile?.equippedCosmetics?.chatBubble : profileState.profile?.equippedCosmetics?.chatBubble}
                cosmetics={cosmetics}
                isMine={item.senderUid === user?.uid}
                message={item}
                messages={thread.messages}
                peerReadSequence={thread.peerReadSequence}
                uid={user?.uid || ''}
                onLongPress={() => showMessageOptions({
                  isMine: item.senderUid === user?.uid,
                  message: item,
                  onReply: () => setReply(item),
                  onReport: () => setReportMessageIds([item.id]),
                  onRetry: () => void thread.send(item.text, item.replyToMessageId, item.clientRequestId),
                  onUnsend: () => void thread.unsend(item.id).catch((error) => Alert.alert('تعذر إلغاء الإرسال', error.message)),
                })}
              />
            )}
            showsVerticalScrollIndicator={false}
            windowSize={8}
          />
        ) : null}

        {inbox.enabled ? (
        <View style={[styles.composerArea, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
          <View style={styles.composerGoldLine} />
          {reply ? (
            <View style={styles.replyComposer}>
              <Pressable accessibilityLabel={t('إلغاء الرد', 'Cancel reply')} onPress={() => setReply(undefined)}>
                <SymbolView name={{ ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' }} size={20} tintColor={colors.textMuted} />
              </Pressable>
              <View style={styles.replyComposerCopy}>
                <Text style={styles.replyLabel}>{t('رد على رسالة', 'Replying to a message')}</Text>
                <Text numberOfLines={1} style={styles.replyText}>{reply.text || t('رسالة غير متاحة', 'Message unavailable')}</Text>
              </View>
            </View>
          ) : null}
          {requestOutgoing ? <Text style={styles.requestNote}>{t('يمكنك إرسال طلب واحد فقط حتى يتم قبوله.', 'You can send only one request until it is accepted.')}</Text> : null}
          <DirectChatComposerTools
            disabled={!thread.status?.accepted || requestIncoming || requestOutgoing}
            mediaDisabled={!thread.mediaEnabled}
            onComplete={thread.loadInitial}
            onEmoji={(emoji) => thread.sendEmoji(emoji, reply?.id || '')}
            onSticker={(itemId) => thread.sendSticker(itemId, reply?.id || '')}
            replyToMessageId={reply?.id}
            targetUid={route.params.targetUid}
          />
          <View style={styles.composerRow}>
            <Pressable
              accessibilityLabel={t('إرسال الرسالة', 'Send message')}
              accessibilityRole="button"
              accessibilityState={{ disabled: !draft.trim() || draft.length > 2_000 }}
              disabled={!draft.trim() || draft.length > 2_000}
              onPress={() => void send()}
              style={({ pressed }) => [styles.sendButton, pressed && styles.pressed, (!draft.trim() || draft.length > 2_000) && styles.disabled]}
            >
              <SymbolView name={{ ios: 'paperplane.fill', android: 'send', web: 'send' }} size={22} tintColor="#2A090C" />
            </Pressable>
            <TextInput
              accessibilityLabel={t('نص الرسالة', 'Message text')}
              maxLength={2_000}
              multiline
              onChangeText={updateDraft}
              placeholder={requestIncoming ? t('اقبل الطلب للرد', 'Accept the request to reply') : t('اكتب رسالة…', 'Write a message…')}
              placeholderTextColor={colors.textSubtle}
              readOnly={requestIncoming}
              style={styles.input}
              value={draft}
            />
          </View>
          {draft.length > 1_800 ? <Text style={styles.counter}>{draft.length}/2000</Text> : null}
        </View>
        ) : null}

        <DirectChatReportSheet
          messageCount={reportMessageIds.length}
          onClose={() => setReportMessageIds([])}
          onSubmit={submitReport}
          open={inbox.enabled && reportMessageIds.length > 0}
        />
      </KeyboardAvoidingView>
    </View>
  );
}

function RequestPanel({ busy, onAccept, onBlock, onReject, onReport }: { busy: boolean; onAccept: () => void; onBlock: () => void; onReject: () => void; onReport: () => void }) {
  return (
    <View style={styles.requestPanel}>
      <Text style={styles.requestTitle}>{t('هذا المستخدم يريد بدء محادثة', 'This user wants to start a chat')}</Text>
      <Text style={styles.requestBody}>{t('لن يتمكن من إرسال رسائل أخرى حتى تقبل الطلب.', 'They cannot send more messages until you accept the request.')}</Text>
      <View style={styles.requestActions}>
        <RequestAction disabled={busy} label={t('قبول', 'Accept')} onPress={onAccept} primary />
        <RequestAction disabled={busy} label={t('رفض', 'Reject')} onPress={onReject} />
        <RequestAction disabled={busy} label={t('إبلاغ', 'Report')} onPress={onReport} />
        <RequestAction danger disabled={busy} label={t('حظر', 'Block')} onPress={onBlock} />
      </View>
    </View>
  );
}

function RequestAction({ danger, disabled, label, onPress, primary }: { danger?: boolean; disabled: boolean; label: string; onPress: () => void; primary?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.requestAction, primary && styles.requestPrimary, danger && styles.requestDanger]}><Text style={[styles.requestActionText, primary && styles.requestPrimaryText]}>{label}</Text></Pressable>;
}

function MessageBubble({ bubble, cosmetics, isMine, message, messages, onLongPress, peerReadSequence, uid }: { bubble?: EquipmentCosmeticProjection; cosmetics: CosmeticsFeatureFlags; isMine: boolean; message: DirectChatUiMessage; messages: DirectChatUiMessage[]; onLongPress: () => void; peerReadSequence: number; uid: string }) {
  const replied = message.replyToMessageId ? messages.find((candidate) => candidate.id === message.replyToMessageId) : undefined;
  const system = message.kind === 'system';
  if (system) {
    return (
      <View style={styles.systemShell}>
        <View style={styles.systemLine} />
        <Text style={styles.systemMessage}>{message.text || systemLabel(message.systemType)}</Text>
        <View style={styles.systemLine} />
      </View>
    );
  }
  return (
    <Pressable
      accessibilityLabel={`${isMine ? t('أنت', 'You') : t('المستخدم', 'User')}: ${messageAccessibilityText(message)}`}
      accessibilityRole="text"
      delayLongPress={350}
      onLongPress={onLongPress}
      style={[styles.bubble, isMine ? styles.mine : styles.theirs, message.deliveryState === 'failed' && styles.failedBubble]}
    >
      {/* Equipped chat-bubble cosmetics stay under text; do not restyle this overlay. */}
      <EquipmentCosmeticAsset category="chat-bubble" enabled={cosmetics.chatBubbles} flags={cosmetics} projection={bubble} style={styles.bubbleCosmetic} />
      {replied ? <View style={styles.replyPreview}><Text numberOfLines={2} style={styles.replyPreviewText}>{replied.text || t('رسالة غير متاحة', 'Message unavailable')}</Text></View> : null}
      <DirectChatAttachment flags={cosmetics} message={message} uid={uid} />
      {message.text || message.visibilityState !== 'visible' ? <Text maxFontSizeMultiplier={1.45} selectable style={[styles.messageText, message.visibilityState !== 'visible' && styles.unsentText]}>
        {message.visibilityState === 'unsent'
          ? t('تم إلغاء إرسال هذه الرسالة', 'This message was unsent')
          : message.visibilityState === 'removed'
            ? t('تمت إزالة هذه الرسالة بقرار الإشراف', 'This message was removed by moderation')
            : message.text}
      </Text> : null}
      <View style={styles.messageMeta}>
        <Text style={styles.messageTime}>{formatMessageTime(message.createdAtMs)}</Text>
        {isMine ? <Text style={[styles.delivery, message.deliveryState === 'failed' && styles.deliveryFailed]}>{message.deliveryState === 'sending' ? t('جارٍ الإرسال', 'Sending') : message.deliveryState === 'failed' ? t('فشل — اضغط مطولاً', 'Failed — long press') : message.sequence <= peerReadSequence ? t('تمت القراءة', 'Read') : t('تم الإرسال', 'Sent')}</Text> : null}
      </View>
    </Pressable>
  );
}

function EmptyThread({ requestOutgoing }: { requestOutgoing: boolean }) {
  return (
    <View style={styles.emptyThread}>
      <Image accessibilityElementsHidden accessible={false} source={royalCrestArtwork} style={styles.emptyCrest} />
      <Text style={styles.emptyTitle}>{requestOutgoing ? t('تم إرسال طلب المحادثة', 'Chat request sent') : t('ابدأ حديثاً جديداً', 'Start a new conversation')}</Text>
      <Text style={styles.emptyBody}>{t('المحادثة مرئية للمشاركين فقط، لكنها ليست مشفرة من طرف إلى طرف.', 'This chat is visible only to its participants, but it is not end-to-end encrypted.')}</Text>
    </View>
  );
}

function messageAccessibilityText(message: DirectChatUiMessage) {
  if (message.visibilityState === 'unsent') return t('تم إلغاء إرسال الرسالة', 'Message was unsent');
  if (message.visibilityState === 'removed') return t('تمت إزالة الرسالة بقرار الإشراف', 'Message was removed by moderation');
  if (message.kind === 'image') return t('صورة مشتركة', 'Shared image');
  if (message.kind === 'voice-note') return t('رسالة صوتية', 'Voice message');
  if (message.kind === 'sticker') return t('ملصق', 'Sticker');
  return message.text || t('مرفق غير متاح', 'Unavailable attachment');
}

function showConversationOptions({ blockUser, navigation, targetUid }: { blockUser: () => void; navigation: DirectChatScreenProps['navigation']; targetUid: string }) {
  Alert.alert('خيارات المحادثة', 'اختر الإجراء المطلوب.', [
    { text: 'فتح الملف الشخصي', onPress: () => navigation.navigate('UserProfile', { uid: targetUid }) },
    { text: 'حظر المستخدم', style: 'destructive', onPress: blockUser },
    { text: 'إلغاء', style: 'cancel' },
  ]);
}

function showMessageOptions({ isMine, message, onReply, onReport, onRetry, onUnsend }: { isMine: boolean; message: DirectChatUiMessage; onReply: () => void; onReport: () => void; onRetry: () => void; onUnsend: () => void }) {
  const actions = [
    { text: 'رد', onPress: onReply },
    ...(message.deliveryState === 'failed' ? [{ text: 'إعادة الإرسال', onPress: onRetry }] : []),
    ...(isMine && message.deliveryState === 'sent' && message.visibilityState === 'visible' ? [{ text: 'إلغاء الإرسال', style: 'destructive' as const, onPress: onUnsend }] : []),
    ...(!isMine && message.kind !== 'system' ? [{ text: 'إبلاغ', style: 'destructive' as const, onPress: onReport }] : []),
    { text: 'إلغاء', style: 'cancel' as const },
  ];
  Alert.alert('خيارات الرسالة', '', actions);
}

export function formatMessageTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '';
  return new Intl.DateTimeFormat(I18nManager.isRTL ? 'ar-IQ' : 'en', { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function systemLabel(value: string) {
  const labels: Record<string, string> = {
    'request-accepted': t('تم قبول طلب المحادثة', 'Chat request accepted'),
    'request-rejected': t('تم رفض طلب المحادثة', 'Chat request rejected'),
    'request-expired': t('انتهت صلاحية طلب المحادثة', 'Chat request expired'),
  };
  return labels[value] || t('تم تحديث المحادثة', 'Chat updated');
}

const styles = StyleSheet.create({
  bubble: {
    borderColor: 'rgba(232,190,97,0.22)',
    borderRadius: 18,
    borderWidth: 1,
    gap: spacing.xs,
    marginVertical: 4,
    maxWidth: '82%',
    minWidth: 92,
    overflow: 'hidden',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bubbleCosmetic: { bottom: 0, left: 0, opacity: 0.48, position: 'absolute', right: 0, top: 0 },
  center: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg },
  composerArea: {
    backgroundColor: 'rgba(8,2,3,0.94)',
    borderTopColor: 'rgba(232,190,97,0.4)',
    borderTopWidth: 1.5,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  composerGoldLine: {
    alignSelf: 'center',
    backgroundColor: 'rgba(232,190,97,0.7)',
    borderRadius: 2,
    height: 3,
    marginBottom: spacing.sm,
    width: 64,
  },
  composerRow: { alignItems: 'flex-end', flexDirection: ROW_DIRECTION, gap: spacing.sm },
  counter: { color: colors.textSubtle, fontSize: 10, paddingTop: 2, textAlign: 'left' },
  crestChip: {
    alignItems: 'center',
    backgroundColor: 'rgba(23,9,10,0.85)',
    borderColor: 'rgba(232,190,97,0.5)',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  crestChipImage: { height: 22, width: 22 },
  delivery: { color: colors.goldSoft, fontSize: 9, fontWeight: typography.weights.bold },
  deliveryFailed: { color: '#FF8792' },
  disabled: { opacity: 0.35 },
  emptyBody: { color: colors.textMuted, lineHeight: 20, maxWidth: 300, textAlign: 'center', writingDirection: WRITING_DIRECTION },
  emptyCrest: { height: 78, marginBottom: spacing.sm, opacity: 0.92, width: 78 },
  emptyMessages: { flexGrow: 1, justifyContent: 'center' },
  emptyThread: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
  emptyTitle: { color: colors.text, fontSize: 20, fontWeight: typography.weights.black, textAlign: 'center' },
  errorBanner: { backgroundColor: 'rgba(184,41,75,0.28)', borderBottomColor: 'rgba(232,190,97,0.22)', borderBottomWidth: 1, padding: spacing.sm },
  errorText: { color: '#FFBBC2', fontSize: 12, textAlign: 'center', writingDirection: WRITING_DIRECTION },
  failedBubble: { borderColor: '#D95160', borderWidth: 1 },
  foreground: { flex: 1, zIndex: 1 },
  header: {
    alignItems: 'center',
    borderBottomColor: 'rgba(232,190,97,0.42)',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 80,
    overflow: 'hidden',
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  headerAvatarOuter: {
    borderColor: 'rgba(232,190,97,0.35)',
    borderRadius: radius.full,
    borderWidth: 1,
    padding: 2,
  },
  headerAvatarRing: {
    alignItems: 'center',
    backgroundColor: '#2B0A0E',
    borderColor: colors.gold,
    borderRadius: radius.full,
    borderWidth: 1.5,
    height: 42,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 42,
  },
  headerCopy: { flex: 1 },
  headerCosmeticBadge: { height: 22, width: 22 },
  headerGoldRail: {
    backgroundColor: 'rgba(232,190,97,0.75)',
    height: 2,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  headerIdentity: { alignItems: 'center', flex: 1, flexDirection: ROW_DIRECTION, gap: spacing.sm },
  headerName: { color: colors.text, flexShrink: 1, fontSize: 17, fontWeight: typography.weights.black, textAlign: TEXT_ALIGN },
  headerNameplate: { height: 38, left: -8, position: 'absolute', right: -8 },
  input: {
    backgroundColor: 'rgba(18,6,7,0.95)',
    borderColor: 'rgba(232,190,97,0.42)',
    borderRadius: 24,
    borderWidth: 1.5,
    color: colors.text,
    flex: 1,
    fontSize: 15,
    maxHeight: 120,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    textAlign: TEXT_ALIGN,
    writingDirection: WRITING_DIRECTION,
  },
  loadOlder: {
    alignSelf: 'center',
    backgroundColor: 'rgba(23,9,10,0.9)',
    borderColor: 'rgba(232,190,97,0.34)',
    borderRadius: radius.full,
    borderWidth: 1,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  loadOlderText: { color: colors.goldSoft, fontSize: 12, fontWeight: typography.weights.bold },
  messageList: { paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  messageMeta: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end' },
  messageText: { color: '#FFF7E8', fontSize: 15, lineHeight: 21, textAlign: TEXT_ALIGN, writingDirection: WRITING_DIRECTION },
  messageTime: { color: 'rgba(255,247,232,0.55)', fontSize: 9 },
  mine: { alignSelf: 'flex-end', backgroundColor: 'rgba(101,19,28,0.9)', borderBottomRightRadius: 5 },
  nameLine: { alignItems: 'center', flexDirection: ROW_DIRECTION, gap: spacing.xs },
  presence: { color: colors.gold, fontSize: 11, fontWeight: typography.weights.bold, textAlign: TEXT_ALIGN },
  pressed: { transform: [{ scale: 0.97 }] },
  replyComposer: {
    alignItems: 'center',
    backgroundColor: 'rgba(232,190,97,0.1)',
    borderColor: 'rgba(232,190,97,0.28)',
    borderRadius: radius.md,
    borderRightColor: colors.gold,
    borderRightWidth: 3,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    padding: spacing.sm,
  },
  replyComposerCopy: { flex: 1 },
  replyLabel: { color: colors.goldSoft, fontSize: 11, fontWeight: typography.weights.bold, textAlign: TEXT_ALIGN },
  replyPreview: { backgroundColor: 'rgba(0,0,0,0.22)', borderRightColor: colors.gold, borderRightWidth: 2, padding: spacing.xs },
  replyPreviewText: { color: colors.textMuted, fontSize: 11, textAlign: TEXT_ALIGN },
  replyText: { color: colors.textMuted, fontSize: 11, textAlign: TEXT_ALIGN },
  requestAction: {
    alignItems: 'center',
    borderColor: 'rgba(232,190,97,0.35)',
    borderRadius: radius.full,
    borderWidth: 1,
    minWidth: 64,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  requestActionText: { color: colors.goldSoft, fontSize: 12, fontWeight: typography.weights.bold },
  requestActions: { flexDirection: ROW_DIRECTION, flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  requestBody: { color: colors.textMuted, fontSize: 12, textAlign: TEXT_ALIGN, writingDirection: WRITING_DIRECTION },
  requestDanger: { borderColor: '#A82B38' },
  requestNote: { color: colors.goldSoft, fontSize: 11, marginBottom: spacing.xs, textAlign: 'center' },
  requestPanel: {
    backgroundColor: 'rgba(18,6,7,0.92)',
    borderBottomColor: 'rgba(232,190,97,0.34)',
    borderBottomWidth: 1,
    padding: spacing.md,
  },
  requestPrimary: { backgroundColor: colors.gold, borderColor: colors.gold },
  requestPrimaryText: { color: '#2A090C' },
  requestTitle: { color: colors.goldSoft, fontSize: 14, fontWeight: typography.weights.black, textAlign: TEXT_ALIGN },
  retentionNotice: { color: colors.textSubtle, fontSize: 11, marginBottom: spacing.md, textAlign: 'center' },
  root: { backgroundColor: '#050102', flex: 1 },
  roundButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(23,9,10,0.95)',
    borderColor: 'rgba(232,190,97,0.5)',
    borderRadius: radius.full,
    borderWidth: 1.5,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  sendButton: {
    alignItems: 'center',
    backgroundColor: colors.gold,
    borderColor: 'rgba(246,217,145,0.75)',
    borderRadius: radius.full,
    borderWidth: 1.5,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  stageLayer: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  systemLine: { backgroundColor: 'rgba(232,190,97,0.28)', flex: 1, height: 1 },
  systemMessage: { color: colors.goldSoft, fontSize: 11, fontWeight: typography.weights.bold, textAlign: 'center' },
  systemShell: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginVertical: spacing.sm,
    maxWidth: '88%',
  },
  theirs: { alignSelf: 'flex-start', backgroundColor: 'rgba(34,23,25,0.9)', borderBottomLeftRadius: 5 },
  unavailableBody: { color: colors.textMuted, lineHeight: 22, maxWidth: 300, paddingHorizontal: spacing.lg, textAlign: 'center', writingDirection: WRITING_DIRECTION },
  unavailableTitle: { color: colors.goldSoft, fontSize: 20, fontWeight: typography.weights.black, marginBottom: spacing.sm, textAlign: 'center' },
  unsentText: { color: colors.textMuted, fontStyle: 'italic' },
});
