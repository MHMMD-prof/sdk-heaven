import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ReactNode, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { CreateRoomModal } from '../components/CreateRoomModal';
import { GlassCard } from '../components/GlassCard';
import { LuxuryInput } from '../components/LuxuryInput';
import { ScreenContainer } from '../components/ScreenContainer';
import { SectionHeader } from '../components/SectionHeader';
import { colors, radius, spacing, typography } from '../theme';
import { RootStackParamList } from '../types/navigation';
import { RoomCountryCode, VoiceRoom, VoiceRoomType } from '../types/voice';
import { debugError, debugLog } from '../utils/debugLog';
import { normalizeInviteCode } from '../voice/roomProfile';
import { useVoiceRooms } from '../voice/useVoiceRooms';

type GroupsScreenProps = {
  bottomNavigation: ReactNode;
  navigation: NativeStackNavigationProp<RootStackParamList, 'Main'>;
};

export function GroupsScreen({ bottomNavigation, navigation }: GroupsScreenProps) {
  const [errorMessage, setErrorMessage] = useState('');
  const [createInviteCode, setCreateInviteCode] = useState('');
  const [isCreateModalVisible, setCreateModalVisible] = useState(false);
  const [isJoinPrivateModalVisible, setJoinPrivateModalVisible] = useState(false);
  const [isPrivateRoom, setPrivateRoom] = useState(false);
  const [joinInviteCode, setJoinInviteCode] = useState('');
  const [pendingRoomId, setPendingRoomId] = useState<string | null>(null);
  const [privateRoomId, setPrivateRoomId] = useState('');
  const [selectedCountryCode, setSelectedCountryCode] = useState<RoomCountryCode>('IQ');
  const [selectedRoomType, setSelectedRoomType] = useState<VoiceRoomType>('voice');
  const { createPrivateRoom, createRoom, joinPrivateRoom, joinRoom, rooms, roomsStatus } = useVoiceRooms();

  const handleCreateRoom = async () => {
    setErrorMessage('');
    setPendingRoomId('create');

    try {
      const normalizedInviteCode = normalizeInviteCode(createInviteCode);
      debugLog('voice.groups', 'createRoom:start', {
        isPrivateRoom,
        selectedRoomType,
        hasInviteCode: Boolean(normalizedInviteCode),
      });
      const room = isPrivateRoom
        ? await createPrivateRoom({
            type: selectedRoomType,
            countryCode: selectedCountryCode,
            inviteCode: normalizedInviteCode,
          })
        : await createRoom({ type: selectedRoomType, countryCode: selectedCountryCode });
      debugLog('voice.groups', 'createRoom:success', {
        roomId: room.id,
        visibility: room.visibility,
        type: room.type,
        participantCount: room.participantCount,
      });
      setCreateModalVisible(false);
      setCreateInviteCode('');
      setPrivateRoom(false);
      navigation.navigate('VoiceRoom', { roomId: room.id });
    } catch (error) {
      debugError('voice.groups', 'createRoom:error', error, {
        isPrivateRoom,
        selectedRoomType,
      });
      setErrorMessage(error instanceof Error ? error.message : 'Unable to create room.');
    } finally {
      setPendingRoomId(null);
    }
  };

  const handleJoinPrivateRoom = async () => {
    setErrorMessage('');
    setPendingRoomId('join-private');

    try {
      debugLog('voice.groups', 'joinPrivateRoom:start', {
        hasInviteCode: Boolean(normalizeInviteCode(joinInviteCode)),
        roomId: privateRoomId.trim(),
      });
      const room = await joinPrivateRoom({
        inviteCode: joinInviteCode,
        roomId: privateRoomId.trim(),
      });
      debugLog('voice.groups', 'joinPrivateRoom:success', {
        roomId: room.id,
        localRole: room.localMember?.role,
        localCanPublishAudio: room.localMember?.canPublishAudio,
      });
      setJoinPrivateModalVisible(false);
      setJoinInviteCode('');
      setPrivateRoomId('');
      navigation.navigate('VoiceRoom', { roomId: room.id });
    } catch (error) {
      debugError('voice.groups', 'joinPrivateRoom:error', error, {
        roomId: privateRoomId.trim(),
      });
      setErrorMessage(error instanceof Error ? error.message : 'Unable to join private room.');
    } finally {
      setPendingRoomId(null);
    }
  };

  const handleJoinRoom = async (roomId: string) => {
    setErrorMessage('');
    setPendingRoomId(roomId);

    try {
      debugLog('voice.groups', 'joinRoom:start', { roomId });
      const room = await joinRoom(roomId);
      debugLog('voice.groups', 'joinRoom:success', {
        roomId: room.id,
        visibility: room.visibility,
        localRole: room.localMember?.role,
        localCanPublishAudio: room.localMember?.canPublishAudio,
      });
      navigation.navigate('VoiceRoom', { roomId: room.id });
    } catch (error) {
      debugError('voice.groups', 'joinRoom:error', error, { roomId });
      setErrorMessage(error instanceof Error ? error.message : 'Unable to join room.');
    } finally {
      setPendingRoomId(null);
    }
  };

  return (
    <ScreenContainer bottomInset fixedBottom={bottomNavigation}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>المجموعات الصوتية</Text>
        <Text style={styles.title}>المجموعات</Text>
        <Text style={styles.subtitle}>
          مجالس عربية فاخرة للمحادثة واللعب الهادئ. الاتصال الصوتي يعمل عبر LiveKit في مسار
          التطوير الحالي.
        </Text>
      </View>

      {roomsStatus === 'error' ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>Room sync failed. Showing local rooms.</Text>
        </View>
      ) : null}
      {errorMessage ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      ) : null}

      <Pressable
        onPress={() => {
          setErrorMessage('');
          setCreateModalVisible(true);
        }}
        style={({ pressed }) => [styles.createRoom, pressed && styles.pressed]}
      >
        <Text style={styles.createIcon}>＋</Text>
        <View style={styles.createCopy}>
          <Text style={styles.createTitle}>إنشاء مجموعة جديدة</Text>
          <Text style={styles.createSubtitle}>إنشاء محلي للتجربة، بدون Backend أو تخزين دائم.</Text>
        </View>
      </Pressable>

      <Pressable
        onPress={() => setJoinPrivateModalVisible(true)}
        style={({ pressed }) => [styles.joinPrivateRoom, pressed && styles.pressed]}
      >
        <Text style={styles.joinPrivateText}>انضمام برمز دعوة</Text>
      </Pressable>

      <SectionHeader actionLabel="مباشر الآن" title="المجموعات المتاحة" />
      <View style={styles.roomList}>
        {rooms.map((room) => (
          <GroupCard
            isPending={pendingRoomId === room.id}
            key={room.id}
            onPress={() => handleJoinRoom(room.id)}
            room={room}
          />
        ))}
      </View>

      <CreateRoomModal
        errorMessage={errorMessage}
        inviteCode={createInviteCode}
        isCreating={pendingRoomId === 'create'}
        isPrivateRoom={isPrivateRoom}
        isVisible={isCreateModalVisible}
        onClose={() => {
          setErrorMessage('');
          setCreateModalVisible(false);
        }}
        onCreate={handleCreateRoom}
        onInviteCodeChange={setCreateInviteCode}
        onSelectCountryCode={setSelectedCountryCode}
        onSelectType={setSelectedRoomType}
        onTogglePrivateRoom={() => setPrivateRoom((current) => !current)}
        selectedCountryCode={selectedCountryCode}
        selectedType={selectedRoomType}
      />
      <JoinPrivateRoomModal
        inviteCode={joinInviteCode}
        isJoining={pendingRoomId === 'join-private'}
        isVisible={isJoinPrivateModalVisible}
        onClose={() => setJoinPrivateModalVisible(false)}
        onInviteCodeChange={setJoinInviteCode}
        onJoin={handleJoinPrivateRoom}
        onRoomIdChange={setPrivateRoomId}
        roomId={privateRoomId}
      />
    </ScreenContainer>
  );
}

type JoinPrivateRoomModalProps = {
  inviteCode: string;
  isJoining: boolean;
  isVisible: boolean;
  roomId: string;
  onClose: () => void;
  onInviteCodeChange: (inviteCode: string) => void;
  onJoin: () => void;
  onRoomIdChange: (roomId: string) => void;
};

function JoinPrivateRoomModal({
  inviteCode,
  isJoining,
  isVisible,
  onClose,
  onInviteCodeChange,
  onJoin,
  onRoomIdChange,
  roomId,
}: JoinPrivateRoomModalProps) {
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={isVisible}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Pressable onPress={onClose} style={styles.modalCloseButton}>
              <Text style={styles.modalCloseText}>×</Text>
            </Pressable>
            <View style={styles.modalCopy}>
              <Text style={styles.modalEyebrow}>دعوة خاصة</Text>
              <Text style={styles.modalTitle}>انضم إلى مجموعة مخفية</Text>
              <Text style={styles.modalSubtitle}>أدخل رقم المجموعة ورمز الدعوة الذي أرسله المضيف.</Text>
            </View>
          </View>

          <LuxuryInput
            autoCapitalize="none"
            label="رقم المجموعة"
            onChangeText={onRoomIdChange}
            placeholder="room-id"
            value={roomId}
          />
          <LuxuryInput
            autoCapitalize="characters"
            label="رمز الدعوة"
            onChangeText={onInviteCodeChange}
            placeholder="مثال: MAJLIS7"
            value={inviteCode}
          />

          <Pressable
            disabled={isJoining || !roomId.trim() || !normalizeInviteCode(inviteCode)}
            onPress={onJoin}
            style={[
              styles.modalCreateButton,
              (isJoining || !roomId.trim() || !normalizeInviteCode(inviteCode)) && styles.disabledButton,
            ]}
          >
            <Text style={styles.modalCreateText}>انضمام</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

type GroupCardProps = {
  room: VoiceRoom;
  isPending: boolean;
  onPress: () => void;
};

function GroupCard({ isPending, room, onPress }: GroupCardProps) {
  const host = room.speakers.find((speaker) => speaker.id === room.hostId) ?? room.speakers[0];

  return (
    <Pressable
      disabled={isPending}
      onPress={onPress}
      style={({ pressed }) => [pressed && styles.pressed, isPending && styles.disabledCard]}
    >
      <GlassCard style={styles.roomCard}>
        <View style={styles.roomTop}>
          <View style={styles.roomMeta}>
            <Text style={styles.roomType}>{room.type === 'game' ? 'مجموعة لعبة' : 'مجموعة صوت'}</Text>
            <Text style={styles.roomCount}>{room.participantCount} حاضر</Text>
          </View>
          <Text style={styles.roomTitle}>{room.title}</Text>
        </View>

        <View style={styles.hostRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{host?.avatarLabel ?? 'م'}</Text>
          </View>
          <View style={styles.hostCopy}>
            <Text style={styles.hostLabel}>المضيف</Text>
            <Text style={styles.hostName}>{host?.displayName ?? 'المجموعة'}</Text>
          </View>
        </View>

        <View style={styles.footerRow}>
          <View style={styles.stackPreview}>
            {room.speakers.slice(0, 3).map((speaker) => (
              <View key={speaker.id} style={styles.miniAvatar}>
                <Text style={styles.miniAvatarText}>{speaker.avatarLabel}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.joinLabel}>انضمام</Text>
        </View>
      </GlassCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    marginBottom: spacing.xl,
  },
  eyebrow: {
    color: colors.gold,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  title: {
    color: colors.text,
    fontSize: typography.sizes.headline,
    fontWeight: typography.weights.black,
    marginTop: spacing.xs,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: typography.sizes.body,
    lineHeight: 23,
    marginTop: spacing.sm,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  createRoom: {
    alignItems: 'center',
    backgroundColor: 'rgba(232, 190, 97, 0.10)',
    borderColor: colors.borderGold,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.xl,
    padding: spacing.lg,
  },
  joinPrivateRoom: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    justifyContent: 'center',
    marginBottom: spacing.xl,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
  },
  joinPrivateText: {
    color: colors.goldSoft,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  createIcon: {
    backgroundColor: colors.gold,
    borderRadius: radius.full,
    color: colors.backgroundDeep,
    fontSize: 24,
    fontWeight: typography.weights.bold,
    height: 42,
    lineHeight: 40,
    textAlign: 'center',
    width: 42,
  },
  createCopy: {
    flex: 1,
  },
  disabledButton: {
    opacity: 0.62,
  },
  disabledCard: {
    opacity: 0.62,
  },
  errorBanner: {
    backgroundColor: 'rgba(235,87,87,0.12)',
    borderColor: 'rgba(235,87,87,0.35)',
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  errorText: {
    color: colors.ruby,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  createTitle: {
    color: colors.goldSoft,
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  createSubtitle: {
    color: colors.textMuted,
    fontSize: typography.sizes.caption,
    marginTop: spacing.xs,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  roomList: {
    gap: spacing.md,
    marginBottom: spacing.xxl,
  },
  roomCard: {
    gap: spacing.md,
    padding: spacing.md,
  },
  pressed: {
    opacity: 0.86,
    transform: [{ scale: 0.99 }],
  },
  roomTop: {
    gap: spacing.sm,
  },
  roomMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  roomType: {
    color: colors.emerald,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    writingDirection: 'rtl',
  },
  roomCount: {
    color: colors.goldSoft,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    writingDirection: 'rtl',
  },
  roomTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: typography.weights.black,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  hostRow: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: spacing.md,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.borderGold,
    borderRadius: radius.full,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  avatarText: {
    color: colors.goldSoft,
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.black,
  },
  hostCopy: {
    flex: 1,
  },
  hostLabel: {
    color: colors.textSubtle,
    fontSize: typography.sizes.caption,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  hostName: {
    color: colors.text,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    marginTop: 2,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  footerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  stackPreview: {
    flexDirection: 'row-reverse',
  },
  miniAvatar: {
    alignItems: 'center',
    backgroundColor: colors.purple,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 30,
    justifyContent: 'center',
    marginLeft: -spacing.xs,
    width: 30,
  },
  miniAvatarText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: typography.weights.bold,
  },
  joinLabel: {
    color: colors.gold,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    writingDirection: 'rtl',
  },
  modalOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(3, 2, 7, 0.78)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: '#120B1E',
    borderColor: colors.borderGold,
    borderRadius: radius.xl,
    borderWidth: 1,
    gap: spacing.lg,
    padding: spacing.lg,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.45,
    shadowRadius: 28,
    width: '100%',
  },
  modalHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  modalCloseButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  modalCloseText: {
    color: colors.goldSoft,
    fontSize: 28,
    lineHeight: 32,
  },
  modalCopy: {
    flex: 1,
  },
  modalEyebrow: {
    color: colors.gold,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  modalTitle: {
    color: colors.text,
    fontSize: typography.sizes.title,
    fontWeight: typography.weights.black,
    marginTop: spacing.xs,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  modalSubtitle: {
    color: colors.textMuted,
    fontSize: typography.sizes.caption,
    lineHeight: 19,
    marginTop: spacing.sm,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  modalCreateButton: {
    alignItems: 'center',
    backgroundColor: colors.gold,
    borderRadius: radius.full,
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: spacing.lg,
  },
  modalCreateText: {
    color: colors.backgroundDeep,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.black,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
});
