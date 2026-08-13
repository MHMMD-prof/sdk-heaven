import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  ImageSourcePropType,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { CreateRoomModal } from '../components/CreateRoomModal';
import { ScreenContainer } from '../components/ScreenContainer';
import { getRoomCountry } from '../data/roomCountries';
import {
  getRoomArtVariant,
  getVoiceRoomHostName,
  selectHomeDiscoveryRooms,
} from '../home/homeDiscovery';
import { useGrowthFeatureFlags } from '../growth/featureFlags';
import { setGrowthMatchMask } from '../growth/matchSession';
import { requestFriendsOverview, requestQuickMatch } from '../social/requestSocialCommand';
import { useSocialFeatureFlags } from '../social/useSocialFeatureFlags';
import { colors, radius, spacing, typography } from '../theme';
import { RoomCountryCode, VoiceRoom, VoiceRoomMember, VoiceRoomType } from '../types/voice';
import { normalizeInviteCode } from '../voice/roomProfile';
import { useVoiceRooms } from '../voice/useVoiceRooms';
import { useAvatarFrameProjection } from '../social/useAvatarFrameProjection';
import { useCosmeticsFeatureFlags, type CosmeticsFeatureFlags } from '../cosmetics/featureFlags';
import { AvatarFrameLayer } from '../components/AvatarPresentation';
import type { AvatarFrameProjection } from '../cosmetics/avatarFrameProjection';

const roomArtwork: Record<VoiceRoomType, ImageSourcePropType[]> = {
  voice: [
    require('../../assets/home/room-voice-royal-v3.jpg') as ImageSourcePropType,
    require('../../assets/home/room-voice-salon-v3.jpg') as ImageSourcePropType,
    require('../../assets/home/room-voice-anonymous-v3.jpg') as ImageSourcePropType,
    require('../../assets/home/room-majlis.jpg') as ImageSourcePropType,
    require('../../assets/home/room-masquerade.jpg') as ImageSourcePropType,
  ],
  game: [
    require('../../assets/home/room-game-carrom-v3.jpg') as ImageSourcePropType,
    require('../../assets/home/room-game-party-v3.jpg') as ImageSourcePropType,
    require('../../assets/home/room-game-table.jpg') as ImageSourcePropType,
  ],
};

type RoomFilter = 'all' | VoiceRoomType;
type SymbolName = React.ComponentProps<typeof SymbolView>['name'];

const roomFilters: ReadonlyArray<{
  key: RoomFilter;
  label: string;
  icon: SymbolName;
}> = [
  {
    key: 'all',
    label: 'الكل',
    icon: { ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' },
  },
  {
    key: 'voice',
    label: 'صوت',
    icon: { ios: 'mic.fill', android: 'mic', web: 'mic' },
  },
  {
    key: 'game',
    label: 'ألعاب',
    icon: { ios: 'gamecontroller.fill', android: 'sports_esports', web: 'sports_esports' },
  },
];

type RoomsScreenProps = {
  bottomNavigation: ReactNode;
  onOpenProfile: () => void;
  onOpenVoiceRoom: (roomId: string) => void;
};

export function RoomsScreen({
  bottomNavigation,
  onOpenVoiceRoom,
}: RoomsScreenProps) {
  const cosmeticsFlags = useCosmeticsFeatureFlags();
  const growthFlags = useGrowthFeatureFlags();
  const { width } = useWindowDimensions();
  const compact = width < 380;
  const socialFlags = useSocialFeatureFlags();
  const {
    createPrivateRoom,
    createRoom,
    forgetVisitedRoom,
    joinRoom,
    rooms,
    roomsStatus,
    visitedRooms,
  } = useVoiceRooms();
  const [filter, setFilter] = useState<RoomFilter>('all');
  const [friendIds, setFriendIds] = useState<ReadonlySet<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchVisible, setSearchVisible] = useState(false);
  const [pendingRoomId, setPendingRoomId] = useState<string>();
  const [errorMessage, setErrorMessage] = useState('');
  const [createErrorMessage, setCreateErrorMessage] = useState('');
  const [isCreateModalVisible, setCreateModalVisible] = useState(false);
  const [isCreating, setCreating] = useState(false);
  const [isPrivateRoom, setPrivateRoom] = useState(false);
  const [createInviteCode, setCreateInviteCode] = useState('');
  const [selectedCountryCode, setSelectedCountryCode] = useState<RoomCountryCode>('IQ');
  const [selectedRoomType, setSelectedRoomType] = useState<VoiceRoomType>('voice');
  const [isMatching, setMatching] = useState(false);
  const visibleAvatarUids = useMemo(
    () => rooms.flatMap((room) => roomMembers(room).slice(0, 3).map((member) => member.id)),
    [rooms],
  );
  const avatarFrames = useAvatarFrameProjection(visibleAvatarUids);

  useEffect(() => {
    if (!socialFlags.friends) {
      setFriendIds(new Set());
      return undefined;
    }
    let active = true;
    void requestFriendsOverview().then((response) => {
      if (active && response.ok) {
        setFriendIds(new Set(response.result.friends.map((friend) => friend.profile.uid)));
      }
    });
    return () => {
      active = false;
    };
  }, [socialFlags.friends]);

  const popularRooms = useMemo(
    () => selectHomeDiscoveryRooms(rooms, {
      country: 'all',
      mode: 'popular',
      quickFilter: 'all',
      searchQuery: '',
      visitedRooms,
    }),
    [rooms, visitedRooms],
  );
  const featuredRoom = !searchQuery && filter === 'all' ? popularRooms[0] : undefined;
  const recentRooms = useMemo(
    () => selectHomeDiscoveryRooms(rooms, {
      country: 'all',
      mode: 'visited',
      quickFilter: 'all',
      searchQuery: '',
      visitedRooms,
    }).filter((room) => room.id !== featuredRoom?.id).slice(0, 5),
    [featuredRoom?.id, rooms, visitedRooms],
  );
  const filteredRooms = useMemo(
    () => selectHomeDiscoveryRooms(rooms, {
      country: 'all',
      mode: 'activity',
      quickFilter: filter,
      searchQuery,
      visitedRooms,
    }),
    [filter, rooms, searchQuery, visitedRooms],
  );
  const liveRooms = useMemo(
    () => filteredRooms
      .filter((room) => !featuredRoom || room.id !== featuredRoom.id)
      .slice(0, 40),
    [featuredRoom, filteredRooms],
  );
  const friendRooms = useMemo(
    () => !searchQuery && filter === 'all' && friendIds.size
      ? selectHomeDiscoveryRooms(rooms, {
          country: 'all',
          mode: 'activity',
          quickFilter: 'all',
          searchQuery: '',
          visitedRooms,
        }).filter((room) => roomMembers(room).some((member) => friendIds.has(member.id))).slice(0, 4)
      : [],
    [filter, friendIds, rooms, searchQuery, visitedRooms],
  );
  const visitedRoomIds = useMemo(
    () => new Set(visitedRooms.map((room) => room.id)),
    [visitedRooms],
  );

  const handleOpenRoom = async (room: VoiceRoom) => {
    setErrorMessage('');
    setPendingRoomId(room.id);
    try {
      const joinedRoom = await joinRoom(room.id);
      onOpenVoiceRoom(joinedRoom.id);
    } catch {
      if (visitedRoomIds.has(room.id)) {
        await forgetVisitedRoom(room.id);
      }
      setErrorMessage('تعذر فتح الغرفة. ربما انتهت أو لم تعد متاحة.');
    } finally {
      setPendingRoomId(undefined);
    }
  };

  const handleCreateRoom = async () => {
    setCreateErrorMessage('');
    setCreating(true);
    try {
      const input = {
        countryCode: selectedCountryCode,
        inviteCode: normalizeInviteCode(createInviteCode),
        type: selectedRoomType,
      };
      const room = isPrivateRoom ? await createPrivateRoom(input) : await createRoom(input);
      setCreateModalVisible(false);
      setCreateInviteCode('');
      setPrivateRoom(false);
      onOpenVoiceRoom(room.id);
    } catch {
      setCreateErrorMessage('تعذر إنشاء الغرفة الآن. تحقق من الاتصال وحاول مرة أخرى.');
    } finally {
      setCreating(false);
    }
  };

  const handleQuickMatch = async () => {
    if (!growthFlags.quickMatch || isMatching) return;
    setErrorMessage('');
    setMatching(true);
    try {
      const response = await requestQuickMatch();
      if (!response.ok) {
        setErrorMessage(response.error.messageAr || 'تعذر إيجاد غرفة مناسبة الآن.');
        return;
      }
      if (response.result.masked && response.result.mask) {
        setGrowthMatchMask({
          expiresAtMs: response.result.mask.expiresAtMs,
          labelAr: response.result.mask.labelAr,
          roomId: response.result.roomId,
        });
      }
      setPendingRoomId(response.result.roomId);
      const joinedRoom = await joinRoom(response.result.roomId);
      onOpenVoiceRoom(joinedRoom.id);
    } catch {
      setErrorMessage('تعذر الانضمام بعد المطابقة. حاول مرة أخرى.');
    } finally {
      setPendingRoomId(undefined);
      setMatching(false);
    }
  };

  const hasDiscoveryContent = Boolean(featuredRoom || liveRooms.length || friendRooms.length);

  return (
    <ScreenContainer
      bottomInset
      decorativeGlows={false}
      fixedBottom={bottomNavigation}
      horizontalPadding={0}
      topPadding={0}
      variant="ruby"
    >
      <View style={styles.page}>
        <RoomBackdrop />
        <View style={styles.header}>
          <View style={styles.headerHeading}>
            <Text style={styles.headerEyebrow}>المجتمع مباشر الآن</Text>
            <Text style={styles.headerTitle}>الغرف</Text>
          </View>
          <View style={styles.headerActions}>
            <HeaderAction
              accessibilityLabel="البحث في الغرف"
              active={isSearchVisible}
              icon={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
              onPress={() => {
                setSearchVisible((visible) => !visible);
                if (isSearchVisible) setSearchQuery('');
              }}
            />
            {growthFlags.quickMatch ? (
              <HeaderAction
                accessibilityLabel="مطابقة سريعة"
                active={isMatching}
                icon={{ ios: 'shuffle', android: 'shuffle', web: 'shuffle' }}
                onPress={() => void handleQuickMatch()}
              />
            ) : null}
            <HeaderAction
              accessibilityLabel="إنشاء غرفة جديدة"
              emphasized
              icon={{ ios: 'plus', android: 'add', web: 'add' }}
              onPress={() => setCreateModalVisible(true)}
            />
          </View>
        </View>

        {isSearchVisible ? (
          <View style={styles.searchWrap}>
            <View style={styles.searchBar}>
              <SymbolView
                name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
                size={19}
                tintColor="#D5AD61"
              />
              <TextInput
                accessibilityLabel="البحث باسم الغرفة أو المضيف"
                autoFocus
                onChangeText={setSearchQuery}
                placeholder="اسم الغرفة أو المضيف"
                placeholderTextColor="#75665E"
                returnKeyType="search"
                style={styles.searchInput}
                value={searchQuery}
              />
              {searchQuery ? (
                <Pressable accessibilityLabel="مسح البحث" hitSlop={10} onPress={() => setSearchQuery('')}>
                  <SymbolView
                    name={{ ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' }}
                    size={19}
                    tintColor="#B8975D"
                  />
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        <View style={styles.content}>
          {roomsStatus === 'error' ? (
            <StatusNotice text="تعذر التحديث. نعرض آخر الغرف المتاحة مؤقتاً." />
          ) : null}
          {errorMessage ? <StatusNotice isError text={errorMessage} /> : null}

          {roomsStatus === 'loading' ? (
            <LobbySkeleton />
          ) : (
            <>
              {featuredRoom ? (
                <FeaturedRoomCard
                  avatarFrames={avatarFrames}
                  cosmeticsFlags={cosmeticsFlags}
                  isPending={pendingRoomId === featuredRoom.id}
                  onPress={() => void handleOpenRoom(featuredRoom)}
                  room={featuredRoom}
                />
              ) : null}

              {recentRooms.length ? (
                <RoomSection
                  actionLabel="تابع من حيث توقفت"
                  icon={{ ios: 'clock.arrow.circlepath', android: 'history', web: 'history' }}
                  title="زرتها مؤخراً"
                >
                  <ScrollView
                    contentContainerStyle={styles.horizontalCards}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                  >
                    {recentRooms.map((room) => (
                      <CompactRoomCard
                        isPending={pendingRoomId === room.id}
                        key={room.id}
                        onPress={() => void handleOpenRoom(room)}
                        room={room}
                      />
                    ))}
                  </ScrollView>
                </RoomSection>
              ) : null}

              {friendRooms.length ? (
                <RoomSection
                  actionLabel="أصدقاء داخل هذه الغرف"
                  icon={{ ios: 'person.2.fill', android: 'group', web: 'group' }}
                  title="أصدقاؤك هنا"
                >
                  <ScrollView
                    contentContainerStyle={styles.horizontalCards}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                  >
                    {friendRooms.map((room) => (
                      <CompactRoomCard
                        friendIds={friendIds}
                        isPending={pendingRoomId === room.id}
                        key={room.id}
                        onPress={() => void handleOpenRoom(room)}
                        room={room}
                      />
                    ))}
                  </ScrollView>
                </RoomSection>
              ) : null}

              <View style={styles.discoveryHeader}>
                <View style={styles.discoveryCopy}>
                  <View style={styles.liveTitleRow}>
                    <View style={styles.livePulse} />
                    <Text style={styles.discoveryTitle}>
                      {searchQuery ? 'نتائج البحث' : 'مباشر الآن'}
                    </Text>
                  </View>
                  <Text style={styles.discoverySubtitle}>
                    {searchQuery ? `نتائج مطابقة لـ “${searchQuery}”` : 'اختر المجلس الذي يناسب مزاجك'}
                  </Text>
                </View>
                <View pointerEvents="none" style={styles.discoveryOrnament}>
                  <View style={styles.ornamentLine} />
                  <View style={styles.ornamentGem} />
                </View>
              </View>

              <ScrollView
                accessibilityRole="tablist"
                contentContainerStyle={styles.filters}
                horizontal
                showsHorizontalScrollIndicator={false}
              >
                {roomFilters.map((item) => (
                  <FilterChip
                    active={filter === item.key}
                    icon={item.icon}
                    key={item.key}
                    label={item.label}
                    onPress={() => setFilter(item.key)}
                  />
                ))}
              </ScrollView>

              {liveRooms.length ? (
                <View style={styles.roomList}>
                  {liveRooms.map((room) => (
                    <RoomCard
                      avatarFrames={avatarFrames}
                      compact={compact}
                      cosmeticsFlags={cosmeticsFlags}
                      isPending={pendingRoomId === room.id}
                      key={room.id}
                      onPress={() => void handleOpenRoom(room)}
                      room={room}
                    />
                  ))}
                </View>
              ) : featuredRoom && !searchQuery && filter === 'all' ? (
                <View style={styles.featuredOnlyNote}>
                  <View style={styles.featuredOnlyLine} />
                  <Text style={styles.featuredOnlyText}>هذا هو المجلس النشط الآن</Text>
                  <View style={styles.featuredOnlyLine} />
                </View>
              ) : (
                <EmptyState
                  onCreate={() => setCreateModalVisible(true)}
                  searching={Boolean(searchQuery)}
                />
              )}
            </>
          )}

          {!hasDiscoveryContent && roomsStatus !== 'loading' && !searchQuery ? (
            <View style={styles.ambientFooter}>
              <View style={styles.ambientGem} />
            </View>
          ) : null}
        </View>
      </View>

      <CreateRoomModal
        errorMessage={createErrorMessage}
        inviteCode={createInviteCode}
        isCreating={isCreating}
        isPrivateRoom={isPrivateRoom}
        isVisible={isCreateModalVisible}
        onClose={() => {
          setCreateErrorMessage('');
          setCreateModalVisible(false);
        }}
        onCreate={() => void handleCreateRoom()}
        onInviteCodeChange={setCreateInviteCode}
        onSelectCountryCode={setSelectedCountryCode}
        onSelectType={setSelectedRoomType}
        onTogglePrivateRoom={() => setPrivateRoom((current) => !current)}
        selectedCountryCode={selectedCountryCode}
        selectedType={selectedRoomType}
      />
    </ScreenContainer>
  );
}

function FeaturedRoomCard({
  avatarFrames,
  cosmeticsFlags,
  isPending,
  onPress,
  room,
}: {
  avatarFrames: Record<string, AvatarFrameProjection>;
  cosmeticsFlags: CosmeticsFeatureFlags;
  isPending: boolean;
  onPress: () => void;
  room: VoiceRoom;
}) {
  const country = getRoomCountry(room.countryCode);
  const hostName = getVoiceRoomHostName(room) || 'مضيف الغرفة';
  const members = roomMembers(room).slice(0, 3);
  const artwork = getRoomArtwork(room);

  return (
    <Pressable
      accessibilityLabel={`دخول الغرفة المميزة ${room.title}`}
      accessibilityRole="button"
      disabled={isPending}
      onPress={onPress}
      style={({ pressed }) => [
        styles.featuredCard,
        pressed && styles.cardPressed,
        isPending && styles.disabled,
      ]}
    >
      <ImageBackground
        imageStyle={styles.featuredImage}
        resizeMode="cover"
        source={artwork}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={['rgba(4,2,3,0.08)', 'rgba(8,3,4,0.44)', 'rgba(6,2,3,0.97)']}
        end={{ x: 0.3, y: 1 }}
        start={{ x: 0.7, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={styles.featuredInnerBorder} />
      <View pointerEvents="none" style={styles.featuredCorner} />
      <View style={styles.featuredTopRow}>
        <View style={styles.featuredLivePill}>
          <View style={styles.livePulse} />
          <Text style={styles.featuredLiveText}>مباشر</Text>
        </View>
        <View style={styles.featuredLabel}>
          <SymbolView
            name={{ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }}
            size={13}
            tintColor="#F5D58A"
          />
          <Text style={styles.featuredLabelText}>اختيار الليلة</Text>
        </View>
      </View>
      <View style={styles.featuredBottom}>
        <View style={styles.featuredCopy}>
          <Text numberOfLines={1} style={styles.featuredTitle}>{room.title}</Text>
          <View style={styles.featuredMeta}>
            {country ? <Image source={country.flag} style={styles.countryFlag} /> : null}
            <Text numberOfLines={1} style={styles.featuredHost}>{hostName}</Text>
            <View style={styles.metaDivider} />
            <SymbolView
              name={{ ios: 'person.2.fill', android: 'group', web: 'group' }}
              size={14}
              tintColor="#D9B873"
            />
            <Text style={styles.featuredAudience}>{formatAudienceCount(room.participantCount)}</Text>
          </View>
          <Text numberOfLines={2} style={styles.featuredDescription}>{roomDescription(room)}</Text>
        </View>
        <View style={styles.featuredActionColumn}>
          <View style={styles.avatarStackLarge}>
            {members.map((member, index) => (
              <MemberAvatar cosmeticsFlags={cosmeticsFlags} frame={avatarFrames[member.id]} index={index} key={member.id} member={member} size="large" />
            ))}
          </View>
          <View style={styles.joinButton}>
            {isPending ? (
              <ActivityIndicator color="#2B0A0E" size="small" />
            ) : (
              <>
                <Text style={styles.joinButtonText}>ادخل الآن</Text>
                <SymbolView
                  name={{ ios: 'arrow.left', android: 'arrow_back', web: 'arrow_back' }}
                  size={16}
                  tintColor="#2B0A0E"
                />
              </>
            )}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function RoomSection({
  actionLabel,
  children,
  icon,
  title,
}: {
  actionLabel: string;
  children: ReactNode;
  icon: SymbolName;
  title: string;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleRow}>
          <View style={styles.sectionIcon}>
            <SymbolView name={icon} size={15} tintColor="#F0CC78" />
          </View>
          <View>
            <Text style={styles.sectionTitle}>{title}</Text>
            <Text style={styles.sectionHint}>{actionLabel}</Text>
          </View>
        </View>
        <View style={styles.sectionRule}>
          <View style={styles.sectionRuleGem} />
        </View>
      </View>
      {children}
    </View>
  );
}

function CompactRoomCard({
  friendIds,
  isPending,
  onPress,
  room,
}: {
  friendIds?: ReadonlySet<string>;
  isPending: boolean;
  onPress: () => void;
  room: VoiceRoom;
}) {
  const friend = friendIds
    ? roomMembers(room).find((member) => friendIds.has(member.id))
    : undefined;
  return (
    <Pressable
      accessibilityLabel={`فتح غرفة ${room.title}`}
      accessibilityRole="button"
      disabled={isPending}
      onPress={onPress}
      style={({ pressed }) => [
        styles.compactCard,
        pressed && styles.cardPressed,
        isPending && styles.disabled,
      ]}
    >
      <ImageBackground
        imageStyle={styles.compactImage}
        source={getRoomArtwork(room)}
        style={styles.compactArtwork}
      >
        <LinearGradient
          colors={['rgba(5,3,3,0.03)', 'rgba(5,3,3,0.9)']}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.compactLive}>
          <View style={styles.livePulseSmall} />
          <Text style={styles.compactLiveText}>مباشر</Text>
        </View>
      </ImageBackground>
      <View style={styles.compactCopy}>
        <Text numberOfLines={1} style={styles.compactTitle}>{room.title}</Text>
        <Text numberOfLines={1} style={styles.compactSubtitle}>
          {friend ? `${friend.displayName} موجود هنا` : roomDescription(room)}
        </Text>
        <View style={styles.compactMeta}>
          <Text style={styles.compactEnter}>دخول</Text>
          <View style={styles.compactAudience}>
            <SymbolView
              name={{ ios: 'person.2.fill', android: 'group', web: 'group' }}
              size={12}
              tintColor="#A98B59"
            />
            <Text style={styles.compactAudienceText}>{formatAudienceCount(room.participantCount)}</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function FilterChip({
  active,
  icon,
  label,
  onPress,
}: {
  active: boolean;
  icon: SymbolName;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.filterChip,
        active && styles.filterChipActive,
        pressed && styles.cardPressed,
      ]}
    >
      {active ? (
        <LinearGradient
          colors={['#8F1725', '#5B0B13']}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <SymbolView name={icon} size={15} tintColor={active ? '#FFE3A1' : '#9B825D'} />
      <Text style={[styles.filterLabel, active && styles.filterLabelActive]}>{label}</Text>
    </Pressable>
  );
}

function RoomCard({
  avatarFrames,
  compact,
  cosmeticsFlags,
  isPending,
  onPress,
  room,
}: {
  avatarFrames: Record<string, AvatarFrameProjection>;
  compact: boolean;
  cosmeticsFlags: CosmeticsFeatureFlags;
  isPending: boolean;
  onPress: () => void;
  room: VoiceRoom;
}) {
  const country = getRoomCountry(room.countryCode);
  const hostName = getVoiceRoomHostName(room) || 'مضيف الغرفة';
  const activeMembers = roomMembers(room).slice(0, 3);

  return (
    <Pressable
      accessibilityLabel={`فتح غرفة ${room.title}`}
      accessibilityRole="button"
      disabled={isPending}
      onPress={onPress}
      style={({ pressed }) => [
        styles.roomCard,
        compact && styles.roomCardCompact,
        pressed && styles.cardPressed,
        isPending && styles.disabled,
      ]}
    >
      <LinearGradient
        colors={['rgba(68,10,17,0.52)', 'rgba(17,10,11,0.98)', 'rgba(7,5,6,0.99)']}
        end={{ x: 0, y: 1 }}
        start={{ x: 1, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={styles.roomCardBorder} />
      <View pointerEvents="none" style={styles.roomCardAccent} />
      <ImageBackground
        imageStyle={styles.roomImage}
        resizeMode="cover"
        source={getRoomArtwork(room)}
        style={[styles.roomArtwork, compact && styles.roomArtworkCompact]}
      >
        <LinearGradient
          colors={['rgba(4,2,3,0)', 'rgba(4,2,3,0.42)']}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.roomTypeBadge}>
          <Text style={styles.roomTypeText}>{room.type === 'game' ? 'لعب' : 'صوت'}</Text>
        </View>
      </ImageBackground>

      <View style={styles.roomCopy}>
        <Text numberOfLines={1} style={[styles.roomTitle, compact && styles.roomTitleCompact]}>
          {room.title}
        </Text>
        <View style={styles.hostRow}>
          {country ? <Image source={country.flag} style={styles.countryFlag} /> : null}
          <Text numberOfLines={1} style={styles.hostName}>{hostName}</Text>
        </View>
        <Text numberOfLines={2} style={styles.roomDescription}>{roomDescription(room)}</Text>
        <View style={styles.roomFooter}>
          <View style={styles.avatarStack}>
            {activeMembers.length ? activeMembers.map((member, index) => (
              <MemberAvatar cosmeticsFlags={cosmeticsFlags} frame={avatarFrames[member.id]} index={index} key={member.id} member={member} />
            )) : (
              <View style={styles.noAudience}>
                <SymbolView
                  name={{ ios: 'person.2.fill', android: 'group', web: 'group' }}
                  size={17}
                  tintColor="#745F56"
                />
              </View>
            )}
          </View>
          <View style={styles.audienceNow}>
            <View style={styles.livePulseSmall} />
            <Text style={styles.audienceNowText}>{formatAudienceCount(room.participantCount)} الآن</Text>
          </View>
        </View>
      </View>

      <View style={styles.enterRoom}>
        {isPending ? (
          <ActivityIndicator color="#F1CD79" size="small" />
        ) : (
          <SymbolView
            name={{ ios: 'arrow.left', android: 'arrow_back', web: 'arrow_back' }}
            size={20}
            tintColor="#F1CD79"
          />
        )}
      </View>
    </Pressable>
  );
}

function HeaderAction({
  accessibilityLabel,
  active = false,
  emphasized = false,
  icon,
  onPress,
}: {
  accessibilityLabel: string;
  active?: boolean;
  emphasized?: boolean;
  icon: SymbolName;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.headerAction,
        (active || emphasized) && styles.headerActionActive,
        pressed && styles.cardPressed,
      ]}
    >
      <SymbolView
        name={icon}
        size={emphasized ? 23 : 20}
        tintColor={active || emphasized ? '#FFE09A' : '#B99B66'}
      />
    </Pressable>
  );
}

function MemberAvatar({
  cosmeticsFlags,
  frame,
  index,
  member,
  size = 'small',
}: {
  cosmeticsFlags: CosmeticsFeatureFlags;
  frame?: AvatarFrameProjection;
  index: number;
  member: VoiceRoomMember;
  size?: 'small' | 'large';
}) {
  const large = size === 'large';
  return (
    <View
      style={[
        styles.memberAvatar,
        large && styles.memberAvatarLarge,
        index > 0 && (large ? styles.memberAvatarLargeOverlap : styles.memberAvatarOverlap),
      ]}
    >
      <LinearGradient colors={getAvatarColors(member.id)} style={StyleSheet.absoluteFill} />
      <Text style={[styles.memberAvatarText, large && styles.memberAvatarTextLarge]}>
        {member.avatarLabel || member.displayName.slice(0, 1)}
      </Text>
      <AvatarFrameLayer flags={cosmeticsFlags} frame={frame} />
    </View>
  );
}

function EmptyState({
  onCreate,
  searching,
}: {
  onCreate: () => void;
  searching: boolean;
}) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyMedallion}>
        <View style={styles.emptyOrbit} />
        <SymbolView
          name={searching
            ? { ios: 'magnifyingglass', android: 'search', web: 'search' }
            : { ios: 'mic.fill', android: 'mic', web: 'mic' }}
          size={31}
          tintColor="#E3BB67"
        />
      </View>
      <Text style={styles.emptyTitle}>{searching ? 'لا توجد نتيجة مطابقة' : 'لا توجد غرف مباشرة الآن'}</Text>
      <Text style={styles.emptyBody}>
        {searching ? 'جرّب اسماً آخر أو غيّر نوع الغرفة.' : 'ابدأ مجلساً جديداً وادعُ أصدقاءك إليه.'}
      </Text>
      {!searching ? (
        <Pressable
          accessibilityRole="button"
          onPress={onCreate}
          style={({ pressed }) => [styles.emptyAction, pressed && styles.cardPressed]}
        >
          <SymbolView name={{ ios: 'plus', android: 'add', web: 'add' }} size={18} tintColor="#2B080C" />
          <Text style={styles.emptyActionText}>إنشاء غرفة</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function LobbySkeleton() {
  return (
    <View style={styles.skeletonWrap}>
      <View style={[styles.featuredCard, styles.skeleton]} />
      <View style={[styles.skeletonHeading, styles.skeleton]} />
      {[0, 1, 2].map((item) => (
        <View key={item} style={[styles.roomCard, styles.skeleton]} />
      ))}
    </View>
  );
}

function StatusNotice({ isError = false, text }: { isError?: boolean; text: string }) {
  return (
    <View style={[styles.notice, isError && styles.noticeError]}>
      <SymbolView
        name={{
          ios: isError ? 'exclamationmark.triangle.fill' : 'wifi.exclamationmark',
          android: isError ? 'warning' : 'wifi_off',
          web: isError ? 'warning' : 'wifi_off',
        }}
        size={17}
        tintColor={isError ? '#FFAAA7' : colors.goldSoft}
      />
      <Text style={[styles.noticeText, isError && styles.noticeTextError]}>{text}</Text>
    </View>
  );
}

function RoomBackdrop() {
  return (
    <View pointerEvents="none" style={styles.backdrop}>
      <View style={styles.backdropGlowTop} />
      <View style={styles.backdropGlowMiddle} />
      <View style={styles.backdropArch} />
      <View style={styles.backdropStars}>
        {[0, 1, 2, 3, 4].map((star) => <View key={star} style={[styles.backdropStar, { left: `${14 + star * 18}%` }]} />)}
      </View>
    </View>
  );
}

function getRoomArtwork(room: VoiceRoom) {
  const artworkSet = roomArtwork[room.type];
  return artworkSet[getRoomArtVariant(room.id, artworkSet.length)];
}

function roomMembers(room: VoiceRoom) {
  return [...room.speakers, ...room.listeners];
}

function roomDescription(room: VoiceRoom) {
  return room.announcement?.trim()
    || room.welcomeMessage?.trim()
    || (room.type === 'game'
      ? 'تحديات وألعاب جماعية بانتظارك'
      : 'حديث مباشر ومجلس مفتوح للجميع');
}

function formatAudienceCount(count: number) {
  if (count < 1_000) return `${count}`;
  if (count < 1_000_000) return `${(count / 1_000).toFixed(count >= 10_000 ? 0 : 1)}K`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

function getAvatarColors(memberId: string): readonly [string, string] {
  const palettes = [
    ['#8E1C2A', '#2B080D'],
    ['#785126', '#211207'],
    ['#5E283B', '#1D0910'],
    ['#73402C', '#241009'],
  ] as const;
  return palettes[getRoomArtVariant(memberId, palettes.length)];
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  backdrop: {
    backgroundColor: '#060304',
    bottom: 0,
    left: 0,
    overflow: 'hidden',
    position: 'absolute',
    right: 0,
    top: 0,
  },
  backdropGlowTop: {
    backgroundColor: 'rgba(127,15,29,0.22)',
    borderRadius: 210,
    height: 390,
    position: 'absolute',
    right: -210,
    top: 60,
    width: 390,
  },
  backdropGlowMiddle: {
    backgroundColor: 'rgba(97,11,22,0.12)',
    borderRadius: 230,
    height: 460,
    left: -310,
    position: 'absolute',
    top: 620,
    width: 460,
  },
  backdropArch: {
    borderColor: 'rgba(205,155,72,0.08)',
    borderRadius: 240,
    borderWidth: 1,
    height: 520,
    position: 'absolute',
    right: -290,
    top: 470,
    width: 480,
  },
  backdropStars: {
    height: 130,
    left: 0,
    opacity: 0.45,
    position: 'absolute',
    right: 0,
    top: 120,
  },
  backdropStar: {
    backgroundColor: '#CFA854',
    borderRadius: radius.full,
    height: 2,
    position: 'absolute',
    top: 20,
    transform: [{ rotate: '45deg' }],
    width: 2,
  },
  header: {
    alignItems: 'center',
    backgroundColor: 'rgba(5,3,4,0.96)',
    borderBottomColor: 'rgba(201,151,66,0.32)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    paddingBottom: 12,
    paddingHorizontal: spacing.lg,
    paddingTop: 10,
  },
  headerHeading: {
    alignItems: 'flex-end',
  },
  headerEyebrow: {
    color: '#9D8054',
    fontSize: 9,
    fontWeight: typography.weights.bold,
    letterSpacing: 0.4,
    writingDirection: 'rtl',
  },
  headerTitle: {
    color: '#FFF0CF',
    fontSize: 28,
    fontWeight: typography.weights.black,
    lineHeight: 32,
    writingDirection: 'rtl',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  headerAction: {
    alignItems: 'center',
    backgroundColor: 'rgba(31,11,14,0.72)',
    borderColor: 'rgba(208,163,81,0.40)',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 42,
  },
  headerActionActive: {
    backgroundColor: '#791420',
    borderColor: '#E0B85D',
    shadowColor: '#B51C2C',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
  },
  searchWrap: {
    backgroundColor: 'rgba(5,3,4,0.96)',
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  searchBar: {
    alignItems: 'center',
    backgroundColor: '#100708',
    borderColor: 'rgba(213,173,97,0.42)',
    borderRadius: radius.full,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  searchInput: {
    color: '#FFF2D7',
    flex: 1,
    fontSize: 14,
    minHeight: 46,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  content: {
    gap: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  featuredCard: {
    borderColor: '#B98536',
    borderRadius: 24,
    borderWidth: 1,
    height: 252,
    justifyContent: 'space-between',
    overflow: 'hidden',
    padding: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.52,
    shadowRadius: 24,
  },
  featuredImage: {
    borderRadius: 23,
  },
  featuredInnerBorder: {
    borderColor: 'rgba(255,223,152,0.20)',
    borderRadius: 19,
    borderWidth: 1,
    bottom: 5,
    left: 5,
    position: 'absolute',
    right: 5,
    top: 5,
  },
  featuredCorner: {
    borderRightColor: '#F0C56B',
    borderRightWidth: 2,
    borderTopColor: '#F0C56B',
    borderTopRightRadius: 10,
    borderTopWidth: 2,
    height: 42,
    position: 'absolute',
    right: 9,
    top: 9,
    width: 42,
  },
  featuredTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  featuredLivePill: {
    alignItems: 'center',
    backgroundColor: 'rgba(104,12,24,0.92)',
    borderColor: 'rgba(242,191,93,0.56)',
    borderRadius: radius.full,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  featuredLiveText: {
    color: '#FFE8B3',
    fontSize: 10,
    fontWeight: typography.weights.black,
  },
  featuredLabel: {
    alignItems: 'center',
    backgroundColor: 'rgba(5,3,4,0.72)',
    borderColor: 'rgba(226,183,94,0.38)',
    borderRadius: radius.full,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  featuredLabelText: {
    color: '#E8C779',
    fontSize: 10,
    fontWeight: typography.weights.bold,
  },
  featuredBottom: {
    alignItems: 'flex-end',
    flexDirection: 'row-reverse',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  featuredCopy: {
    alignItems: 'flex-end',
    flex: 1,
    gap: 5,
  },
  featuredTitle: {
    color: '#FFF4DC',
    fontSize: 25,
    fontWeight: typography.weights.black,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  featuredMeta: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: 6,
  },
  countryFlag: {
    borderRadius: 2,
    height: 14,
    width: 20,
  },
  featuredHost: {
    color: '#D7B66F',
    flexShrink: 1,
    fontSize: 11,
    fontWeight: typography.weights.bold,
  },
  metaDivider: {
    backgroundColor: 'rgba(224,181,92,0.42)',
    height: 12,
    width: StyleSheet.hairlineWidth,
  },
  featuredAudience: {
    color: '#D7B66F',
    fontSize: 11,
    fontWeight: typography.weights.black,
  },
  featuredDescription: {
    color: '#C8B8A4',
    fontSize: 11,
    lineHeight: 17,
    maxWidth: 270,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  featuredActionColumn: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  avatarStackLarge: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    minHeight: 38,
  },
  joinButton: {
    alignItems: 'center',
    backgroundColor: '#E8C367',
    borderColor: '#FFE2A0',
    borderRadius: radius.full,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: 5,
    minHeight: 38,
    minWidth: 104,
    justifyContent: 'center',
    paddingHorizontal: 13,
  },
  joinButtonText: {
    color: '#2B0A0E',
    fontSize: 11,
    fontWeight: typography.weights.black,
  },
  section: {
    gap: spacing.sm,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: spacing.md,
  },
  sectionTitleRow: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: spacing.sm,
  },
  sectionIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(105,17,27,0.58)',
    borderColor: 'rgba(221,175,86,0.40)',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  sectionTitle: {
    color: '#F9E4B7',
    fontSize: 16,
    fontWeight: typography.weights.black,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  sectionHint: {
    color: '#806E60',
    fontSize: 9,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  sectionRule: {
    backgroundColor: 'rgba(185,133,51,0.22)',
    flex: 1,
    height: StyleSheet.hairlineWidth,
    position: 'relative',
  },
  sectionRuleGem: {
    backgroundColor: '#8F1A27',
    borderColor: '#C89A48',
    borderWidth: 1,
    height: 7,
    position: 'absolute',
    right: -3,
    top: -3,
    transform: [{ rotate: '45deg' }],
    width: 7,
  },
  horizontalCards: {
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    paddingVertical: 2,
  },
  compactCard: {
    backgroundColor: '#100809',
    borderColor: 'rgba(193,145,65,0.44)',
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    width: 174,
  },
  compactArtwork: {
    height: 92,
    justifyContent: 'flex-end',
  },
  compactImage: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  compactLive: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(82,10,19,0.88)',
    borderTopRightRadius: 8,
    flexDirection: 'row-reverse',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  compactLiveText: {
    color: '#F3C970',
    fontSize: 8,
    fontWeight: typography.weights.black,
  },
  compactCopy: {
    alignItems: 'flex-end',
    gap: 4,
    padding: 10,
  },
  compactTitle: {
    color: '#FFF0D0',
    fontSize: 13,
    fontWeight: typography.weights.black,
    textAlign: 'right',
    width: '100%',
    writingDirection: 'rtl',
  },
  compactSubtitle: {
    color: '#8F7B6D',
    fontSize: 9,
    textAlign: 'right',
    width: '100%',
    writingDirection: 'rtl',
  },
  compactMeta: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    marginTop: 2,
    width: '100%',
  },
  compactEnter: {
    color: '#DAB65F',
    fontSize: 10,
    fontWeight: typography.weights.black,
  },
  compactAudience: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: 4,
  },
  compactAudienceText: {
    color: '#A98B59',
    fontSize: 9,
    fontWeight: typography.weights.bold,
  },
  discoveryHeader: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: spacing.md,
  },
  discoveryCopy: {
    alignItems: 'flex-end',
  },
  liveTitleRow: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: 7,
  },
  discoveryTitle: {
    color: '#FFF0CF',
    fontSize: 21,
    fontWeight: typography.weights.black,
    writingDirection: 'rtl',
  },
  discoverySubtitle: {
    color: '#897568',
    fontSize: 10,
    marginTop: 2,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  discoveryOrnament: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
  },
  ornamentLine: {
    backgroundColor: 'rgba(192,139,52,0.28)',
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  ornamentGem: {
    backgroundColor: '#9C1C2B',
    borderColor: '#D4A552',
    borderWidth: 1,
    height: 8,
    transform: [{ rotate: '45deg' }],
    width: 8,
  },
  filters: {
    flexDirection: 'row-reverse',
    gap: 8,
  },
  filterChip: {
    alignItems: 'center',
    backgroundColor: 'rgba(18,10,11,0.92)',
    borderColor: 'rgba(189,145,71,0.30)',
    borderRadius: radius.full,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: 6,
    minHeight: 38,
    minWidth: 82,
    justifyContent: 'center',
    overflow: 'hidden',
    paddingHorizontal: 14,
  },
  filterChipActive: {
    borderColor: '#DBAE56',
  },
  filterLabel: {
    color: '#9B825D',
    fontSize: 11,
    fontWeight: typography.weights.bold,
  },
  filterLabelActive: {
    color: '#FFE3A1',
    fontWeight: typography.weights.black,
  },
  roomList: {
    gap: spacing.sm,
  },
  roomCard: {
    alignItems: 'center',
    borderColor: 'rgba(188,137,55,0.42)',
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    minHeight: 126,
    overflow: 'hidden',
    padding: 9,
  },
  roomCardCompact: {
    minHeight: 116,
  },
  roomCardBorder: {
    borderColor: 'rgba(255,225,158,0.09)',
    borderRadius: radius.lg - 3,
    borderWidth: 1,
    bottom: 4,
    left: 4,
    position: 'absolute',
    right: 4,
    top: 4,
  },
  roomCardAccent: {
    backgroundColor: '#A91D2B',
    bottom: 16,
    position: 'absolute',
    right: 0,
    top: 16,
    width: 3,
  },
  roomArtwork: {
    borderColor: 'rgba(220,173,84,0.55)',
    borderRadius: radius.md,
    borderWidth: 1,
    height: 106,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    width: 106,
  },
  roomArtworkCompact: {
    height: 92,
    width: 92,
  },
  roomImage: {
    borderRadius: radius.md,
  },
  roomTypeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(73,11,18,0.92)',
    borderTopRightRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  roomTypeText: {
    color: '#E8C66F',
    fontSize: 8,
    fontWeight: typography.weights.black,
  },
  roomCopy: {
    alignItems: 'flex-end',
    flex: 1,
    gap: 5,
    minWidth: 0,
  },
  roomTitle: {
    color: '#FFF2D9',
    fontSize: 17,
    fontWeight: typography.weights.black,
    maxWidth: '100%',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  roomTitleCompact: {
    fontSize: 15,
  },
  hostRow: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: 6,
    maxWidth: '100%',
  },
  hostName: {
    color: '#BC995B',
    flexShrink: 1,
    fontSize: 10,
    fontWeight: typography.weights.semibold,
  },
  roomDescription: {
    color: '#948179',
    fontSize: 10,
    lineHeight: 15,
    maxWidth: '100%',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  roomFooter: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    marginTop: 'auto',
    width: '100%',
  },
  avatarStack: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    minHeight: 23,
  },
  audienceNow: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: 5,
  },
  audienceNowText: {
    color: '#B49A69',
    fontSize: 9,
    fontWeight: typography.weights.bold,
  },
  enterRoom: {
    alignItems: 'center',
    alignSelf: 'stretch',
    borderLeftColor: 'rgba(201,153,68,0.20)',
    borderLeftWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    width: 34,
  },
  memberAvatar: {
    alignItems: 'center',
    borderColor: '#B9853B',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 23,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 23,
  },
  memberAvatarLarge: {
    borderColor: '#E0B65C',
    borderWidth: 1.5,
    height: 37,
    width: 37,
  },
  memberAvatarOverlap: {
    marginRight: -7,
  },
  memberAvatarLargeOverlap: {
    marginRight: -10,
  },
  memberAvatarText: {
    color: '#FFF0D3',
    fontSize: 9,
    fontWeight: typography.weights.black,
  },
  memberAvatarTextLarge: {
    fontSize: 13,
  },
  noAudience: {
    alignItems: 'center',
    height: 23,
    justifyContent: 'center',
    width: 23,
  },
  livePulse: {
    backgroundColor: '#F03849',
    borderColor: '#FF9AA4',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 8,
    shadowColor: '#FF3046',
    shadowOpacity: 0.8,
    shadowRadius: 5,
    width: 8,
  },
  livePulseSmall: {
    backgroundColor: '#E82B3D',
    borderRadius: radius.full,
    height: 5,
    width: 5,
  },
  featuredOnlyNote: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  featuredOnlyLine: {
    backgroundColor: 'rgba(183,132,48,0.24)',
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  featuredOnlyText: {
    color: '#7F6A55',
    fontSize: 10,
    writingDirection: 'rtl',
  },
  notice: {
    alignItems: 'center',
    backgroundColor: 'rgba(87,57,13,0.26)',
    borderColor: 'rgba(216,168,78,0.30)',
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  noticeError: {
    backgroundColor: 'rgba(111,19,28,0.30)',
    borderColor: 'rgba(241,91,103,0.38)',
  },
  noticeText: {
    color: colors.goldSoft,
    flex: 1,
    fontSize: 12,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  noticeTextError: {
    color: '#FFB5B1',
  },
  emptyState: {
    alignItems: 'center',
    backgroundColor: 'rgba(16,8,9,0.88)',
    borderColor: 'rgba(193,139,53,0.34)',
    borderRadius: radius.xl,
    borderWidth: 1,
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  emptyMedallion: {
    alignItems: 'center',
    backgroundColor: 'rgba(105,18,28,0.44)',
    borderColor: 'rgba(220,174,82,0.46)',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 68,
    justifyContent: 'center',
    marginBottom: spacing.xs,
    width: 68,
  },
  emptyOrbit: {
    borderColor: 'rgba(236,196,111,0.22)',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 80,
    position: 'absolute',
    transform: [{ rotate: '24deg' }],
    width: 52,
  },
  emptyTitle: {
    color: '#FFF1CE',
    fontSize: 18,
    fontWeight: typography.weights.black,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  emptyBody: {
    color: '#9B8980',
    fontSize: 12,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  emptyAction: {
    alignItems: 'center',
    backgroundColor: '#E1B95F',
    borderColor: '#FFE0A0',
    borderRadius: radius.full,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: 6,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  emptyActionText: {
    color: '#2B080C',
    fontSize: 12,
    fontWeight: typography.weights.black,
  },
  skeletonWrap: {
    gap: spacing.md,
  },
  skeleton: {
    backgroundColor: 'rgba(151,115,74,0.14)',
    borderColor: 'rgba(197,149,71,0.12)',
  },
  skeletonHeading: {
    borderRadius: radius.full,
    height: 20,
    width: 140,
  },
  ambientFooter: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  ambientGem: {
    backgroundColor: '#7A1420',
    borderColor: '#C49543',
    borderWidth: 1,
    height: 8,
    transform: [{ rotate: '45deg' }],
    width: 8,
  },
  disabled: {
    opacity: 0.62,
  },
  cardPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.99 }],
  },
});
