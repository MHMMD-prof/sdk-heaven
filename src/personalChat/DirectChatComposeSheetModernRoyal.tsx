import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  I18nManager,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCosmeticsFeatureFlags } from '../cosmetics/featureFlags';
import { requestFriendsOverview } from '../social/requestSocialCommand';
import type { FriendConnectionSummary } from '../social/types';
import { useSocialFeatureFlags } from '../social/useSocialFeatureFlags';
import { directChatCopy } from './directChatCopy';
import { mergeDirectChatMockFriend } from './directChatMockPeer';
import { normalizeSearch } from './directChatSearch';
import { ChatAvatar } from './ui/ChatAvatar';
import { ChatIcon } from './ui/ChatIcon';
import { ChatListState } from './ui/ChatListState';
import { ChatSearchField } from './ui/ChatSearchField';
import { chatColors, chatMetrics } from './ui/chatTheme';
import { buildComposeSections } from './ui/buildComposeSections';

const COPY = directChatCopy(I18nManager.isRTL ? 'ar' : 'en');

export function DirectChatComposeSheetModernRoyal({
  onClose,
  onDiscoverPeople,
  onSelectFriend,
  open,
  recentPeerUids,
}: {
  onClose: () => void;
  onDiscoverPeople: () => void;
  onSelectFriend: (uid: string) => void;
  open: boolean;
  recentPeerUids: string[];
}) {
  const insets = useSafeAreaInsets();
  const cosmetics = useCosmeticsFeatureFlags();
  const socialFlags = useSocialFeatureFlags();
  const [friends, setFriends] = useState<FriendConnectionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMessage('');
    const response = await requestFriendsOverview();
    if (response.ok) {
      setFriends(mergeDirectChatMockFriend(response.result.friends));
    } else {
      const fallback = mergeDirectChatMockFriend([]);
      setFriends(fallback);
      setErrorMessage(fallback.length ? '' : response.error.messageAr || COPY.composeError);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open) {
      setSearch('');
      return;
    }
    void load();
  }, [load, open]);

  const sections = useMemo(() => buildComposeSections({
    friends,
    friendsTitle: COPY.friends,
    query: search,
    recentPeerUids,
    recentTitle: I18nManager.isRTL ? 'الأخيرة' : 'Recent',
  }), [friends, recentPeerUids, search]);
  const searching = Boolean(normalizeSearch(search));

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={open}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <Pressable accessibilityLabel={COPY.cancel} accessibilityRole="button" onPress={onClose} style={styles.dismissArea} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Pressable accessibilityLabel={COPY.cancel} accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
              <ChatIcon color={chatColors.gold} name="close" size={19} />
            </Pressable>
            <Text accessibilityRole="header" maxFontSizeMultiplier={2} style={styles.title}>{COPY.composeTitle}</Text>
            <View style={styles.headerSpacer} />
          </View>

          <View style={styles.searchWrap}>
            <ChatSearchField
              accessibilityLabel={COPY.composeSearchA11y}
              clearAccessibilityLabel={COPY.cancel}
              onChangeText={setSearch}
              onClear={() => setSearch('')}
              placeholder={COPY.composeSearchPlaceholder}
              value={search}
            />
          </View>

          {loading ? (
            <ChatListState loading />
          ) : errorMessage ? (
            <ChatListState actionLabel={COPY.retry} body={errorMessage} icon="warning" onAction={() => void load()} title={COPY.composeError} />
          ) : sections.length === 0 ? (
            <ChatListState
              actionLabel={!searching && socialFlags.usersDiscovery ? COPY.discoverPeople : undefined}
              body={searching ? COPY.searchTryAgain : COPY.composeEmptyBody}
              onAction={!searching && socialFlags.usersDiscovery ? () => { onClose(); onDiscoverPeople(); } : undefined}
              title={searching ? COPY.noResults : COPY.composeEmptyTitle}
            />
          ) : (
            <SectionList
              contentContainerStyle={styles.list}
              keyboardShouldPersistTaps="handled"
              keyExtractor={(item) => item.profile.uid}
              renderItem={({ item }) => (
                <Pressable
                  accessibilityLabel={`${COPY.newChat} ${item.profile.displayName}`}
                  accessibilityRole="button"
                  onPress={() => {
                    onSelectFriend(item.profile.uid);
                    onClose();
                  }}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                >
                  <ChatAvatar
                    avatarUrl={item.profile.avatarModerationStatus === 'clear' ? item.profile.avatarUrl : ''}
                    flags={cosmetics}
                    frame={item.profile.equippedAvatarFrame}
                    label={item.profile.displayName}
                    size={chatMetrics.avatarInbox}
                  />
                  <View style={styles.rowCopy}>
                    <Text maxFontSizeMultiplier={2} numberOfLines={1} style={styles.rowName}>{item.profile.displayName}</Text>
                    <Text maxFontSizeMultiplier={2} numberOfLines={1} style={styles.rowHint}>{COPY.startChat}</Text>
                  </View>
                  <ChatIcon color={chatColors.gold} name="chevron" size={17} />
                </Pressable>
              )}
              renderSectionHeader={({ section }) => <Text maxFontSizeMultiplier={2} style={styles.sectionTitle}>{section.title}</Text>}
              sections={sections}
              showsVerticalScrollIndicator={false}
              stickySectionHeadersEnabled={false}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: chatColors.scrim, flex: 1, justifyContent: 'flex-end' },
  closeButton: { alignItems: 'center', backgroundColor: chatColors.surface, borderColor: chatColors.divider, borderRadius: 22, borderWidth: 1, height: chatMetrics.controlMinHeight, justifyContent: 'center', width: chatMetrics.controlMinHeight },
  dismissArea: { flex: 1 },
  handle: { alignSelf: 'center', backgroundColor: chatColors.gold, borderRadius: 2, height: 3, marginBottom: 8, opacity: 0.75, width: 48 },
  header: { alignItems: 'center', flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row', paddingHorizontal: 16 },
  headerSpacer: { width: chatMetrics.controlMinHeight },
  list: { paddingBottom: 20, paddingHorizontal: 16 },
  pressed: { backgroundColor: chatColors.surfacePressed },
  row: { alignItems: 'center', borderBottomColor: chatColors.divider, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row', gap: 12, minHeight: 76, paddingVertical: 10 },
  rowCopy: { flex: 1, minWidth: 0 },
  rowHint: { color: chatColors.textSecondary, fontSize: 13, marginTop: 4, textAlign: I18nManager.isRTL ? 'right' : 'left' },
  rowName: { color: chatColors.textPrimary, fontSize: 16, fontWeight: '800', textAlign: I18nManager.isRTL ? 'right' : 'left' },
  searchWrap: { paddingHorizontal: 16, paddingVertical: 12 },
  sectionTitle: { color: chatColors.gold, fontSize: 13, fontWeight: '800', paddingBottom: 6, paddingTop: 10, textAlign: I18nManager.isRTL ? 'right' : 'left' },
  sheet: { alignSelf: 'center', backgroundColor: chatColors.canvasRaised, borderColor: 'rgba(224,185,103,0.38)', borderTopLeftRadius: chatMetrics.sheetTopRadius, borderTopRightRadius: chatMetrics.sheetTopRadius, borderWidth: 1, maxHeight: '84%', maxWidth: 560, paddingTop: 10, width: '100%' },
  title: { color: chatColors.textPrimary, flex: 1, fontSize: 21, fontWeight: '900', textAlign: 'center' },
});
