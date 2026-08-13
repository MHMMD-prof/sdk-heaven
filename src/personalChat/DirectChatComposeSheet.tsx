import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AvatarPresentation } from '../components/AvatarPresentation';
import { useCosmeticsFeatureFlags } from '../cosmetics/featureFlags';
import { requestFriendsOverview } from '../social/requestSocialCommand';
import type { FriendConnectionSummary } from '../social/types';
import { useSocialFeatureFlags } from '../social/useSocialFeatureFlags';
import { colors, radius, spacing, typography } from '../theme';
import { directChatCopy } from './directChatCopy';
import { mergeDirectChatMockFriend } from './directChatMockPeer';
import { normalizeSearch } from './directChatSearch';

const COPY = directChatCopy('ar');

export function DirectChatComposeSheet({
  onClose,
  onDiscoverPeople,
  onSelectFriend,
  open,
}: {
  onClose: () => void;
  onDiscoverPeople: () => void;
  onSelectFriend: (uid: string) => void;
  open: boolean;
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
      setErrorMessage('');
    } else {
      const fallback = mergeDirectChatMockFriend([]);
      setFriends(fallback);
      setErrorMessage(fallback.length ? '' : (response.error.messageAr || COPY.composeError));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open) {
      setSearch('');
      return undefined;
    }
    void load();
    return undefined;
  }, [load, open]);

  const normalizedSearch = normalizeSearch(search);
  const visibleFriends = useMemo(() => {
    if (!normalizedSearch) return friends;
    return friends.filter((row) => normalizeSearch(row.profile.displayName).includes(normalizedSearch));
  }, [friends, normalizedSearch]);

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={open}>
      <View style={styles.backdrop}>
        <Pressable accessibilityLabel={COPY.cancel} onPress={onClose} style={styles.dismissArea} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Pressable accessibilityLabel={COPY.cancel} accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
              <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={18} tintColor={colors.goldSoft} />
            </Pressable>
            <Text style={styles.title}>{COPY.composeTitle}</Text>
            <View style={styles.headerSpacer} />
          </View>

          <View style={styles.searchShell}>
            <SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={18} tintColor={colors.gold} />
            <TextInput
              accessibilityLabel={COPY.composeSearchA11y}
              maxLength={64}
              onChangeText={setSearch}
              placeholder={COPY.composeSearchPlaceholder}
              placeholderTextColor={colors.textSubtle}
              style={styles.searchInput}
              value={search}
            />
          </View>

          {loading ? (
            <View style={styles.state}><ActivityIndicator color={colors.gold} size="large" /></View>
          ) : errorMessage ? (
            <View style={styles.state}>
              <Text style={styles.stateTitle}>{COPY.composeError}</Text>
              <Text style={styles.stateBody}>{errorMessage || COPY.friendsUnavailable}</Text>
              <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>{COPY.retry}</Text>
              </Pressable>
            </View>
          ) : visibleFriends.length === 0 ? (
            <View style={styles.state}>
              <Text style={styles.stateTitle}>{normalizedSearch ? COPY.noResults : COPY.composeEmptyTitle}</Text>
              <Text style={styles.stateBody}>{normalizedSearch ? COPY.searchTryAgain : COPY.composeEmptyBody}</Text>
              {!normalizedSearch && socialFlags.usersDiscovery ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    onClose();
                    onDiscoverPeople();
                  }}
                  style={styles.primaryButton}
                >
                  <Text style={styles.primaryButtonText}>{COPY.discoverPeople}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <FlatList
              contentContainerStyle={styles.list}
              data={visibleFriends}
              keyExtractor={(row) => row.profile.uid}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={(
                <View style={styles.sectionHeading}>
                  <View style={styles.sectionLine} />
                  <Text style={styles.sectionTitle}>{COPY.friends}</Text>
                  <View style={styles.sectionLine} />
                </View>
              )}
              renderItem={({ item: row }) => (
                <Pressable
                  accessibilityLabel={`${COPY.newChat} ${row.profile.displayName}`}
                  accessibilityRole="button"
                  onPress={() => {
                    onSelectFriend(row.profile.uid);
                    onClose();
                  }}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                >
                  <View style={styles.avatarOuter}>
                    <View style={styles.avatarRing}>
                      <AvatarPresentation
                        avatarUrl={row.profile.avatarModerationStatus === 'clear' ? row.profile.avatarUrl : ''}
                        flags={cosmetics}
                        frame={row.profile.equippedAvatarFrame}
                        label={row.profile.displayName}
                        size={50}
                        viewerMode="reduced"
                      />
                    </View>
                  </View>
                  <View style={styles.rowCopy}>
                    <Text numberOfLines={1} style={styles.rowName}>{row.profile.displayName}</Text>
                    <Text style={styles.rowHint}>{COPY.startChat}</Text>
                  </View>
                  <View style={styles.chevronShell}>
                    <SymbolView name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }} size={16} tintColor="rgba(232,190,97,0.55)" />
                  </View>
                </Pressable>
              )}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  avatarOuter: {
    borderColor: 'rgba(232,190,97,0.28)',
    borderRadius: radius.full,
    borderWidth: 1,
    padding: 3,
  },
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
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    flex: 1,
    justifyContent: 'flex-end',
  },
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
  closeButton: {
    alignItems: 'center',
    backgroundColor: '#17090A',
    borderColor: 'rgba(232,190,97,0.42)',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  dismissArea: { flex: 1 },
  handle: {
    alignSelf: 'center',
    backgroundColor: 'rgba(232,190,97,0.45)',
    borderRadius: 2,
    height: 4,
    marginBottom: spacing.md,
    width: 48,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  headerSpacer: { width: 40 },
  list: { gap: spacing.sm, paddingBottom: spacing.lg },
  pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  primaryButton: {
    backgroundColor: colors.gold,
    borderRadius: radius.full,
    marginTop: spacing.md,
    minHeight: 44,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  primaryButtonText: {
    color: '#2B090C',
    fontWeight: typography.weights.black,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
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
  rowCopy: { alignItems: 'flex-end', flex: 1, gap: 6 },
  rowHint: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  rowName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: typography.weights.black,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  searchInput: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
    minHeight: 44,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  searchShell: {
    alignItems: 'center',
    backgroundColor: '#0C0405',
    borderColor: 'rgba(232,190,97,0.34)',
    borderRadius: radius.full,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
  },
  sectionHeading: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    marginBottom: spacing.sm,
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
  sheet: {
    backgroundColor: '#0A0405',
    borderColor: 'rgba(232,190,97,0.34)',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1.5,
    maxHeight: '82%',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  state: {
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 220,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xl,
  },
  stateBody: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  stateTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: typography.weights.black,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  title: {
    color: colors.text,
    flex: 1,
    fontSize: 18,
    fontWeight: typography.weights.black,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
});
