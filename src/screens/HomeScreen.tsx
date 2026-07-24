import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import { ReactNode, useMemo, useRef, useState } from 'react';
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
  View,
} from 'react-native';

import { CreateRoomModal } from '../components/CreateRoomModal';
import { ScreenContainer } from '../components/ScreenContainer';
import { getRoomCountry, roomCountries } from '../data/roomCountries';
import {
  HomeCountryFilter,
  HomeMode,
  HomeQuickFilter,
  getCreateRoomDefaultCountry,
  getRoomArtVariant,
  getVoiceRoomHostName,
  selectHomeDiscoveryRooms,
  toggleHomeQuickFilter,
} from '../home/homeDiscovery';
import { radius, spacing, typography } from '../theme';
import { RoomCountryCode, VoiceRoom, VoiceRoomType } from '../types/voice';
import { normalizeInviteCode } from '../voice/roomProfile';
import { useVoiceRooms } from '../voice/useVoiceRooms';

const bannerArtwork = require('../../assets/home/home-banner.jpg') as ImageSourcePropType;
const voiceRoyalArtwork = require('../../assets/home/room-voice-royal-v3.jpg') as ImageSourcePropType;
const voiceSalonArtwork = require('../../assets/home/room-voice-salon-v3.jpg') as ImageSourcePropType;
const voiceAnonymousArtwork = require('../../assets/home/room-voice-anonymous-v3.jpg') as ImageSourcePropType;
const gameCarromArtwork = require('../../assets/home/room-game-carrom-v3.jpg') as ImageSourcePropType;
const gamePartyArtwork = require('../../assets/home/room-game-party-v3.jpg') as ImageSourcePropType;
const featurePopularArtwork = require('../../assets/home/feature-popular.jpg') as ImageSourcePropType;
const featureVoiceArtwork = require('../../assets/home/feature-voice.jpg') as ImageSourcePropType;
const featureGameArtwork = require('../../assets/home/feature-game.jpg') as ImageSourcePropType;
const voiceRoomArtwork: ImageSourcePropType[] = [
  voiceRoyalArtwork,
  voiceSalonArtwork,
  voiceAnonymousArtwork,
];
const gameRoomArtwork: ImageSourcePropType[] = [
  gameCarromArtwork,
  gamePartyArtwork,
];

const searchIcon = require('../../assets/home/icons/search.png') as ImageSourcePropType;
const accountIcon = require('../../assets/home/icons/profile.png') as ImageSourcePropType;
const addRoomIcon = require('../../assets/home/icons/add-room.png') as ImageSourcePropType;
const myRoomIcon = require('../../assets/home/icons/voice.png') as ImageSourcePropType;
const filterIcon = require('../../assets/home/icons/filter.png') as ImageSourcePropType;
const globeIcon = require('../../assets/home/icons/globe.png') as ImageSourcePropType;

const modes: ReadonlyArray<{ key: HomeMode; label: string }> = [
  { key: 'visited', label: 'غرف زرتها' },
  { key: 'popular', label: 'شائع' },
  { key: 'activity', label: 'النشاط' },
];

const featureCards: ReadonlyArray<{
  artwork: ImageSourcePropType;
  filter: Exclude<HomeQuickFilter, 'all'>;
  label: string;
}> = [
  { artwork: featurePopularArtwork, filter: 'popular', label: 'الأكثر حضوراً' },
  { artwork: featureVoiceArtwork, filter: 'voice', label: 'مجالس صوتية' },
  { artwork: featureGameArtwork, filter: 'game', label: 'غرف ألعاب' },
];

type HomeScreenProps = {
  bottomNavigation: ReactNode;
  onOpenProfile: () => void;
  onOpenVoiceRoom: (roomId: string) => void;
};

export function HomeScreen({
  bottomNavigation,
  onOpenProfile,
  onOpenVoiceRoom,
}: HomeScreenProps) {
  const countryRailRef = useRef<ScrollView>(null);
  const {
    createPrivateRoom,
    createRoom,
    forgetVisitedRoom,
    isMyActiveRoomLoading,
    joinRoom,
    myActiveRoom,
    rooms,
    roomsStatus,
    visitedRooms,
  } = useVoiceRooms();
  const [mode, setMode] = useState<HomeMode>('activity');
  const [quickFilter, setQuickFilter] = useState<HomeQuickFilter>('all');
  const [country, setCountry] = useState<HomeCountryFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchVisible, setSearchVisible] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [createErrorMessage, setCreateErrorMessage] = useState('');
  const [pendingRoomId, setPendingRoomId] = useState<string>();
  const [isCreateModalVisible, setCreateModalVisible] = useState(false);
  const [isCreating, setCreating] = useState(false);
  const [isPrivateRoom, setPrivateRoom] = useState(false);
  const [createInviteCode, setCreateInviteCode] = useState('');
  const [selectedCountryCode, setSelectedCountryCode] = useState<RoomCountryCode>('IQ');
  const [selectedRoomType, setSelectedRoomType] = useState<VoiceRoomType>('voice');

  const visibleRooms = useMemo(
    () =>
      selectHomeDiscoveryRooms(rooms, {
        country,
        mode,
        quickFilter,
        searchQuery,
        visitedRooms,
      }).slice(0, 40),
    [country, mode, quickFilter, rooms, searchQuery, visitedRooms],
  );

  const resetDiscovery = () => {
    setMode('activity');
    setQuickFilter('all');
    setCountry('all');
    setSearchQuery('');
    setErrorMessage('');
  };

  const handleAdaptiveRoomAction = async () => {
    if (isMyActiveRoomLoading) {
      return;
    }

    setErrorMessage('');
    setCreateErrorMessage('');

    if (myActiveRoom) {
      setPendingRoomId(myActiveRoom.id);

      try {
        const joinedRoom = await joinRoom(myActiveRoom.id);
        onOpenVoiceRoom(joinedRoom.id);
      } catch {
        setErrorMessage('تعذر فتح غرفتك الآن. تحقق من الاتصال وحاول مرة أخرى.');
      } finally {
        setPendingRoomId(undefined);
      }
      return;
    }

    setSelectedCountryCode(getCreateRoomDefaultCountry(country));
    setCreateModalVisible(true);
  };

  const handleCreateRoom = async () => {
    setErrorMessage('');
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

  const handleOpenRoom = async (room: VoiceRoom) => {
    setErrorMessage('');
    setPendingRoomId(room.id);

    try {
      const joinedRoom = await joinRoom(room.id);
      onOpenVoiceRoom(joinedRoom.id);
    } catch {
      if (mode === 'visited') {
        await forgetVisitedRoom(room.id);
      }
      setErrorMessage('تعذر فتح الغرفة. ربما انتهت أو لم تعد متاحة.');
    } finally {
      setPendingRoomId(undefined);
    }
  };

  return (
    <ScreenContainer
      bottomInset
      fixedBottom={bottomNavigation}
      horizontalPadding={0}
      topPadding={0}
      variant="ruby"
    >
      <View style={styles.page}>
        <LinearGradient
          colors={['rgba(91,8,15,0.86)', 'rgba(19,5,6,0.98)', 'rgba(4,4,4,0.98)']}
          end={{ x: 0, y: 0.8 }}
          start={{ x: 1, y: 0 }}
          style={styles.discoveryHeader}
        >
          <View style={styles.headerRail}>
            <View style={styles.headerActions}>
              <IconButton
                accessibilityLabel="البحث في الغرف"
                icon={searchIcon}
                isActive={isSearchVisible}
                onPress={() => setSearchVisible((visible) => !visible)}
              />
              <IconButton
                accessibilityLabel="فتح الملف الشخصي"
                icon={accountIcon}
                onPress={onOpenProfile}
              />
            </View>
            <View accessibilityRole="tablist" style={styles.modeRail}>
              {modes.map((item) => {
                const isSelected = mode === item.key;

                return (
                  <Pressable
                    accessibilityRole="tab"
                    accessibilityState={{ selected: isSelected }}
                    key={item.key}
                    onPress={() => setMode(item.key)}
                    style={({ pressed }) => [
                      styles.modeButton,
                      isSelected && styles.modeButtonSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text numberOfLines={1} style={[styles.modeLabel, isSelected && styles.modeLabelSelected]}>{item.label}</Text>
                    {isSelected ? <View style={styles.modeIndicator} /> : null}
                  </Pressable>
                );
              })}
              <Pressable
                accessibilityRole="button"
                disabled={isMyActiveRoomLoading || pendingRoomId === myActiveRoom?.id}
                onPress={() => void handleAdaptiveRoomAction()}
                style={({ pressed }) => [
                  styles.roomAction,
                  (isMyActiveRoomLoading || pendingRoomId === myActiveRoom?.id) && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                {isMyActiveRoomLoading || pendingRoomId === myActiveRoom?.id ? (
                  <ActivityIndicator color="#F7D67C" size="small" />
                ) : (
                  <Image source={myActiveRoom ? myRoomIcon : addRoomIcon} style={styles.roomActionIcon} />
                )}
                <Text numberOfLines={1} style={styles.roomActionLabel}>
                  {myActiveRoom ? 'غرفتي' : 'إنشاء غرفة'}
                </Text>
              </Pressable>
            </View>
          </View>

          {isSearchVisible ? (
            <View style={styles.searchBar}>
              <Image source={searchIcon} style={styles.searchGlyph} />
              <TextInput
                accessibilityLabel="البحث باسم الغرفة أو المضيف"
                autoFocus
                onChangeText={setSearchQuery}
                placeholder="ابحث باسم الغرفة أو المضيف"
                placeholderTextColor="#8C7B72"
                returnKeyType="search"
                style={styles.searchInput}
                value={searchQuery}
              />
              {searchQuery ? (
                <Pressable accessibilityLabel="مسح البحث" hitSlop={10} onPress={() => setSearchQuery('')}>
                  <Text style={styles.clearSearch}>×</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

        </LinearGradient>

        <Pressable
          accessibilityLabel="عرض جميع الغرف النشطة"
          onPress={resetDiscovery}
          style={({ pressed }) => [styles.bannerShell, pressed && styles.pressed]}
        >
          <ImageBackground imageStyle={styles.coverImage} resizeMode="cover" source={bannerArtwork} style={styles.banner}>
            <LinearGradient
              colors={['rgba(4,3,3,0.12)', 'rgba(3,3,3,0.82)']}
              end={{ x: 0, y: 0.5 }}
              start={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.bannerCopy}>
              <Text style={styles.bannerKicker}>كنز اليوم</Text>
              <Text style={styles.bannerTitle}>نشاط الشحن اليومي</Text>
              <Text style={styles.bannerBody}>
                {rooms.length > 0 ? `${rooms.length} غرف نشطة بانتظارك` : 'ابدأ أول مجلس لهذا المساء'}
              </Text>
            </View>
          </ImageBackground>
        </Pressable>

        <View style={styles.featureRow}>
          {featureCards.map((card) => {
            const isSelected = quickFilter === card.filter;

            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                key={card.filter}
                onPress={() => {
                  setQuickFilter((current) => toggleHomeQuickFilter(current, card.filter));
                }}
                style={({ pressed }) => [
                  styles.featureCard,
                  isSelected && styles.featureCardSelected,
                  pressed && styles.pressed,
                ]}
              >
                <ImageBackground imageStyle={styles.coverImage} resizeMode="cover" source={card.artwork} style={styles.featureArt}>
                  <LinearGradient
                    colors={['rgba(5,3,3,0.02)', 'rgba(5,3,3,0.68)']}
                    style={StyleSheet.absoluteFill}
                  />
                  <Text numberOfLines={2} style={styles.featureLabel}>{card.label}</Text>
                </ImageBackground>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.countrySection}>
          <Image source={filterIcon} style={styles.filterIcon} />
          <ScrollView
            contentContainerStyle={styles.countryRail}
            horizontal
            onContentSizeChange={() => countryRailRef.current?.scrollToEnd({ animated: false })}
            ref={countryRailRef}
            showsHorizontalScrollIndicator={false}
            style={styles.countryScroller}
          >
          <CountryButton
            accessibilityLabel="كل الدول"
            isSelected={country === 'all'}
            onPress={() => setCountry('all')}
          >
            <Image source={globeIcon} style={[styles.globeIcon, country !== 'all' && styles.iconMuted]} />
          </CountryButton>
          {roomCountries.map((item) => (
            <CountryButton
              accessibilityLabel={item.label}
              isSelected={country === item.code}
              key={item.code}
              onPress={() => {
                setCountry(item.code);
                setSelectedCountryCode(item.code);
              }}
            >
              <Image resizeMode="contain" source={item.flag} style={styles.countryFlag} />
            </CountryButton>
          ))}
          </ScrollView>
        </View>

        {roomsStatus === 'error' ? (
          <StatusNotice text="تعذر التحديث · نعرض غرفاً تجريبية مؤقتاً" />
        ) : null}
        {errorMessage ? <StatusNotice isError text={errorMessage} /> : null}

        {roomsStatus === 'loading' ? (
          <View style={styles.roomGrid}>
            {[0, 1, 2, 3].map((item) => <RoomSkeleton key={item} />)}
          </View>
        ) : visibleRooms.length > 0 ? (
          <View style={styles.roomGrid}>
            {visibleRooms.map((room) => (
              <RoomCard
                isPending={pendingRoomId === room.id}
                key={room.id}
                onPress={() => void handleOpenRoom(room)}
                room={room}
              />
            ))}
          </View>
        ) : (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconShell}>
              <Image source={myRoomIcon} style={styles.emptyIcon} />
            </View>
            <Text style={styles.emptyTitle}>
              {mode === 'visited' ? 'لم تزر أي غرفة بعد' : 'لا توجد غرف بهذه الخيارات'}
            </Text>
            <Text style={styles.emptyBody}>غيّر التصفية أو أنشئ غرفة جديدة وابدأ المجلس.</Text>
            <View style={styles.emptyActions}>
              <Pressable onPress={resetDiscovery} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonLabel}>مسح التصفية</Text>
              </Pressable>
              <Pressable
                disabled={isMyActiveRoomLoading}
                onPress={() => void handleAdaptiveRoomAction()}
                style={[styles.primaryButton, isMyActiveRoomLoading && styles.disabled]}
              >
                <Text style={styles.primaryButtonLabel}>{myActiveRoom ? 'فتح غرفتي' : 'إنشاء غرفة'}</Text>
              </Pressable>
            </View>
          </View>
        )}
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

type IconButtonProps = {
  accessibilityLabel: string;
  icon: ImageSourcePropType;
  isActive?: boolean;
  onPress: () => void;
};

function IconButton({ accessibilityLabel, icon, isActive = false, onPress }: IconButtonProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        isActive && styles.iconButtonActive,
        pressed && styles.pressed,
      ]}
    >
      <Image source={icon} style={[styles.headerIcon, !isActive && styles.headerIconIdle]} />
    </Pressable>
  );
}

type CountryButtonProps = {
  accessibilityLabel: string;
  children: ReactNode;
  isSelected: boolean;
  onPress: () => void;
};

function CountryButton({ accessibilityLabel, children, isSelected, onPress }: CountryButtonProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="radio"
      accessibilityState={{ checked: isSelected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.countryButton,
        isSelected && styles.countryButtonSelected,
        pressed && styles.pressed,
      ]}
    >
      {children}
    </Pressable>
  );
}

type RoomCardProps = {
  isPending: boolean;
  onPress: () => void;
  room: VoiceRoom;
};

function RoomCard({ isPending, onPress, room }: RoomCardProps) {
  const hostName = getVoiceRoomHostName(room) || 'المضيف';
  const roomCountry = getRoomCountry(room.countryCode);
  const artSeed = `${room.id}:${room.countryCode ?? 'all'}`;
  const artworkPool = room.type === 'game' ? gameRoomArtwork : voiceRoomArtwork;
  const art = room.type === 'voice' && room.participantCount >= 20
    ? voiceRoyalArtwork
    : artworkPool[getRoomArtVariant(artSeed, artworkPool.length)];
  const previewMembers = [...room.speakers, ...room.listeners].slice(0, 3);

  return (
    <Pressable
      accessibilityLabel={`${room.title}، ${room.participantCount} حاضر`}
      accessibilityRole="button"
      disabled={isPending}
      onPress={onPress}
      style={({ pressed }) => [styles.roomCard, pressed && styles.roomCardPressed, isPending && styles.disabled]}
    >
      <View style={styles.roomArtShell}>
        <ImageBackground imageStyle={styles.coverImage} resizeMode="cover" source={art} style={styles.roomArt}>
          <LinearGradient
            colors={['rgba(3,3,3,0.02)', 'rgba(3,3,3,0.88)']}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.roomTopMeta}>
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveLabel}>{room.type === 'game' ? 'لعب' : 'صوت'}</Text>
            </View>
            <View style={styles.peopleBadge}>
              <Text style={styles.peopleCount}>{room.participantCount}</Text>
              <SymbolView
                name={{ ios: 'person.2.fill', android: 'group', web: 'group' }}
                size={15}
                style={styles.peopleIcon}
                tintColor="#F3CC70"
              />
            </View>
          </View>
          <View style={styles.roomArtFooter}>
            <View style={styles.hostRow}>
              <View style={styles.avatarStack}>
                {previewMembers.map((member, index) => (
                  <View key={member.id} style={[styles.miniAvatar, index > 0 && styles.miniAvatarOverlap]}>
                    <Text style={styles.miniAvatarText}>{member.avatarLabel}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.hostCopy}>
                <Text numberOfLines={1} style={styles.hostName}>{hostName}</Text>
                <Text style={styles.hostRole}>المضيف</Text>
              </View>
            </View>
          </View>
          {isPending ? (
            <View style={styles.pendingOverlay}>
              <ActivityIndicator color="#F3CC70" />
              <Text style={styles.pendingText}>جارٍ الدخول</Text>
            </View>
          ) : null}
        </ImageBackground>
      </View>
      <View style={styles.roomCaption}>
        <Text numberOfLines={1} style={styles.roomTitle}>{room.title}</Text>
        <View accessibilityLabel={roomCountry?.label ?? 'كل الدول'} accessible style={styles.roomFlagShell}>
          {roomCountry ? (
            <Image resizeMode="contain" source={roomCountry.flag} style={styles.roomFlagImage} />
          ) : (
            <Image source={globeIcon} style={styles.roomFlagGlobe} />
          )}
        </View>
      </View>
    </Pressable>
  );
}

function RoomSkeleton() {
  return (
    <View style={styles.roomCard}>
      <View style={[styles.roomArtShell, styles.skeleton]} />
      <View style={styles.skeletonLine} />
      <View style={styles.skeletonLineShort} />
    </View>
  );
}

function StatusNotice({ isError = false, text }: { isError?: boolean; text: string }) {
  return (
    <View style={[styles.notice, isError && styles.errorNotice]}>
      <SymbolView
        name={{ ios: isError ? 'exclamationmark.triangle.fill' : 'wifi.exclamationmark', android: isError ? 'warning' : 'wifi_off', web: isError ? 'warning' : 'wifi_off' }}
        size={16}
        style={styles.noticeIcon}
        tintColor={isError ? '#EE8C94' : '#C9A95E'}
      />
      <Text style={[styles.noticeText, isError && styles.errorNoticeText]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    alignSelf: 'center',
    maxWidth: 720,
    width: '100%',
  },
  discoveryHeader: {
    borderBottomColor: 'rgba(226,180,86,0.34)',
    borderBottomWidth: 1,
    marginBottom: 12,
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingTop: 2,
  },
  headerRail: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 66,
  },
  brandBlock: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: spacing.sm,
  },
  brandMark: {
    alignItems: 'center',
    backgroundColor: 'rgba(216,168,78,0.1)',
    borderColor: 'rgba(234,194,107,0.46)',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  brandIcon: {
    height: 21,
    width: 21,
  },
  eyebrow: {
    color: '#A99A8D',
    fontSize: 9,
    fontWeight: typography.weights.semibold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  title: {
    color: '#F8F0E5',
    fontSize: 21,
    fontWeight: typography.weights.black,
    lineHeight: 25,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 4,
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  iconButtonActive: {
    backgroundColor: 'rgba(122,16,24,0.34)',
    borderColor: '#B83A43',
  },
  headerIcon: {
    height: 30,
    resizeMode: 'contain',
    width: 30,
  },
  headerIconIdle: {
    opacity: 0.88,
  },
  searchBar: {
    alignItems: 'center',
    backgroundColor: '#0D0909',
    borderColor: 'rgba(216,168,78,0.3)',
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    marginTop: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  searchGlyph: {
    height: 26,
    resizeMode: 'contain',
    width: 26,
  },
  searchInput: {
    color: '#F8F0E5',
    flex: 1,
    fontSize: typography.sizes.body,
    minHeight: 46,
    paddingVertical: 0,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  clearSearch: {
    color: '#A99E95',
    fontSize: 25,
    lineHeight: 28,
  },
  modeRail: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row-reverse',
    gap: 0,
    justifyContent: 'flex-start',
  },
  modeButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    minWidth: 50,
    paddingHorizontal: 5,
    position: 'relative',
  },
  modeButtonSelected: {
    backgroundColor: 'transparent',
  },
  modeLabel: {
    color: '#AFA5A0',
    fontSize: 11,
    fontWeight: typography.weights.bold,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  modeLabelSelected: {
    color: '#FFF4DF',
  },
  modeIndicator: {
    backgroundColor: '#F0C96E',
    borderRadius: radius.full,
    bottom: 1,
    height: 3,
    position: 'absolute',
    width: 26,
  },
  roomAction: {
    alignItems: 'center',
    backgroundColor: '#7C111B',
    borderColor: '#DDB65D',
    borderRadius: radius.full,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: 3,
    justifyContent: 'center',
    minHeight: 36,
    minWidth: 82,
    paddingHorizontal: 6,
  },
  roomActionIcon: {
    height: 23,
    resizeMode: 'contain',
    width: 23,
  },
  roomActionLabel: {
    color: '#F7D67C',
    fontSize: 9,
    fontWeight: typography.weights.black,
    writingDirection: 'rtl',
  },
  bannerShell: {
    borderColor: 'rgba(232,190,97,0.66)',
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
    marginHorizontal: 12,
    overflow: 'hidden',
    shadowColor: '#A91827',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.32,
    shadowRadius: 16,
  },
  banner: {
    height: 82,
    justifyContent: 'center',
    overflow: 'hidden',
    paddingHorizontal: 14,
  },
  bannerCopy: {
    alignItems: 'flex-end',
    alignSelf: 'flex-end',
    maxWidth: '58%',
  },
  bannerLivePill: {
    alignItems: 'center',
    backgroundColor: 'rgba(111,9,18,0.78)',
    borderColor: 'rgba(241,98,106,0.48)',
    borderRadius: radius.full,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: 5,
    marginBottom: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  bannerLiveDot: {
    backgroundColor: '#FF5260',
    borderRadius: radius.full,
    height: 6,
    width: 6,
  },
  bannerKicker: {
    color: '#D8A84E',
    fontSize: 9,
    fontWeight: typography.weights.black,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  bannerTitle: {
    color: '#FFF0C9',
    fontSize: 18,
    fontWeight: typography.weights.black,
    lineHeight: 23,
    textAlign: 'right',
    textShadowColor: '#000000',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 5,
    writingDirection: 'rtl',
  },
  bannerBody: {
    color: '#D8CBBB',
    fontSize: 10,
    marginTop: 1,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  bannerCta: {
    alignItems: 'center',
    backgroundColor: '#E7BE65',
    borderRadius: radius.full,
    flexDirection: 'row-reverse',
    gap: 5,
    marginTop: spacing.sm,
    minHeight: 30,
    paddingHorizontal: 11,
  },
  bannerCtaText: {
    color: '#2B090B',
    fontSize: 9,
    fontWeight: typography.weights.black,
    writingDirection: 'rtl',
  },
  bannerCtaIcon: {
    height: 16,
    width: 16,
  },
  featureRow: {
    flexDirection: 'row-reverse',
    gap: 6,
    marginBottom: 12,
    marginHorizontal: 12,
  },
  featureCard: {
    backgroundColor: '#0B0808',
    borderColor: 'rgba(216,168,78,0.28)',
    borderRadius: 13,
    borderWidth: 1,
    flex: 1,
    overflow: 'hidden',
  },
  featureCardSelected: {
    borderColor: '#E1B75E',
    borderWidth: 2,
    shadowColor: '#A91827',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  featureArt: {
    aspectRatio: 1.18,
    justifyContent: 'flex-end',
    padding: spacing.sm,
  },
  coverImage: {
    height: '100%',
    width: '100%',
  },
  featureLabel: {
    color: '#F7E5C1',
    fontSize: 11,
    fontWeight: typography.weights.black,
    minHeight: 28,
    textAlign: 'center',
    textShadowColor: '#000000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
    writingDirection: 'rtl',
  },
  countrySection: {
    alignItems: 'center',
    backgroundColor: '#0D0B0B',
    borderBottomColor: 'rgba(216,168,78,0.17)',
    borderBottomWidth: 1,
    borderTopColor: 'rgba(216,168,78,0.17)',
    borderTopWidth: 1,
    flexDirection: 'row',
    marginBottom: 8,
    minHeight: 58,
    paddingHorizontal: 10,
  },
  countrySectionHeading: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: spacing.sm,
  },
  countrySectionTitle: {
    color: '#BEB0A3',
    fontSize: 10,
    fontWeight: typography.weights.bold,
    writingDirection: 'rtl',
  },
  countrySectionLine: {
    backgroundColor: 'rgba(216,168,78,0.16)',
    flex: 1,
    height: 1,
  },
  countryRail: {
    flexDirection: 'row-reverse',
    flexGrow: 1,
    gap: 7,
    justifyContent: 'flex-end',
    paddingVertical: 7,
  },
  countryScroller: {
    direction: 'ltr',
  },
  countryButton: {
    alignItems: 'center',
    backgroundColor: '#292526',
    borderColor: 'rgba(255,255,255,0.04)',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 48,
  },
  countryButtonSelected: {
    backgroundColor: '#81151E',
    borderColor: '#D8A84E',
  },
  countryFlag: {
    borderRadius: 3,
    height: 22,
    width: 34,
  },
  globeIcon: {
    height: 30,
    resizeMode: 'contain',
    width: 30,
  },
  iconMuted: {
    opacity: 0.52,
  },
  notice: {
    alignItems: 'center',
    backgroundColor: 'rgba(216,168,78,0.08)',
    borderColor: 'rgba(216,168,78,0.25)',
    borderRadius: radius.full,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: 7,
    marginBottom: 8,
    marginHorizontal: 10,
    minHeight: 36,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  errorNotice: {
    backgroundColor: 'rgba(166,26,39,0.12)',
    borderColor: 'rgba(205,59,70,0.38)',
  },
  noticeText: {
    color: '#CDBDA8',
    flex: 1,
    fontSize: 10,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  errorNoticeText: {
    color: '#F1A5AB',
  },
  noticeIcon: {
    height: 17,
    width: 17,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sectionTitle: {
    color: '#F8F0E5',
    fontSize: 18,
    fontWeight: typography.weights.black,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  sectionCount: {
    backgroundColor: 'rgba(216,168,78,0.11)',
    borderColor: 'rgba(216,168,78,0.25)',
    borderRadius: radius.full,
    borderWidth: 1,
    color: '#D8A84E',
    fontSize: 11,
    fontWeight: typography.weights.black,
    minWidth: 30,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    textAlign: 'center',
  },
  roomGrid: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    columnGap: 4,
    marginBottom: spacing.xl,
    paddingHorizontal: 4,
    rowGap: 10,
  },
  roomCard: {
    width: '49.3%',
  },
  roomCardPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.985 }],
  },
  roomArtShell: {
    aspectRatio: 0.96,
    backgroundColor: '#120A0B',
    borderColor: 'rgba(216,168,78,0.46)',
    borderRadius: 11,
    borderWidth: 1,
    overflow: 'hidden',
  },
  roomArt: {
    flex: 1,
    justifyContent: 'space-between',
    padding: 9,
  },
  roomTopMeta: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
  },
  liveBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(55,6,10,0.84)',
    borderColor: 'rgba(231,79,89,0.56)',
    borderRadius: radius.full,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  liveDot: {
    backgroundColor: '#F04F5C',
    borderRadius: radius.full,
    height: 6,
    width: 6,
  },
  liveLabel: {
    color: '#FFD4D7',
    fontSize: 9,
    fontWeight: typography.weights.black,
    writingDirection: 'rtl',
  },
  peopleBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(3,3,3,0.68)',
    borderRadius: radius.full,
    flexDirection: 'row-reverse',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  peopleCount: {
    color: '#F3CC70',
    fontSize: 9,
    fontWeight: typography.weights.black,
  },
  peopleIcon: {
    height: 16,
    width: 16,
  },
  roomArtFooter: {
    gap: 4,
  },
  hostRow: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.48)',
    borderRadius: radius.md,
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    padding: 5,
  },
  avatarStack: {
    flexDirection: 'row-reverse',
  },
  miniAvatar: {
    alignItems: 'center',
    backgroundColor: '#6D121A',
    borderColor: '#D8A84E',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 27,
    justifyContent: 'center',
    width: 27,
  },
  miniAvatarOverlap: {
    marginRight: -8,
  },
  miniAvatarText: {
    color: '#F9E7C2',
    fontSize: 10,
    fontWeight: typography.weights.black,
  },
  hostCopy: {
    flex: 1,
  },
  hostName: {
    color: '#F3E7D7',
    fontSize: 9,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    textShadowColor: '#000000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
    writingDirection: 'rtl',
  },
  hostRole: {
    color: '#B3A59A',
    fontSize: 8,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  pendingOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(3,3,3,0.83)',
    bottom: 0,
    gap: spacing.sm,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  pendingText: {
    color: '#F3CC70',
    fontSize: 11,
    fontWeight: typography.weights.bold,
    writingDirection: 'rtl',
  },
  roomFlagShell: {
    alignItems: 'center',
    height: 20,
    justifyContent: 'center',
    width: 27,
  },
  roomFlagImage: {
    borderRadius: 2,
    height: 15,
    width: 24,
  },
  roomFlagGlobe: {
    height: 20,
    resizeMode: 'contain',
    width: 20,
  },
  roomCaption: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: 5,
    minHeight: 30,
    paddingHorizontal: 4,
    paddingTop: 6,
  },
  roomTitle: {
    color: '#FFF1D5',
    flex: 1,
    fontSize: 12,
    fontWeight: typography.weights.bold,
    lineHeight: 17,
    textAlign: 'right',
    textShadowColor: '#000000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
    writingDirection: 'rtl',
  },
  skeleton: {
    backgroundColor: '#170E0F',
  },
  skeletonLine: {
    backgroundColor: '#1D1414',
    borderRadius: radius.full,
    height: 10,
    marginTop: spacing.sm,
    width: '86%',
  },
  skeletonLineShort: {
    backgroundColor: '#160F0F',
    borderRadius: radius.full,
    height: 8,
    marginTop: spacing.xs,
    width: '58%',
  },
  emptyState: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.025)',
    borderColor: 'rgba(216,168,78,0.2)',
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.xl,
    padding: spacing.xl,
  },
  emptyIconShell: {
    alignItems: 'center',
    backgroundColor: 'rgba(122,16,24,0.24)',
    borderColor: 'rgba(216,168,78,0.3)',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 54,
    justifyContent: 'center',
    width: 54,
  },
  emptyIcon: {
    height: 36,
    resizeMode: 'contain',
    width: 36,
  },
  emptyTitle: {
    color: '#F5EBDD',
    fontSize: 17,
    fontWeight: typography.weights.black,
    marginTop: spacing.md,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  emptyBody: {
    color: '#9D9289',
    fontSize: 12,
    lineHeight: 20,
    marginTop: spacing.xs,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  emptyActions: {
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#7A1018',
    borderColor: '#D8A84E',
    borderRadius: radius.full,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.lg,
  },
  primaryButtonLabel: {
    color: '#F8E2AF',
    fontSize: 12,
    fontWeight: typography.weights.black,
    writingDirection: 'rtl',
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: 'rgba(216,168,78,0.28)',
    borderRadius: radius.full,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.lg,
  },
  secondaryButtonLabel: {
    color: '#BEB1A5',
    fontSize: 12,
    fontWeight: typography.weights.bold,
    writingDirection: 'rtl',
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.985 }],
  },
  disabled: {
    opacity: 0.58,
  },
  filterIcon: {
    height: 30,
    marginRight: 6,
    resizeMode: 'contain',
    width: 30,
  },
});
