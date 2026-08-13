import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  ImageBackground,
  type ImageSourcePropType,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';

import { AvatarPresentation } from '../components/AvatarPresentation';
import { ScreenContainer } from '../components/ScreenContainer';
import { useCosmeticsFeatureFlags } from '../cosmetics/featureFlags';
import { DirectChatComposeSheet } from '../personalChat/DirectChatComposeSheet';
import { useDirectChats } from '../personalChat/DirectChatProvider';
import { directChatCopy } from '../personalChat/directChatCopy';
import type { DirectChatRealtimeProjection } from '../personalChat/directChatRealtime';
import { normalizeSearch } from '../personalChat/directChatSearch';
import { useDirectChatProfiles } from '../personalChat/useDirectChatProfiles';
import { useReducedMotion } from '../personalChat/useReducedMotion';
import { requestFriendsOverview } from '../social/requestSocialCommand';
import type { FriendConnectionSummary } from '../social/types';
import { colors, radius, spacing, typography } from '../theme';
import type { RootStackParamList } from '../types/navigation';
import { mergeDirectChatMockFriend } from '../personalChat/directChatMockPeer';
import { usePersonalChatPresentation } from '../personalChat/ui/usePersonalChatPresentation';
import { ChatsScreenModernRoyal, type ChatsScreenModernRoyalProps } from './ChatsScreenModernRoyal';

const velvetStageArtwork = require('../../assets/login/velvet-invitation/velvet-stage-v1.png') as ImageSourcePropType;
const royalCrestArtwork = require('../../assets/login/velvet-invitation/royal-crest-v1.png') as ImageSourcePropType;
const leatherCardArtwork = require('../../assets/login/velvet-invitation/leather-card-v1.png') as ImageSourcePropType;

/** Chats tab is Arabic/RTL-first for the live product. */
const COPY = directChatCopy('ar');

export function ChatsScreen(props: ChatsScreenModernRoyalProps) {
  const presentation = usePersonalChatPresentation();
  return presentation === 'modern-royal'
    ? <ChatsScreenModernRoyal {...props} />
    : <LegacyChatsScreen {...props} />;
}

function LegacyChatsScreen({
  bottomNavigation,
  navigation,
}: ChatsScreenModernRoyalProps) {
  const chat = useDirectChats();
  const cosmetics = useCosmeticsFeatureFlags();
  const [search, setSearch] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  const [friends, setFriends] = useState<FriendConnectionSummary[]>([]);
  const reducedMotion = useReducedMotion();
  const crestOpacity = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
  const profiles = useDirectChatProfiles(chat.items.map((item) => item.peerUid));
  const normalizedSearch = normalizeSearch(search);
  const inboxPeerIds = useMemo(() => new Set(chat.items.map((item) => item.peerUid)), [chat.items]);

  const loadFriends = useCallback(async () => {
    if (!chat.enabled) {
      setFriends([]);
      return;
    }
    const response = await requestFriendsOverview();
    setFriends(mergeDirectChatMockFriend(response.ok ? response.result.friends : []));
  }, [chat.enabled]);

  useEffect(() => {
    void loadFriends();
  }, [loadFriends]);

  const visibleItems = useMemo(() => chat.items.filter((item) => {
    const profile = profiles[item.peerUid];
    if (!normalizedSearch) return true;
    return normalizeSearch(`${profile?.displayName || ''} ${item.lastMessagePreview}`).includes(normalizedSearch);
  }), [chat.items, normalizedSearch, profiles]);

  const startableFriends = useMemo(() => {
    const withoutInbox = friends.filter((row) => !inboxPeerIds.has(row.profile.uid));
    if (!normalizedSearch) return withoutInbox;
    return withoutInbox.filter((row) => normalizeSearch(row.profile.displayName).includes(normalizedSearch));
  }, [friends, inboxPeerIds, normalizedSearch]);

  const requests = visibleItems.filter((item) => item.requestState === 'pending');
  const conversations = visibleItems.filter((item) => item.requestState !== 'pending');
  const rows: ChatRow[] = [
    ...(requests.length ? [{ id: 'heading-requests', kind: 'heading' as const, title: COPY.requests }] : []),
    ...requests.map((item) => ({ id: item.conversationId, item, kind: 'chat' as const })),
    ...(conversations.length ? [{ id: 'heading-conversations', kind: 'heading' as const, title: COPY.conversations }] : []),
    ...conversations.map((item) => ({ id: item.conversationId, item, kind: 'chat' as const })),
    ...(startableFriends.length ? [{ id: 'heading-friends', kind: 'heading' as const, title: COPY.friends }] : []),
    ...startableFriends.map((friend) => ({ id: `friend-${friend.profile.uid}`, friend, kind: 'friend' as const })),
  ];

  useEffect(() => {
    if (reducedMotion) {
      crestOpacity.setValue(1);
      return undefined;
    }
    const animation = Animated.timing(crestOpacity, { duration: 420, toValue: 1, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [crestOpacity, reducedMotion]);

  const openCompose = () => {
    if (!chat.enabled) return;
    setComposeOpen(true);
  };

  const openPeerChat = (targetUid: string) => {
    navigation.navigate('DirectChat', { source: 'inbox', targetUid });
  };

  return (
    <ScreenContainer
      backdrop={(
        <View style={styles.backdrop}>
          <Image
            accessibilityElementsHidden
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            resizeMode="cover"
            source={velvetStageArtwork}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={['rgba(4,1,2,0.18)', 'rgba(8,2,4,0.45)', 'rgba(6,1,2,0.82)', '#050102']}
            locations={[0, 0.34, 0.72, 1]}
            style={StyleSheet.absoluteFill}
          />
        </View>
      )}
      bottomInset
      decorativeGlows={false}
      fixedBottom={bottomNavigation}
      horizontalPadding={0}
      scroll={false}
      topPadding={0}
      variant="ruby"
    >
      <View style={styles.page}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel={COPY.newChat}
            accessibilityRole="button"
            accessibilityState={{ disabled: !chat.enabled }}
            disabled={!chat.enabled}
            onPress={openCompose}
            style={[styles.newChatButton, !chat.enabled && styles.disabled]}
          >
            <SymbolView name={{ ios: 'plus', android: 'add', web: 'add' }} size={18} tintColor="#2B090C" />
            <Text style={styles.newChatText}>{COPY.newChat}</Text>
          </Pressable>
          <View style={styles.headerCopy}>
            <Text maxFontSizeMultiplier={1.2} style={styles.title}>{COPY.chats}</Text>
            <Text maxFontSizeMultiplier={1.3} style={styles.eyebrow}>{COPY.chatsEyebrow}</Text>
          </View>
          <Animated.View style={[styles.crestChip, { opacity: crestOpacity }]}>
            <Image accessibilityElementsHidden accessible={false} resizeMode="contain" source={royalCrestArtwork} style={styles.crest} />
          </Animated.View>
        </View>

        <ImageBackground
          imageStyle={styles.salonImage}
          resizeMode="cover"
          source={leatherCardArtwork}
          style={styles.salon}
        >
          <LinearGradient
            colors={['rgba(8,2,3,0.28)', 'rgba(8,2,3,0.72)', 'rgba(5,1,2,0.9)']}
            style={styles.salonVeil}
          >
            <View style={styles.salonGoldEdge} />
            <View style={styles.searchShell}>
              <SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={20} tintColor={colors.gold} />
              <TextInput
                accessibilityLabel={COPY.searchA11y}
                maxLength={64}
                onChangeText={setSearch}
                placeholder={COPY.searchPlaceholder}
                placeholderTextColor={colors.textSubtle}
                style={styles.searchInput}
                value={search}
              />
              {chat.totalUnreadCount ? (
                <View style={styles.searchBadge}>
                  <Text style={styles.searchBadgeText}>{compactCount(chat.totalUnreadCount)}</Text>
                </View>
              ) : null}
            </View>

            {chat.status === 'offline' ? (
              <Pressable accessibilityRole="button" onPress={() => void chat.refresh()} style={styles.offlineBanner}>
                <Text style={styles.offlineText}>{COPY.offline}</Text>
              </Pressable>
            ) : null}

            <FlatList
              contentContainerStyle={[styles.list, rows.length === 0 && styles.emptyList]}
              data={rows}
              keyExtractor={(row) => row.id}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={(
                <ChatsState
                  enabled={chat.enabled}
                  error={chat.status === 'error' ? chat.errorMessage : ''}
                  loading={chat.status === 'loading'}
                  onNewChat={openCompose}
                  onRetry={() => void chat.refresh()}
                  searching={Boolean(normalizedSearch)}
                />
              )}
              maxToRenderPerBatch={10}
              onEndReached={() => void chat.loadMore()}
              onEndReachedThreshold={0.35}
              removeClippedSubviews
              windowSize={8}
              renderItem={({ item: row }) => {
                if (row.kind === 'heading') {
                  return (
                    <View style={styles.sectionHeading}>
                      <View style={styles.sectionLine} />
                      <View style={styles.sectionGem} />
                      <Text style={styles.sectionTitle}>{row.title}</Text>
                      <View style={styles.sectionGem} />
                      <View style={styles.sectionLine} />
                    </View>
                  );
                }
                if (row.kind === 'friend') {
                  return (
                    <FriendRow
                      cosmetics={cosmetics}
                      displayName={row.friend.profile.displayName}
                      onPress={() => openPeerChat(row.friend.profile.uid)}
                      profile={row.friend.profile}
                    />
                  );
                }
                if (reducedMotion) {
                  return (
                    <ConversationRow
                      cosmetics={cosmetics}
                      item={row.item}
                      onArchive={() => void chat.runPreference(row.item, 'archive')}
                      onMute={() => void chat.runPreference(row.item, 'mute')}
                      onPress={() => openPeerChat(row.item.peerUid)}
                      profile={profiles[row.item.peerUid]}
                    />
                  );
                }
                return (
                  <Swipeable
                    overshootLeft={false}
                    overshootRight={false}
                    renderLeftActions={() => <SwipeAction color="#5B1118" icon="archive" label={COPY.archive} />}
                    renderRightActions={() => <SwipeAction color="#2A2020" icon={row.item.muted ? 'volume_up' : 'volume_off'} label={row.item.muted ? COPY.unmute : COPY.mute} />}
                    onSwipeableOpen={(direction) => void chat.runPreference(row.item, direction === 'left' ? 'archive' : 'mute')}
                  >
                    <ConversationRow
                      cosmetics={cosmetics}
                      item={row.item}
                      onArchive={() => void chat.runPreference(row.item, 'archive')}
                      onMute={() => void chat.runPreference(row.item, 'mute')}
                      onPress={() => openPeerChat(row.item.peerUid)}
                      profile={profiles[row.item.peerUid]}
                    />
                  </Swipeable>
                );
              }}
              showsVerticalScrollIndicator={false}
            />
          </LinearGradient>
        </ImageBackground>
      </View>

      <DirectChatComposeSheet
        onClose={() => {
          setComposeOpen(false);
          void loadFriends();
        }}
        onDiscoverPeople={() => navigation.navigate('UsersDiscovery')}
        onSelectFriend={(uid) => openPeerChat(uid)}
        open={composeOpen}
      />
    </ScreenContainer>
  );
}

type ChatRow =
  | { id: string; kind: 'heading'; title: string }
  | { id: string; item: DirectChatRealtimeProjection; kind: 'chat' }
  | { id: string; friend: FriendConnectionSummary; kind: 'friend' };

function FriendRow({ cosmetics, displayName, onPress, profile }: {
  cosmetics: ReturnType<typeof useCosmeticsFeatureFlags>;
  displayName: string;
  onPress: () => void;
  profile: FriendConnectionSummary['profile'];
}) {
  return (
    <Pressable
      accessibilityLabel={`${COPY.newChat} ${displayName}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.avatarWrap}>
        <View style={styles.avatarOuter}>
          <View style={styles.avatarRing}>
            <AvatarPresentation
              avatarUrl={profile.avatarModerationStatus === 'clear' ? profile.avatarUrl : ''}
              flags={cosmetics}
              frame={profile.equippedAvatarFrame}
              label={displayName}
              size={50}
              viewerMode="reduced"
            />
          </View>
        </View>
      </View>
      <View style={styles.rowCopy}>
        <View style={styles.rowTop}>
          <Text maxFontSizeMultiplier={1.35} numberOfLines={1} style={styles.rowName}>{displayName}</Text>
        </View>
        <View style={styles.previewRow}>
          <Text maxFontSizeMultiplier={1.35} numberOfLines={1} style={styles.preview}>{COPY.startChat}</Text>
        </View>
      </View>
      <View style={styles.chevronShell}>
        <SymbolView name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }} size={16} tintColor="rgba(232,190,97,0.55)" />
      </View>
    </Pressable>
  );
}

function ConversationRow({ cosmetics, item, onArchive, onMute, onPress, profile }: {
  cosmetics: ReturnType<typeof useCosmeticsFeatureFlags>;
  item: DirectChatRealtimeProjection;
  onArchive: () => void;
  onMute: () => void;
  onPress: () => void;
  profile: ReturnType<typeof useDirectChatProfiles>[string];
}) {
  const incomingRequest = item.requestState === 'pending' && item.recipientUid === item.ownerUid;
  const displayName = profile?.displayName || COPY.user;
  const unread = item.unreadCount > 0;
  return (
    <Pressable
      accessibilityLabel={`${displayName}, ${item.unreadCount ? `${item.unreadCount} غير مقروءة` : COPY.noMessages}`}
      accessibilityActions={[{ name: 'activate', label: COPY.chats }, { name: 'mute', label: item.muted ? COPY.unmute : COPY.mute }, { name: 'archive', label: COPY.archive }]}
      accessibilityRole="button"
      onAccessibilityAction={({ nativeEvent }) => {
        if (nativeEvent.actionName === 'mute') onMute();
        else if (nativeEvent.actionName === 'archive') onArchive();
        else onPress();
      }}
      onLongPress={() => Alert.alert(COPY.chats, displayName, [
        { text: item.muted ? COPY.unmute : COPY.mute, onPress: onMute },
        { text: COPY.archive, onPress: onArchive },
        { text: COPY.cancel, style: 'cancel' },
      ])}
      onPress={onPress}
      style={({ pressed }) => [styles.row, unread && styles.rowUnread, pressed && styles.pressed]}
    >
      {unread ? <LinearGradient colors={['rgba(232,190,97,0.85)', 'rgba(184,41,75,0.55)', 'transparent']} end={{ x: 0, y: 0 }} start={{ x: 1, y: 0 }} style={styles.rowAccent} /> : null}
      <View style={styles.avatarWrap}>
        <View style={[styles.avatarOuter, unread && styles.avatarOuterUnread]}>
          <View style={styles.avatarRing}>
            <AvatarPresentation
              avatarUrl={profile?.avatarModerationStatus === 'clear' ? profile.avatarUrl : ''}
              flags={cosmetics}
              frame={profile?.equippedAvatarFrame}
              label={displayName}
              size={50}
              viewerMode="reduced"
            />
          </View>
        </View>
        {unread ? <View style={styles.unreadDot} /> : null}
      </View>
      <View style={styles.rowCopy}>
        <View style={styles.rowTop}>
          <Text maxFontSizeMultiplier={1.35} numberOfLines={1} style={[styles.rowName, unread && styles.rowNameUnread]}>{displayName}</Text>
          <Text style={[styles.rowTime, unread && styles.rowTimeUnread]}>{formatChatTime(item.updatedAtMs)}</Text>
        </View>
        <View style={styles.previewRow}>
          {item.muted ? <SymbolView name={{ ios: 'speaker.slash.fill', android: 'volume_off', web: 'volume_off' }} size={15} tintColor={colors.textSubtle} /> : null}
          <Text maxFontSizeMultiplier={1.35} numberOfLines={1} style={[styles.preview, unread && styles.previewUnread]}>
            {incomingRequest ? COPY.requestNew : item.requestState === 'pending' ? COPY.requestSent : ''}{item.lastMessagePreview || COPY.startChat}
          </Text>
        </View>
      </View>
      {unread ? (
        <View style={styles.unreadBadge}><Text style={styles.unreadBadgeText}>{compactCount(item.unreadCount)}</Text></View>
      ) : (
        <View style={styles.chevronShell}>
          <SymbolView name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }} size={16} tintColor="rgba(232,190,97,0.55)" />
        </View>
      )}
    </Pressable>
  );
}

function SwipeAction({ color, icon, label }: { color: string; icon: 'archive' | 'volume_off' | 'volume_up'; label: string }) {
  return (
    <View style={[styles.swipeAction, { backgroundColor: color }]}>
      <SymbolView name={{ ios: icon === 'archive' ? 'archivebox.fill' : icon === 'volume_off' ? 'speaker.slash.fill' : 'speaker.wave.2.fill', android: icon, web: icon }} size={22} tintColor={colors.goldSoft} />
      <Text style={styles.swipeLabel}>{label}</Text>
    </View>
  );
}

function ChatsState({
  enabled,
  error,
  loading,
  onNewChat,
  onRetry,
  searching,
}: {
  enabled: boolean;
  error: string;
  loading: boolean;
  onNewChat: () => void;
  onRetry: () => void;
  searching: boolean;
}) {
  if (loading) return <ActivityIndicator color={colors.gold} size="large" />;
  const title = !enabled ? COPY.unavailableTitle : searching ? COPY.noResults : error ? COPY.errorTitle : COPY.emptyTitle;
  const body = !enabled
    ? COPY.unavailableBody
    : searching ? COPY.searchTryAgain : error || COPY.emptyBody;
  return (
    <View style={styles.stateCard}>
      <Image accessibilityElementsHidden accessible={false} resizeMode="contain" source={royalCrestArtwork} style={styles.stateCrest} />
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateBody}>{body}</Text>
      {!searching && !error && enabled ? (
        <Pressable accessibilityRole="button" onPress={onNewChat} style={styles.retry}>
          <Text style={styles.retryText}>{COPY.newChat}</Text>
        </Pressable>
      ) : null}
      {!searching && !error ? <Text style={styles.statePrivacy}>{COPY.safePrivate}</Text> : null}
      {error ? <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry}><Text style={styles.retryText}>{COPY.retry}</Text></Pressable> : null}
    </View>
  );
}

export function formatChatTime(value: number, now = Date.now()) {
  if (!Number.isFinite(value) || value <= 0) return '';
  const date = new Date(value);
  const sameDay = new Date(now).toDateString() === date.toDateString();
  return sameDay
    ? new Intl.DateTimeFormat('ar-IQ', { hour: 'numeric', minute: '2-digit' }).format(date)
    : new Intl.DateTimeFormat('ar-IQ', { day: 'numeric', month: 'short' }).format(date);
}

export { normalizeSearch } from '../personalChat/directChatSearch';

function compactCount(value: number) {
  return value > 99 ? '99+' : String(value);
}

const styles = StyleSheet.create({
  avatarOuter: {
    borderColor: 'rgba(232,190,97,0.28)',
    borderRadius: radius.full,
    borderWidth: 1,
    padding: 3,
  },
  avatarOuterUnread: { borderColor: 'rgba(246,217,145,0.72)' },
  avatarRing: {
    alignItems: 'center',
    backgroundColor: '#2B0A0E',
    borderColor: colors.gold,
    borderRadius: radius.full,
    borderWidth: 1.5,
    height: 56,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 56,
  },
  avatarWrap: { position: 'relative' },
  backdrop: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  chevronShell: {
    alignItems: 'center',
    backgroundColor: 'rgba(23,9,10,0.9)',
    borderColor: 'rgba(232,190,97,0.28)',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  crest: { height: 28, width: 28 },
  crestChip: {
    alignItems: 'center',
    backgroundColor: 'rgba(23,9,10,0.9)',
    borderColor: 'rgba(232,190,97,0.5)',
    borderRadius: radius.full,
    borderWidth: 1.5,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  disabled: { opacity: 0.4 },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  eyebrow: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  headerCopy: { alignItems: 'flex-end', flex: 1, gap: 2 },
  list: { gap: spacing.sm, paddingBottom: spacing.xxl, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  newChatButton: {
    alignItems: 'center',
    backgroundColor: colors.gold,
    borderColor: 'rgba(246,217,145,0.7)',
    borderRadius: radius.full,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: 4,
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  newChatText: {
    color: '#2B090C',
    fontSize: 13,
    fontWeight: typography.weights.black,
    writingDirection: 'rtl',
  },
  offlineBanner: {
    backgroundColor: 'rgba(232,190,97,0.12)',
    borderColor: 'rgba(232,190,97,0.22)',
    borderRadius: radius.md,
    borderWidth: 1,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  offlineText: { color: colors.goldSoft, fontSize: 12, fontWeight: typography.weights.bold, textAlign: 'center', writingDirection: 'rtl' },
  page: { flex: 1 },
  pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  preview: { color: colors.textMuted, flex: 1, fontSize: 13, textAlign: 'right', writingDirection: 'rtl' },
  previewRow: { alignItems: 'center', flexDirection: 'row-reverse', gap: spacing.xs },
  previewUnread: { color: colors.text, fontWeight: typography.weights.semibold },
  retry: {
    backgroundColor: colors.gold,
    borderRadius: radius.full,
    marginTop: spacing.md,
    minHeight: 44,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  retryText: { color: '#2B090C', fontWeight: typography.weights.black, textAlign: 'center', writingDirection: 'rtl' },
  row: {
    alignItems: 'center',
    backgroundColor: 'rgba(12,4,5,0.88)',
    borderColor: 'rgba(232,190,97,0.3)',
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: spacing.md,
    minHeight: 92,
    overflow: 'hidden',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  rowAccent: { height: 2, left: 0, position: 'absolute', right: 0, top: 0 },
  rowCopy: { flex: 1, gap: 6 },
  rowName: {
    color: colors.text,
    flex: 1,
    fontSize: 16,
    fontWeight: typography.weights.black,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  rowNameUnread: { color: colors.goldSoft },
  rowTime: { color: colors.textSubtle, fontSize: 11, fontWeight: typography.weights.bold },
  rowTimeUnread: { color: colors.gold },
  rowTop: { alignItems: 'center', flexDirection: 'row-reverse', gap: spacing.sm },
  rowUnread: {
    backgroundColor: 'rgba(28,8,11,0.94)',
    borderColor: 'rgba(232,190,97,0.5)',
  },
  salon: {
    borderColor: 'rgba(232,190,97,0.34)',
    borderRadius: radius.xl,
    borderWidth: 1.5,
    flex: 1,
    marginHorizontal: spacing.sm,
    marginTop: spacing.xs,
    overflow: 'hidden',
  },
  salonGoldEdge: {
    alignSelf: 'center',
    backgroundColor: 'rgba(232,190,97,0.7)',
    borderRadius: 2,
    height: 3,
    marginTop: spacing.sm,
    width: 56,
  },
  salonImage: { borderRadius: radius.xl },
  salonVeil: { flex: 1 },
  searchBadge: {
    alignItems: 'center',
    backgroundColor: '#72121A',
    borderColor: colors.gold,
    borderRadius: radius.full,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 26,
    minWidth: 26,
    paddingHorizontal: 6,
  },
  searchBadgeText: { color: '#FFF7E8', fontSize: 11, fontWeight: typography.weights.black },
  searchInput: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
    minHeight: 48,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  searchShell: {
    alignItems: 'center',
    backgroundColor: 'rgba(8,2,3,0.82)',
    borderColor: 'rgba(232,190,97,0.42)',
    borderRadius: radius.full,
    borderWidth: 1.5,
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
  },
  sectionGem: {
    backgroundColor: colors.ruby,
    borderColor: 'rgba(232,190,97,0.7)',
    borderRadius: 4,
    borderWidth: 1,
    height: 8,
    transform: [{ rotate: '45deg' }],
    width: 8,
  },
  sectionHeading: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    marginBottom: spacing.xs,
    marginTop: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  sectionLine: { backgroundColor: 'rgba(232,190,97,0.28)', flex: 1, height: 1 },
  sectionTitle: {
    color: colors.goldSoft,
    fontSize: 13,
    fontWeight: typography.weights.black,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  stateBody: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 22,
    maxWidth: 320,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  stateCard: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(10,3,4,0.82)',
    borderColor: 'rgba(232,190,97,0.34)',
    borderRadius: radius.xl,
    borderWidth: 1.5,
    gap: spacing.sm,
    justifyContent: 'center',
    margin: spacing.lg,
    minHeight: 260,
    padding: spacing.xl,
    width: '100%',
  },
  stateCrest: { height: 70, marginBottom: spacing.xs, width: 70 },
  statePrivacy: {
    color: 'rgba(232,190,97,0.72)',
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.xs,
    maxWidth: 280,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  stateTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: typography.weights.black,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  swipeAction: { alignItems: 'center', borderRadius: radius.lg, justifyContent: 'center', marginVertical: 2, minWidth: 94, paddingHorizontal: spacing.md },
  swipeLabel: { color: colors.goldSoft, fontSize: 12, fontWeight: typography.weights.bold, marginTop: spacing.xs, writingDirection: 'rtl' },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: typography.weights.black,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  unreadBadge: {
    alignItems: 'center',
    backgroundColor: '#72121A',
    borderColor: colors.gold,
    borderRadius: radius.full,
    borderWidth: 1.5,
    justifyContent: 'center',
    minHeight: 28,
    minWidth: 28,
    paddingHorizontal: 7,
  },
  unreadBadgeText: { color: '#FFF7E8', fontSize: 11, fontWeight: typography.weights.black },
  unreadDot: {
    backgroundColor: colors.ruby,
    borderColor: '#120708',
    borderRadius: 7,
    borderWidth: 2,
    height: 14,
    left: 0,
    position: 'absolute',
    top: 0,
    width: 14,
  },
});
