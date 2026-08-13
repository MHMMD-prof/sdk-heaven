import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { type ReactNode, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Alert,
  FlatList,
  I18nManager,
  Pressable,
  StyleSheet,
  Text,
  View,
  findNodeHandle,
} from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';

import { useAuth } from '../auth/AuthProvider';
import { ScreenContainer } from '../components/ScreenContainer';
import { useCosmeticsFeatureFlags } from '../cosmetics/featureFlags';
import { DirectChatComposeSheetModernRoyal } from '../personalChat/DirectChatComposeSheetModernRoyal';
import { directChatCopy } from '../personalChat/directChatCopy';
import { useDirectChatInboxDrafts } from '../personalChat/useDirectChatInboxDrafts';
import { useDirectChats } from '../personalChat/DirectChatProvider';
import { useDirectChatProfiles } from '../personalChat/useDirectChatProfiles';
import { useReducedMotion } from '../personalChat/useReducedMotion';
import { buildInboxSections, type ChatInboxRowModel, type ChatInboxFilter } from '../personalChat/ui/buildInboxSections';
import { ChatConversationRow } from '../personalChat/ui/ChatConversationRow';
import { ChatFilterBar } from '../personalChat/ui/ChatFilterBar';
import { ChatIcon, type ChatIconName } from '../personalChat/ui/ChatIcon';
import { ChatListState } from '../personalChat/ui/ChatListState';
import { ChatRequestSummary } from '../personalChat/ui/ChatRequestSummary';
import { ChatRoyalBackdrop } from '../personalChat/ui/ChatRoyalBackdrop';
import { ChatSearchField } from '../personalChat/ui/ChatSearchField';
import { ChatTopBar } from '../personalChat/ui/ChatTopBar';
import { triggerChatSelectionFeedback } from '../personalChat/ui/chatFeedback';
import { chatColors, chatMetrics } from '../personalChat/ui/chatTheme';
import type { RootStackParamList } from '../types/navigation';

const COPY = directChatCopy(I18nManager.isRTL ? 'ar' : 'en');

export type ChatsScreenModernRoyalProps = {
  bottomNavigation: ReactNode;
  navigation: NativeStackNavigationProp<RootStackParamList, 'Main'>;
};

export function ChatsScreenModernRoyal({ bottomNavigation, navigation }: ChatsScreenModernRoyalProps) {
  const { user } = useAuth();
  const chat = useDirectChats();
  const cosmetics = useCosmeticsFeatureFlags();
  const reducedMotion = useReducedMotion();
  const [filter, setFilter] = useState<ChatInboxFilter>('all');
  const [search, setSearch] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  const composeButtonRef = useRef<View>(null);
  const profiles = useDirectChatProfiles(chat.items.map((item) => item.peerUid));
  const drafts = useDirectChatInboxDrafts(user?.uid, chat.items.map((item) => item.conversationId));
  const view = useMemo(() => buildInboxSections({
    drafts,
    fallbackDeletedName: I18nManager.isRTL ? 'مستخدم محذوف' : 'Deleted user',
    fallbackUserName: COPY.user,
    filter,
    items: chat.items,
    profiles: Object.fromEntries(Object.entries(profiles).map(([uid, profile]) => [uid, profile ? {
      deleted: profile.moderationStatus === 'removed',
      displayName: profile.displayName,
    } : undefined])),
    query: search,
  }), [chat.items, drafts, filter, profiles, search]);

  const openPeerChat = (targetUid: string) => navigation.navigate('DirectChat', { source: 'inbox', targetUid });
  const openCompose = () => {
    if (!chat.enabled) return;
    triggerChatSelectionFeedback();
    setComposeOpen(true);
  };
  const closeCompose = () => {
    setComposeOpen(false);
    requestAnimationFrame(() => {
      const handle = findNodeHandle(composeButtonRef.current);
      if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
    });
  };
  const changeFilter = (next: ChatInboxFilter) => {
    triggerChatSelectionFeedback();
    setFilter(next);
  };

  return (
    <ScreenContainer
      backdrop={<ChatRoyalBackdrop />}
      bottomInset
      decorativeGlows={false}
      fixedBottom={bottomNavigation}
      horizontalPadding={0}
      scroll={false}
      topPadding={0}
      variant="ruby"
    >
      <View style={styles.page}>
        <View style={styles.content}>
          <ChatTopBar
            actionDisabled={!chat.enabled}
            actionLabel={COPY.newChat}
            actionRef={composeButtonRef}
            count={chat.totalUnreadCount}
            onAction={openCompose}
            subtitle={COPY.chatsEyebrow}
            title={COPY.chats}
          />

          <View style={styles.controls}>
            <ChatSearchField
              accessibilityLabel={COPY.searchA11y}
              clearAccessibilityLabel={COPY.cancel}
              onChangeText={setSearch}
              onClear={() => setSearch('')}
              placeholder={COPY.searchPlaceholder}
              value={search}
            />
            <ChatFilterBar
              labels={{ all: COPY.all, requests: COPY.requests, unread: COPY.unread }}
              onChange={changeFilter}
              value={filter}
            />
          </View>

          {chat.status === 'offline' ? (
            <Pressable accessibilityRole="button" onPress={() => void chat.refresh()} style={styles.statusStrip}>
              <ChatIcon color={chatColors.gold} name="warning" size={16} />
              <Text style={styles.statusText}>{COPY.offline}</Text>
            </Pressable>
          ) : null}

          <FlatList
            contentContainerStyle={[styles.list, view.rows.length === 0 && styles.emptyList]}
            data={view.rows}
            keyExtractor={(row) => row.item.conversationId}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={filter === 'all' && view.incomingRequestCount > 0 ? null : renderEmptyState({
              enabled: chat.enabled,
              error: chat.status === 'error' ? chat.errorMessage : '',
              filter,
              loading: chat.status === 'loading',
              onNewChat: openCompose,
              onRetry: () => void chat.refresh(),
              searching: Boolean(search.trim()),
            })}
            ListHeaderComponent={filter === 'all' ? (
              <ChatRequestSummary
                count={view.incomingRequestCount}
                label={COPY.requests}
                onPress={() => changeFilter('requests')}
                reviewLabel={COPY.reviewRequests}
              />
            ) : null}
            maxToRenderPerBatch={10}
            onEndReached={() => void chat.loadMore()}
            onEndReachedThreshold={0.35}
            removeClippedSubviews
            renderItem={({ item }) => renderConversation({
              chat,
              cosmetics,
              onPress: () => openPeerChat(item.item.peerUid),
              profiles,
              reducedMotion,
              row: item,
            })}
            showsVerticalScrollIndicator={false}
            windowSize={8}
          />
        </View>
      </View>

      <DirectChatComposeSheetModernRoyal
        onClose={closeCompose}
        onDiscoverPeople={() => navigation.navigate('UsersDiscovery')}
        onSelectFriend={openPeerChat}
        open={composeOpen}
        recentPeerUids={chat.items.filter((item) => item.requestState !== 'pending').map((item) => item.peerUid)}
      />
    </ScreenContainer>
  );
}

function renderConversation({ chat, cosmetics, onPress, profiles, reducedMotion, row }: {
  chat: ReturnType<typeof useDirectChats>;
  cosmetics: ReturnType<typeof useCosmeticsFeatureFlags>;
  onPress: () => void;
  profiles: ReturnType<typeof useDirectChatProfiles>;
  reducedMotion: boolean;
  row: ChatInboxRowModel;
}) {
  const item = row.item;
  const profile = profiles[item.peerUid];
  const mute = () => void chat.runPreference(item, 'mute');
  const archive = () => void chat.runPreference(item, 'archive');
  const presentation = {
    accessibilityLabel: conversationAccessibilityLabel(row),
    archiveLabel: COPY.archive,
    avatarUrl: profile?.avatarModerationStatus === 'clear' ? profile.avatarUrl : '',
    displayName: row.displayName,
    frame: profile?.equippedAvatarFrame,
    muted: item.muted,
    muteLabel: item.muted ? COPY.unmute : COPY.mute,
    preview: formatPreview(row),
    timestampLabel: formatModernChatTime(item.updatedAtMs),
    unreadCount: item.unreadCount,
  };
  const content = (
    <ChatConversationRow
      flags={cosmetics}
      onArchive={archive}
      onLongPress={() => showRowActions(row, mute, archive)}
      onMute={mute}
      onPress={onPress}
      presentation={presentation}
    />
  );
  if (reducedMotion) return content;
  return (
    <Swipeable
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={() => <SwipeAction icon="archive" label={COPY.archive} />}
      renderRightActions={() => <SwipeAction icon={item.muted ? 'unmute' : 'mute'} label={item.muted ? COPY.unmute : COPY.mute} />}
      onSwipeableOpen={(direction) => void chat.runPreference(item, direction === 'left' ? 'archive' : 'mute')}
    >
      {content}
    </Swipeable>
  );
}

function renderEmptyState({ enabled, error, filter, loading, onNewChat, onRetry, searching }: {
  enabled: boolean;
  error: string;
  filter: ChatInboxFilter;
  loading: boolean;
  onNewChat: () => void;
  onRetry: () => void;
  searching: boolean;
}) {
  if (loading) return <InboxSkeleton />;
  if (!enabled) return <ChatListState body={COPY.unavailableBody} title={COPY.unavailableTitle} />;
  if (error) return <ChatListState actionLabel={COPY.retry} body={error} icon="warning" onAction={onRetry} title={COPY.errorTitle} />;
  if (searching) return <ChatListState body={COPY.searchTryAgain} title={COPY.noResults} />;
  if (filter === 'requests') return <ChatListState body={I18nManager.isRTL ? 'لا توجد طلبات محادثة جديدة.' : 'There are no new chat requests.'} title={COPY.requests} />;
  if (filter === 'unread') return <ChatListState body={I18nManager.isRTL ? 'قرأت كل الرسائل.' : 'You are all caught up.'} title={COPY.unread} />;
  return <ChatListState actionLabel={COPY.newChat} body={COPY.emptyBody} onAction={onNewChat} title={COPY.emptyTitle} />;
}

function InboxSkeleton() {
  return (
    <View accessibilityLabel={I18nManager.isRTL ? 'جاري تحميل المحادثات' : 'Loading chats'} style={styles.skeletonList}>
      {Array.from({ length: 6 }, (_, index) => (
        <View key={index} style={styles.skeletonRow}>
          <View style={styles.skeletonAvatar} />
          <View style={styles.skeletonCopy}>
            <View style={styles.skeletonName} />
            <View style={styles.skeletonPreview} />
          </View>
        </View>
      ))}
    </View>
  );
}

function SwipeAction({ icon, label }: { icon: ChatIconName; label: string }) {
  return (
    <View style={styles.swipeAction}>
      <ChatIcon color={chatColors.gold} name={icon} size={20} />
      <Text style={styles.swipeLabel}>{label}</Text>
    </View>
  );
}

function showRowActions(row: ChatInboxRowModel, onMute: () => void, onArchive: () => void) {
  Alert.alert(COPY.chats, row.displayName, [
    { onPress: onMute, text: row.item.muted ? COPY.unmute : COPY.mute },
    { onPress: onArchive, text: COPY.archive },
    { style: 'cancel', text: COPY.cancel },
  ]);
}

function formatPreview(row: ChatInboxRowModel) {
  if (row.previewKind === 'draft') return `${COPY.draft}: ${row.previewText}`;
  if (row.requestDirection === 'incoming') return `${COPY.requestNew}${row.previewText}`;
  if (row.requestDirection === 'outgoing') return `${COPY.requestSent}${row.previewText}`;
  if (row.previewKind === 'image') return COPY.image;
  if (row.previewKind === 'voice-note') return COPY.voiceNote;
  if (row.previewKind === 'sticker') return COPY.sticker;
  return row.previewText || COPY.noMessages;
}

function conversationAccessibilityLabel(row: ChatInboxRowModel) {
  const unread = row.item.unreadCount > 0
    ? I18nManager.isRTL ? `${row.item.unreadCount} غير مقروءة` : `${row.item.unreadCount} unread`
    : COPY.noMessages;
  return `${row.displayName}, ${formatPreview(row)}, ${unread}`;
}

export function formatModernChatTime(value: number, now = Date.now()) {
  if (!Number.isFinite(value) || value <= 0) return '';
  const date = new Date(value);
  const locale = I18nManager.isRTL ? 'ar-IQ' : 'en';
  return new Date(now).toDateString() === date.toDateString()
    ? new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(date)
    : new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(date);
}

const styles = StyleSheet.create({
  content: { alignSelf: 'center', flex: 1, maxWidth: chatMetrics.contentMaxWidth, width: '100%' },
  controls: { backgroundColor: 'rgba(9,2,3,0.94)', gap: 10, paddingBottom: 8, paddingHorizontal: chatMetrics.gutter, paddingTop: 12 },
  emptyList: { flexGrow: 1 },
  list: { paddingBottom: 32 },
  page: { flex: 1 },
  skeletonAvatar: { backgroundColor: chatColors.surfacePressed, borderRadius: 26, height: 52, width: 52 },
  skeletonCopy: { flex: 1, gap: 9 },
  skeletonList: { paddingHorizontal: chatMetrics.gutter },
  skeletonName: { backgroundColor: chatColors.surfacePressed, borderRadius: 5, height: 14, width: '44%' },
  skeletonPreview: { backgroundColor: chatColors.surface, borderRadius: 5, height: 12, width: '72%' },
  skeletonRow: { alignItems: 'center', borderBottomColor: chatColors.divider, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row', gap: 12, minHeight: 76 },
  statusStrip: { alignItems: 'center', backgroundColor: chatColors.royalRedSoft, borderBottomColor: chatColors.divider, borderBottomWidth: 1, flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row', gap: 7, justifyContent: 'center', minHeight: 38, paddingHorizontal: 12 },
  statusText: { color: chatColors.textSecondary, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  swipeAction: { alignItems: 'center', backgroundColor: chatColors.royalRedSoft, justifyContent: 'center', minWidth: 92, paddingHorizontal: 12 },
  swipeLabel: { color: chatColors.gold, fontSize: 12, fontWeight: '700', marginTop: 5 },
});
