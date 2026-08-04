import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import { type ReactNode, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, I18nManager, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';

import { AvatarPresentation } from '../components/AvatarPresentation';
import { ScreenContainer } from '../components/ScreenContainer';
import { useCosmeticsFeatureFlags } from '../cosmetics/featureFlags';
import { useDirectChats } from '../personalChat/DirectChatProvider';
import { directChatCopy } from '../personalChat/directChatCopy';
import type { DirectChatRealtimeProjection } from '../personalChat/directChatRealtime';
import { useDirectChatProfiles } from '../personalChat/useDirectChatProfiles';
import { useReducedMotion } from '../personalChat/useReducedMotion';
import { colors, radius, spacing, typography } from '../theme';
import type { RootStackParamList } from '../types/navigation';

const COPY = directChatCopy(I18nManager.isRTL ? 'ar' : 'en');
const ROW_DIRECTION = I18nManager.isRTL ? 'row-reverse' as const : 'row' as const;
const TEXT_ALIGN = I18nManager.isRTL ? 'right' as const : 'left' as const;
const WRITING_DIRECTION = I18nManager.isRTL ? 'rtl' as const : 'ltr' as const;

export function ChatsScreen({
  bottomNavigation,
  navigation,
}: {
  bottomNavigation: ReactNode;
  navigation: NativeStackNavigationProp<RootStackParamList, 'Main'>;
}) {
  const chat = useDirectChats();
  const cosmetics = useCosmeticsFeatureFlags();
  const [search, setSearch] = useState('');
  const reducedMotion = useReducedMotion();
  const profiles = useDirectChatProfiles(chat.items.map((item) => item.peerUid));
  const normalizedSearch = normalizeSearch(search);
  const visibleItems = useMemo(() => chat.items.filter((item) => {
    const profile = profiles[item.peerUid];
    if (!normalizedSearch) return true;
    return normalizeSearch(`${profile?.displayName || ''} ${profile?.publicId || ''} ${item.lastMessagePreview}`).includes(normalizedSearch);
  }), [chat.items, normalizedSearch, profiles]);
  const requests = visibleItems.filter((item) => item.requestState === 'pending');
  const conversations = visibleItems.filter((item) => item.requestState !== 'pending');
  const rows: ChatRow[] = [
    ...(requests.length ? [{ id: 'heading-requests', kind: 'heading' as const, title: COPY.requests }] : []),
    ...requests.map((item) => ({ id: item.conversationId, item, kind: 'chat' as const })),
    ...(conversations.length ? [{ id: 'heading-conversations', kind: 'heading' as const, title: COPY.conversations }] : []),
    ...conversations.map((item) => ({ id: item.conversationId, item, kind: 'chat' as const })),
  ];

  return (
    <ScreenContainer bottomInset fixedBottom={bottomNavigation} horizontalPadding={0} scroll={false} variant="ruby">
      <View style={styles.page}>
        <LinearGradient colors={['#080203', '#2A080D', '#080203']} style={styles.header}>
          <View style={styles.headerMark}>
            <SymbolView name={{ ios: 'bubble.left.and.bubble.right.fill', android: 'forum', web: 'forum' }} size={28} tintColor={colors.goldSoft} />
          </View>
          <View style={styles.headerCopy}>
            <Text maxFontSizeMultiplier={1.3} style={styles.eyebrow}>{COPY.chatsEyebrow}</Text>
            <Text maxFontSizeMultiplier={1.25} style={styles.title}>{COPY.chats}</Text>
          </View>
          {chat.totalUnreadCount ? (
            <View accessibilityLabel={`${chat.totalUnreadCount} رسائل غير مقروءة`} style={styles.totalBadge}>
              <Text style={styles.totalBadgeText}>{compactCount(chat.totalUnreadCount)}</Text>
            </View>
          ) : <View style={styles.headerSpacer} />}
        </LinearGradient>

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
              onRetry={() => void chat.refresh()}
              searching={Boolean(normalizedSearch)}
            />
          )}
          onEndReached={() => void chat.loadMore()}
          onEndReachedThreshold={0.35}
          renderItem={({ item: row }) => row.kind === 'heading' ? (
            <View style={styles.sectionHeading}>
              <View style={styles.sectionLine} />
              <Text style={styles.sectionTitle}>{row.title}</Text>
              <View style={styles.sectionDot} />
            </View>
          ) : reducedMotion ? (
            <ConversationRow
              cosmetics={cosmetics}
              item={row.item}
              onArchive={() => void chat.runPreference(row.item, 'archive')}
              onMute={() => void chat.runPreference(row.item, 'mute')}
              onPress={() => navigation.navigate('DirectChat', { source: 'inbox', targetUid: row.item.peerUid })}
              profile={profiles[row.item.peerUid]}
            />
          ) : (
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
                onPress={() => navigation.navigate('DirectChat', { source: 'inbox', targetUid: row.item.peerUid })}
                profile={profiles[row.item.peerUid]}
              />
            </Swipeable>
          )}
          showsVerticalScrollIndicator={false}
        />
      </View>
    </ScreenContainer>
  );
}

type ChatRow =
  | { id: string; kind: 'heading'; title: string }
  | { id: string; item: DirectChatRealtimeProjection; kind: 'chat' };

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
  return (
    <Pressable
      accessibilityLabel={`${displayName}, ${item.unreadCount ? `${item.unreadCount} ${I18nManager.isRTL ? 'غير مقروءة' : 'unread'}` : COPY.noMessages}`}
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
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.avatarWrap}>
        <AvatarPresentation
          avatarUrl={profile?.avatarModerationStatus === 'clear' ? profile.avatarUrl : ''}
          flags={cosmetics}
          frame={profile?.equippedAvatarFrame}
          label={displayName}
          size={56}
          viewerMode="reduced"
        />
        {item.unreadCount ? <View style={styles.unreadDot} /> : null}
      </View>
      <View style={styles.rowCopy}>
        <View style={styles.rowTop}>
          <Text maxFontSizeMultiplier={1.35} numberOfLines={1} style={[styles.rowName, item.unreadCount > 0 && styles.rowNameUnread]}>{displayName}</Text>
          <Text style={styles.rowTime}>{formatChatTime(item.updatedAtMs)}</Text>
        </View>
        <View style={styles.previewRow}>
          {item.muted ? <SymbolView name={{ ios: 'speaker.slash.fill', android: 'volume_off', web: 'volume_off' }} size={15} tintColor={colors.textSubtle} /> : null}
          <Text maxFontSizeMultiplier={1.35} numberOfLines={1} style={[styles.preview, item.unreadCount > 0 && styles.previewUnread]}>
            {incomingRequest ? COPY.requestNew : item.requestState === 'pending' ? COPY.requestSent : ''}{item.lastMessagePreview || COPY.startChat}
          </Text>
        </View>
      </View>
      {item.unreadCount ? (
        <View style={styles.unreadBadge}><Text style={styles.unreadBadgeText}>{compactCount(item.unreadCount)}</Text></View>
      ) : (
        <SymbolView name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }} size={19} tintColor={colors.textSubtle} />
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

function ChatsState({ enabled, error, loading, onRetry, searching }: { enabled: boolean; error: string; loading: boolean; onRetry: () => void; searching: boolean }) {
  if (loading) return <ActivityIndicator color={colors.gold} size="large" />;
  const title = !enabled ? COPY.unavailableTitle : searching ? COPY.noResults : error ? COPY.errorTitle : COPY.emptyTitle;
  const body = !enabled
    ? COPY.unavailableBody
    : searching ? COPY.searchTryAgain : error || COPY.emptyBody;
  return (
    <View style={styles.stateCard}>
      <View style={styles.stateIcon}><SymbolView name={{ ios: 'bubble.left.fill', android: 'chat_bubble', web: 'chat_bubble' }} size={34} tintColor={colors.goldSoft} /></View>
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateBody}>{body}</Text>
      {error ? <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry}><Text style={styles.retryText}>{COPY.retry}</Text></Pressable> : null}
    </View>
  );
}

export function normalizeSearch(value: string) {
  return value.trim().normalize('NFKC').replace(/[\u0640\u064B-\u065F\u0670\u06D6-\u06ED]/g, '').toLocaleLowerCase(I18nManager.isRTL ? 'ar' : 'en');
}

export function formatChatTime(value: number, now = Date.now()) {
  if (!Number.isFinite(value) || value <= 0) return '';
  const date = new Date(value);
  const sameDay = new Date(now).toDateString() === date.toDateString();
  return sameDay
    ? new Intl.DateTimeFormat(I18nManager.isRTL ? 'ar-IQ' : 'en', { hour: 'numeric', minute: '2-digit' }).format(date)
    : new Intl.DateTimeFormat(I18nManager.isRTL ? 'ar-IQ' : 'en', { day: 'numeric', month: 'short' }).format(date);
}

function compactCount(value: number) {
  return value > 99 ? '99+' : String(value);
}

const styles = StyleSheet.create({
  avatarWrap: { position: 'relative' },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  eyebrow: { color: colors.textMuted, fontSize: 11, textAlign: TEXT_ALIGN },
  header: { alignItems: 'center', borderBottomColor: colors.borderGold, borderBottomWidth: 1, flexDirection: ROW_DIRECTION, gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  headerCopy: { flex: 1 },
  headerMark: { alignItems: 'center', backgroundColor: '#5B1118', borderColor: colors.gold, borderRadius: radius.full, borderWidth: 1, height: 50, justifyContent: 'center', width: 50 },
  headerSpacer: { width: 42 },
  list: { gap: spacing.sm, paddingBottom: spacing.xxl, paddingHorizontal: spacing.md },
  offlineBanner: { backgroundColor: 'rgba(232,190,97,0.12)', padding: spacing.sm },
  offlineText: { color: colors.goldSoft, fontSize: 12, textAlign: 'center' },
  page: { flex: 1 },
  pressed: { opacity: 0.76 },
  preview: { color: colors.textMuted, flex: 1, fontSize: 13, textAlign: TEXT_ALIGN, writingDirection: WRITING_DIRECTION },
  previewRow: { alignItems: 'center', flexDirection: ROW_DIRECTION, gap: spacing.xs },
  previewUnread: { color: colors.text },
  retry: { backgroundColor: colors.gold, borderRadius: radius.full, marginTop: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  retryText: { color: '#2A090C', fontWeight: typography.weights.black },
  row: { alignItems: 'center', backgroundColor: '#120708', borderColor: 'rgba(232,190,97,0.28)', borderRadius: radius.lg, borderWidth: 1, flexDirection: ROW_DIRECTION, gap: spacing.md, minHeight: 82, padding: spacing.md },
  rowCopy: { flex: 1, gap: 6 },
  rowName: { color: colors.text, flex: 1, fontSize: 16, fontWeight: typography.weights.semibold, textAlign: TEXT_ALIGN },
  rowNameUnread: { color: colors.goldSoft, fontWeight: typography.weights.black },
  rowTime: { color: colors.textSubtle, fontSize: 11 },
  rowTop: { alignItems: 'center', flexDirection: ROW_DIRECTION, gap: spacing.sm },
  searchInput: { color: colors.text, flex: 1, fontSize: 15, minHeight: 44, textAlign: TEXT_ALIGN, writingDirection: WRITING_DIRECTION },
  searchShell: { alignItems: 'center', backgroundColor: '#100708', borderColor: colors.borderGold, borderRadius: radius.full, borderWidth: 1, flexDirection: ROW_DIRECTION, margin: spacing.md, paddingHorizontal: spacing.md },
  sectionDot: { backgroundColor: colors.ruby, borderRadius: 4, height: 8, width: 8 },
  sectionHeading: { alignItems: 'center', flexDirection: ROW_DIRECTION, gap: spacing.sm, marginTop: spacing.sm, paddingHorizontal: spacing.xs },
  sectionLine: { backgroundColor: 'rgba(232,190,97,0.18)', flex: 1, height: 1 },
  sectionTitle: { color: colors.goldSoft, fontSize: 16, fontWeight: typography.weights.black, textAlign: TEXT_ALIGN },
  stateBody: { color: colors.textMuted, lineHeight: 22, maxWidth: 320, textAlign: 'center', writingDirection: WRITING_DIRECTION },
  stateCard: { alignItems: 'center', alignSelf: 'center', backgroundColor: 'rgba(38,9,12,0.55)', borderColor: colors.borderGold, borderRadius: radius.xl, borderWidth: 1, gap: spacing.sm, margin: spacing.xl, padding: spacing.xl },
  stateIcon: { alignItems: 'center', backgroundColor: '#5B1118', borderRadius: radius.full, height: 70, justifyContent: 'center', width: 70 },
  stateTitle: { color: colors.goldSoft, fontSize: 20, fontWeight: typography.weights.black, textAlign: 'center' },
  swipeAction: { alignItems: 'center', borderRadius: radius.lg, justifyContent: 'center', marginVertical: 2, minWidth: 94, paddingHorizontal: spacing.md },
  swipeLabel: { color: colors.goldSoft, fontSize: 12, marginTop: spacing.xs },
  title: { color: colors.goldSoft, fontSize: 27, fontWeight: typography.weights.black, textAlign: TEXT_ALIGN },
  totalBadge: { alignItems: 'center', backgroundColor: colors.ruby, borderColor: colors.gold, borderRadius: radius.full, borderWidth: 1, justifyContent: 'center', minHeight: 34, minWidth: 42, paddingHorizontal: spacing.sm },
  totalBadgeText: { color: '#FFF7E8', fontWeight: typography.weights.black },
  unreadBadge: { alignItems: 'center', backgroundColor: colors.ruby, borderRadius: radius.full, justifyContent: 'center', minHeight: 26, minWidth: 26, paddingHorizontal: 6 },
  unreadBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: typography.weights.black },
  unreadDot: { backgroundColor: colors.ruby, borderColor: '#120708', borderRadius: 6, borderWidth: 2, height: 12, position: 'absolute', right: 0, top: 0, width: 12 },
});
