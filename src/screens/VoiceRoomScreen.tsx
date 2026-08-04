import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '../components/ScreenContainer';
import { useRepresentativeBadgeProjection } from '../social/useRepresentativeBadgeProjection';
import { useAvatarFrameProjection } from '../social/useAvatarFrameProjection';
import { useEquipmentCosmetics } from '../social/useEquipmentCosmetics';
import { useSocialFeatureFlags } from '../social/useSocialFeatureFlags';
import {
  RoomMicrophonesSheet,
  RoomOwnershipOfferSheet,
  RoomOwnershipSheet,
  RoomPeopleManagementSheet,
  RoomSafetySheet,
  RoomSeatOffersSheet,
  RoomSettingsSheet,
} from '../components/voice-room/RoomCommandCenterPanels';
import { VoiceRoomBottomBar } from '../components/voice-room/VoiceRoomBottomBar';
import { VoiceRoomHeader } from '../components/voice-room/VoiceRoomHeader';
import {
  RoomCommandCenterSheet,
  RoomParticipantsSheet,
} from '../components/voice-room/VoiceRoomSheets';
import { RoomChatSheet } from '../components/voice-room/RoomChatSheet';
import { RoomGameInviteCard } from '../components/voice-room/RoomGameInviteCard';
import { RoomGiftSheet } from '../components/voice-room/RoomGiftSheet';
import { RoomEffectOverlay } from '../components/voice-room/RoomEffectOverlay';
import { useCosmeticsFeatureFlags } from '../cosmetics/featureFlags';
import { RoomMusicSheet } from '../components/voice-room/RoomMusicSheet';
import { RoomRocketButton, RoomRocketSheet } from '../components/voice-room/RoomRocketSheet';
import { RoomTargetButton, RoomTargetSheet } from '../components/voice-room/RoomTargetSheet';
import { VoiceRoomStage } from '../components/voice-room/VoiceRoomStage';
import { colors, radius, spacing, typography } from '../theme';
import { RootStackParamList } from '../types/navigation';
import { VoiceRoom } from '../types/voice';
import { debugError, debugLog, isDebugLogEnabled, useDebugEvents } from '../utils/debugLog';
import {
  RoomSeatViewModel,
  buildRoomSeatViewModels,
  resolveRoomNotice,
  seatModeLabel,
} from '../voice/roomMainScreenModel';
import { VoiceParticipant } from '../voice/types';
import { useRoomCommandCenterData } from '../voice/roomCommandCenterData';
import { RoomCommandAction } from '../voice/requestRoomCommand';
import { RoomReportCategory } from '../voice/requestRoomChatCommand';
import { RoomChatMessage, useRoomChat } from '../voice/roomChat';
import { useRoomImageUrl, useRoomMediaControls } from '../voice/roomMedia';
import { activeVoiceProviderConfig } from '../voice/activeVoiceProviderConfig';
import {
  RoomEntryEffectRequestError,
  createRoomEntryEffectRequestId,
  requestRoomEntryEffectCommand,
} from '../voice/requestRoomEntryEffectCommand';
import {
  RoomGameId,
  RoomGameRequestError,
  RoomGameSession,
  requestRoomGameCommand,
  roomGameErrorMessage,
} from '../voice/requestRoomGameCommand';
import { useRoomEffectsQueue } from '../voice/useRoomEffectsQueue';
import { useRoomGameSession } from '../voice/useRoomGameSession';
import { useRoomMusicSession } from '../voice/useRoomMusicSession';
import { useRoomRocketData } from '../voice/useRoomRocketData';
import { useRoomTargetData } from '../voice/useRoomTargetData';
import { useRoomRecordingSafety } from '../voice/useRoomRecordingSafety';
import { useVoiceRoomController } from '../voice/useVoiceRoomController';
import { useVoiceRooms } from '../voice/useVoiceRooms';
import { useVoiceRoomFeatureFlags } from '../voice/voiceRoomFeatureFlags';
import { useRoomOwnershipTransfer } from '../voice/useRoomOwnershipTransfer';
import { useResolvedRoomTheme } from '../voice/roomThemeRuntime';

type VoiceRoomScreenProps = NativeStackScreenProps<RootStackParamList, 'VoiceRoom'>;

const REACTIONS = ['👏', '❤️', '🔥', '✨'];

export function VoiceRoomScreen({ navigation, route }: VoiceRoomScreenProps) {
  const { getRoomById, roomsStatus } = useVoiceRooms();
  const sourceRoom = getRoomById(route.params.roomId);
  if (!sourceRoom) {
    return (
      <ScreenContainer>
        <View style={styles.unavailableRoom}>
          {roomsStatus === 'loading' ? <ActivityIndicator color={colors.gold} /> : null}
          <Text style={styles.unavailableRoomTitle}>
            {roomsStatus === 'loading' ? 'جارٍ تحميل الغرفة…' : 'الغرفة غير متاحة'}
          </Text>
          <Text style={styles.unavailableRoomText}>
            {roomsStatus === 'loading'
              ? 'يتم التحقق من حالة الغرفة.'
              : 'ربما أُغلقت الغرفة أو لم يعد مسموحاً لك بالدخول.'}
          </Text>
          {roomsStatus !== 'loading' ? (
            <Pressable onPress={() => navigation.goBack()} style={styles.unavailableRoomButton}>
              <Text style={styles.unavailableRoomButtonText}>رجوع</Text>
            </Pressable>
          ) : null}
        </View>
      </ScreenContainer>
    );
  }
  return <ResolvedVoiceRoomScreen navigation={navigation} route={route} sourceRoom={sourceRoom} />;
}

type ResolvedVoiceRoomScreenProps = VoiceRoomScreenProps & { sourceRoom: VoiceRoom };

function ResolvedVoiceRoomScreen({
  navigation,
  route,
  sourceRoom,
}: ResolvedVoiceRoomScreenProps) {
  const { getPresenceSessionId, startRoomPresence, stopRoomPresence } = useVoiceRooms();
  const voiceRoomFeatureFlags = useVoiceRoomFeatureFlags();
  const socialFeatureFlags = useSocialFeatureFlags();
  const cosmeticsFeatureFlags = useCosmeticsFeatureFlags();
  const roomMediaControls = useRoomMediaControls(sourceRoom);
  const roomImageUrl = useRoomImageUrl(sourceRoom.activeRoomImagePath);
  const resolvedTheme = useResolvedRoomTheme({
    enabled: voiceRoomFeatureFlags.themes,
    roomCustomizationSuspended: sourceRoom.roomCustomizationSuspended,
    themeId: sourceRoom.themeId,
  });
  const debugEvents = useDebugEvents();
  const shouldShowDebugPanel = isDebugLogEnabled();
  const [toolsVisible, setToolsVisible] = useState(false);
  const [participantsVisible, setParticipantsVisible] = useState(false);
  const [chatVisible, setChatVisible] = useState(false);
  const [giftVisible, setGiftVisible] = useState(false);
  const [musicVisible, setMusicVisible] = useState(false);
  const [rocketVisible, setRocketVisible] = useState(false);
  const [targetVisible, setTargetVisible] = useState(false);
  const [commandPanel, setCommandPanel] = useState<
    'microphones' | 'people' | 'safety' | 'seat-offers' | 'settings' | 'ownership'
  >();
  const roomRocket = useRoomRocketData({
    enabled: voiceRoomFeatureFlags.supporterRankings,
    roomId: sourceRoom.id,
  });
  const roomEffects = useRoomEffectsQueue({
    entryEffectsEnabled: voiceRoomFeatureFlags.entryEffects,
    giftGlobalEffectsEnabled: cosmeticsFeatureFlags.roomGiftGlobalEffects,
    giftsEnabled: voiceRoomFeatureFlags.gifts,
    rocketEnabled: voiceRoomFeatureFlags.supporterRankings && roomRocket.renderingEnabled,
    roomEffectsPolicy: sourceRoom.effectsPolicy,
    roomId: sourceRoom.id,
    suspended: sourceRoom.audioLockdown === true
      || sourceRoom.roomCustomizationSuspended === true
      || sourceRoom.status === 'closed',
    uid: sourceRoom.localMember?.id,
    viewerCountryCode: sourceRoom.countryCode,
    viewerRoomVisibility: sourceRoom.visibility,
  });
  const [pendingSeatId, setPendingSeatId] = useState<string>();
  const [reactionIndex, setReactionIndex] = useState(-1);
  const [gameCommandPending, setGameCommandPending] = useState(false);
  const {
    canPublishAudio,
    connectionState,
    errorMessage,
    isConnected,
    isMicMuted,
    isSpeakerEnabled,
    leaveRoom,
    hostControls,
    listeners: sourceListeners,
    moderationActions,
    moderationErrorMessage,
    muteMic,
    reconnectToRoom,
    seatControls,
    setSpeakerEnabled,
    speakers: sourceSpeakers,
    speakingParticipantIds,
    statusLabel,
    unmuteMic,
  } = useVoiceRoomController(sourceRoom);

  const badgeUids = useMemo(() => [
    ...(sourceRoom.localMember ? [sourceRoom.localMember.id] : []),
    ...sourceRoom.speakers.map((member) => member.id),
    ...sourceRoom.listeners.map((member) => member.id),
    ...sourceSpeakers.map((participant) => participant.id),
    ...sourceListeners.map((participant) => participant.id),
  ], [sourceListeners, sourceRoom.listeners, sourceRoom.speakers, sourceSpeakers]);
  const activeBadges = useRepresentativeBadgeProjection(badgeUids);
  const avatarFrames = useAvatarFrameProjection(badgeUids);
  const equipmentCosmetics = useEquipmentCosmetics(badgeUids);
  const speakers = useMemo(
    () => sourceSpeakers.map((participant) => ({
      ...participant,
      avatarFrameAssetUrl: avatarFrames[participant.id]?.assetUrl,
      avatarFrameAssetId: avatarFrames[participant.id]?.canonicalAsset?.assetId,
      avatarFrameAssetVersionId: avatarFrames[participant.id]?.canonicalAsset?.assetVersionId,
      avatarFrameItemId: avatarFrames[participant.id]?.itemId,
      representativeBadgeActive: activeBadges[participant.id] === true,
      equipmentCosmetics: equipmentCosmetics[participant.id],
    })),
    [activeBadges, avatarFrames, equipmentCosmetics, sourceSpeakers],
  );
  const listeners = useMemo(
    () => sourceListeners.map((participant) => ({
      ...participant,
      avatarFrameAssetUrl: avatarFrames[participant.id]?.assetUrl,
      avatarFrameAssetId: avatarFrames[participant.id]?.canonicalAsset?.assetId,
      avatarFrameAssetVersionId: avatarFrames[participant.id]?.canonicalAsset?.assetVersionId,
      avatarFrameItemId: avatarFrames[participant.id]?.itemId,
      representativeBadgeActive: activeBadges[participant.id] === true,
      equipmentCosmetics: equipmentCosmetics[participant.id],
    })),
    [activeBadges, avatarFrames, equipmentCosmetics, sourceListeners],
  );
  const room = useMemo(() => ({
    ...sourceRoom,
    listeners: sourceRoom.listeners.map((member) => ({
      ...member,
      avatarFrameAssetUrl: avatarFrames[member.id]?.assetUrl,
      avatarFrameAssetId: avatarFrames[member.id]?.canonicalAsset?.assetId,
      avatarFrameAssetVersionId: avatarFrames[member.id]?.canonicalAsset?.assetVersionId,
      avatarFrameItemId: avatarFrames[member.id]?.itemId,
      representativeBadgeActive: activeBadges[member.id] === true,
      equipmentCosmetics: equipmentCosmetics[member.id],
    })),
    localMember: sourceRoom.localMember ? {
      ...sourceRoom.localMember,
      avatarFrameAssetUrl: avatarFrames[sourceRoom.localMember.id]?.assetUrl,
      avatarFrameAssetId: avatarFrames[sourceRoom.localMember.id]?.canonicalAsset?.assetId,
      avatarFrameAssetVersionId: avatarFrames[sourceRoom.localMember.id]?.canonicalAsset?.assetVersionId,
      avatarFrameItemId: avatarFrames[sourceRoom.localMember.id]?.itemId,
      representativeBadgeActive: activeBadges[sourceRoom.localMember.id] === true,
      equipmentCosmetics: equipmentCosmetics[sourceRoom.localMember.id],
    } : undefined,
    speakers: sourceRoom.speakers.map((member) => ({
      ...member,
      avatarFrameAssetUrl: avatarFrames[member.id]?.assetUrl,
      avatarFrameAssetId: avatarFrames[member.id]?.canonicalAsset?.assetId,
      avatarFrameAssetVersionId: avatarFrames[member.id]?.canonicalAsset?.assetVersionId,
      avatarFrameItemId: avatarFrames[member.id]?.itemId,
      representativeBadgeActive: activeBadges[member.id] === true,
      equipmentCosmetics: equipmentCosmetics[member.id],
    })),
  }), [activeBadges, avatarFrames, equipmentCosmetics, sourceRoom]);
  const ownershipTransfer = useRoomOwnershipTransfer(
    room,
    voiceRoomFeatureFlags.ownershipTransfer,
  );

  const seats = useMemo(
    () => buildRoomSeatViewModels({ room, speakers, speakingParticipantIds }),
    [room, speakers, speakingParticipantIds],
  );
  const notice = resolveRoomNotice({
    audioLockdown: room.audioLockdown,
    connectionState,
    errorMessage,
    moderationErrorMessage,
    seatErrorMessage: seatControls.errorMessage,
  });
  const ownerUid = room.ownerUid || room.hostId;
  const ownerName = [...room.speakers, ...room.listeners].find((member) => member.id === ownerUid)?.displayName
    || speakers.find((participant) => participant.id === ownerUid)?.displayName
    || 'مالك الغرفة';
  const localIsSeated = !!room.localMember?.seatId;
  const canManageRoom = voiceRoomFeatureFlags.commandCenter
    && (room.localMember?.authorityRole === 'owner' || room.localMember?.authorityRole === 'moderator');
  const authorityRole = room.localMember?.authorityRole;
  const roomTarget = useRoomTargetData({
    enabled: voiceRoomFeatureFlags.ownerTargets,
    isOwner: authorityRole === 'owner',
    ownerUid,
    roomId: room.id,
  });
  const canControlMusic = Boolean(
    voiceRoomFeatureFlags.sharedMusic
    && (
      authorityRole === 'owner'
      || authorityRole === 'moderator'
      || room.localMember?.privileges?.canManageMusic === true
    ),
  );
  const roomMusic = useRoomMusicSession({
    canControlMusic,
    enabled: voiceRoomFeatureFlags.sharedMusic,
    roomId: room.id,
  });
  const roomRecording = useRoomRecordingSafety({
    enabled: voiceRoomFeatureFlags.safetyRecording,
    roomId: room.id,
  });
  const canModerateChat = authorityRole === 'owner' || authorityRole === 'moderator';
  const commandCenterAuthorityRole = voiceRoomFeatureFlags.commandCenter ? authorityRole : undefined;
  const commandCenterData = useRoomCommandCenterData(room.id, room.localMember?.id, canManageRoom);
  const { session: roomGameSession } = useRoomGameSession(room.id, voiceRoomFeatureFlags.games);
  const roomChat = useRoomChat({
    avatarLabel: room.localMember?.avatarLabel || '',
    avatarFrame: room.localMember?.id ? avatarFrames[room.localMember.id] : undefined,
    config: activeVoiceProviderConfig.liveKit,
    displayName: room.localMember?.displayName || '',
    enabled: voiceRoomFeatureFlags.chat,
    historyVisibility: room.historyVisibility ?? 'after-join',
    roomId: room.id,
    uid: room.localMember?.id,
  });
  const canSendChat = voiceRoomFeatureFlags.chat
    && room.localMember?.status !== 'removed'
    && (room.chatMode !== 'off' || canModerateChat);
  const roomMembers = useMemo(
    () => [...room.speakers, ...room.listeners].filter(
      (member, index, members) =>
        member.status !== 'removed' &&
        members.findIndex((candidate) => candidate.id === member.id) === index,
    ),
    [room.listeners, room.speakers],
  );
  const giftRecipients = useMemo(
    () => roomMembers
      .filter((member) => member.id !== room.localMember?.id)
      .map((member) => ({ displayName: member.displayName, uid: member.id })),
    [room.localMember?.id, roomMembers],
  );
  const roomSettings = useMemo(() => ({
    announcement: room.announcement ?? '',
    welcomeMessage: room.welcomeMessage ?? '',
    chatMode: room.chatMode ?? 'everyone',
    slowModeSeconds: room.slowModeSeconds ?? 0,
    historyVisibility: room.historyVisibility ?? 'after-join',
    keywordFilterMode: room.keywordFilterMode ?? 'standard',
    effectsPolicy: room.effectsPolicy ?? 'full',
  } as const), [
    room.announcement,
    room.chatMode,
    room.effectsPolicy,
    room.historyVisibility,
    room.keywordFilterMode,
    room.slowModeSeconds,
    room.themeId,
    room.welcomeMessage,
  ]);
  const nameForUid = useCallback(
    (uid: string) => roomMembers.find((member) => member.id === uid)?.displayName || `عضو ${uid.slice(0, 6)}`,
    [roomMembers],
  );
  const isCommandPending = useCallback((action: string, targetUid?: string, seatId?: string) => {
    const seatActions: RoomCommandAction[] = [
      'accept-seat-invite',
      'approve-seat-request',
      'cancel-seat-request',
      'decline-seat-invite',
      'invite-to-seat',
      'lock-seat',
      'reject-seat-request',
      'unlock-seat',
    ];
    if (seatActions.includes(action as RoomCommandAction)) {
      return seatControls.isPending(action as RoomCommandAction, seatId || '', targetUid || '');
    }
    return hostControls.isCommandPending(action, targetUid);
  }, [hostControls, seatControls]);

  const handleLeave = useCallback(async () => {
    debugLog('voice.screen', 'leave:start', { roomId: room.id });
    try {
      if (
        roomGameSession
        && room.localMember?.id
        && roomGameSession.playerUids.includes(room.localMember.id)
      ) {
        try {
          await requestRoomGameCommand({
            action: 'leave-room-game',
            roomId: room.id,
            sessionId: roomGameSession.sessionId,
          }, activeVoiceProviderConfig.liveKit);
        } catch (error) {
          debugError('voice.games', 'leave-with-room:error', error, {
            roomId: room.id,
            sessionId: roomGameSession.sessionId,
          });
        }
      }
      await roomMusic.stopIfLocalDj();
      await stopRoomPresence(room.id);
      await leaveRoom();
      debugLog('voice.screen', 'leave:success', { roomId: room.id });
    } catch (error) {
      debugError('voice.screen', 'leave:error', error, { roomId: room.id });
    } finally {
      navigation.goBack();
    }
  }, [
    leaveRoom,
    navigation,
    room.id,
    room.localMember?.id,
    roomGameSession,
    roomMusic,
    stopRoomPresence,
  ]);

  useEffect(() => {
    debugLog('voice.screen', 'presence:start', { roomId: room.id });
    startRoomPresence(room.id);
    return () => {
      debugLog('voice.screen', 'presence:stop', { roomId: room.id });
      void stopRoomPresence(room.id).catch((error) => {
        debugError('voice.screen', 'presence:stop:error', error, { roomId: room.id });
      });
    };
  }, [room.id, startRoomPresence, stopRoomPresence]);

  useEffect(() => {
    if (!voiceRoomFeatureFlags.entryEffects || !isConnected) return undefined;
    let cancelled = false;
    const requestId = createRoomEntryEffectRequestId();
    const announce = async () => {
      const sessionId = getPresenceSessionId(room.id);
      if (!sessionId || cancelled) return;
      const retryDelays = [1_200, 1_000, 2_000];
      for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
        await waitForEntryEffectRetry(retryDelays[attempt]);
        if (cancelled) return;
        try {
          await requestRoomEntryEffectCommand({
            requestId,
            roomId: room.id,
            sessionId,
          }, activeVoiceProviderConfig.liveKit);
          return;
        } catch (error) {
          const retryable = error instanceof RoomEntryEffectRequestError
            && ['NETWORK_ERROR', 'SESSION_MISMATCH', 'TIMEOUT'].includes(error.code);
          if (!retryable || attempt === retryDelays.length - 1) {
            debugError('voice.effects', 'announce:error', error, {
              attempt: attempt + 1,
              roomId: room.id,
              sessionId,
            });
            return;
          }
        }
      }
    };
    void announce();
    return () => {
      cancelled = true;
    };
  }, [getPresenceSessionId, isConnected, room.id, voiceRoomFeatureFlags.entryEffects]);

  useEffect(() => {
    if (room.status === 'closed' || room.localMember?.status === 'removed') {
      void handleLeave();
    }
  }, [handleLeave, room.localMember?.status, room.status]);

  useEffect(() => {
    if (reactionIndex < 0) return undefined;
    const timeout = setTimeout(() => setReactionIndex(-1), 1_800);
    return () => clearTimeout(timeout);
  }, [reactionIndex]);

  const handleSeatPress = useCallback(async (seat: RoomSeatViewModel) => {
    if (!seat.action) return;
    setPendingSeatId(seat.id);
    try {
      if (seat.action === 'claim') await seatControls.claimSeat(seat.id);
      else await seatControls.requestSeat(seat.id);
    } catch {
      // The seat controller exposes the authoritative localized error in the notice area.
    } finally {
      setPendingSeatId(undefined);
    }
  }, [seatControls]);

  const handlePrimaryMic = useCallback(() => {
    if (localIsSeated) {
      if (!canPublishAudio) return;
      void (isMicMuted ? unmuteMic() : muteMic());
      return;
    }
    const availableSeat = seats.find((seat) => seat.action);
    if (availableSeat) void handleSeatPress(availableSeat);
    else setToolsVisible(true);
  }, [canPublishAudio, handleSeatPress, isMicMuted, localIsSeated, muteMic, seats, unmuteMic]);

  const handleShare = useCallback(() => {
    void Share.share({
      message: `انضم إلى غرفة "${room.title}" — رقم الغرفة ${room.id}`,
      title: room.title,
    });
  }, [room.id, room.title]);

  const handleParticipantPress = useCallback((participant: VoiceParticipant) => {
    setParticipantsVisible(false);
    if (participant.id === room.localMember?.id) navigation.navigate('MeProfile');
    else navigation.navigate('UserProfile', { uid: participant.id });
  }, [navigation, room.localMember?.id]);

  const showParticipants = useCallback(() => {
    setToolsVisible(false);
    setParticipantsVisible(true);
  }, []);

  const openRoomGame = useCallback((session: RoomGameSession) => {
    if (session.clientRoute === 'MiniGame' || session.gameId === 'royal-majlis') {
      navigation.navigate('MiniGame', {
        initialMode: 'naval',
        roomId: room.id,
        sessionId: session.sessionId,
        source: 'voice-room',
      });
      return;
    }
    if (session.clientRoute === 'Carrom' || session.gameId === 'carrom-royal') {
      navigation.navigate('Carrom', {
        roomId: room.id,
        sessionId: session.sessionId,
        source: 'voice-room',
      });
      return;
    }
    if (!room.localMember?.id) {
      Alert.alert('الألعاب', 'تعذر التحقق من عضوية اللاعب في الغرفة.');
      return;
    }
    navigation.navigate('DrawingGuess', {
      displayName: room.localMember?.displayName,
      mode: 'online',
      playerId: room.localMember?.id,
      roomId: room.id,
      sessionId: session.sessionId,
      source: 'voice-room',
    });
  }, [navigation, room.id, room.localMember?.displayName, room.localMember?.id]);

  const createRoomGameInvite = useCallback(async (gameId: RoomGameId) => {
    if (gameCommandPending) return;
    setGameCommandPending(true);
    try {
      const result = await requestRoomGameCommand({
        action: 'create-room-game-invite',
        gameId,
        roomId: room.id,
      }, activeVoiceProviderConfig.liveKit);
      if (result.session) openRoomGame(result.session);
    } catch (error) {
      Alert.alert(
        'الألعاب',
        error instanceof RoomGameRequestError
          ? error.message
          : roomGameErrorMessage(undefined, 'تعذر إنشاء دعوة اللعبة.'),
      );
    } finally {
      setGameCommandPending(false);
    }
  }, [gameCommandPending, openRoomGame, room.id]);

  const showGame = useCallback(async () => {
    setToolsVisible(false);
    if (!voiceRoomFeatureFlags.games) {
      Alert.alert('الألعاب', 'ألعاب الغرفة غير مفعّلة حالياً.');
      return;
    }
    if (roomGameSession) {
      Alert.alert('الألعاب', 'توجد جلسة لعبة نشطة بالفعل. استخدم بطاقة اللعبة في نشاط الغرفة.');
      return;
    }
    if (gameCommandPending) return;
    setGameCommandPending(true);
    try {
      const result = await requestRoomGameCommand({
        action: 'list-room-games',
        roomId: room.id,
      }, activeVoiceProviderConfig.liveKit);
      const games = result.games ?? [];
      if (!games.length) {
        Alert.alert('الألعاب', 'لا توجد ألعاب متاحة لهذه الغرفة حالياً.');
        return;
      }
      Alert.alert(
        'دعوة لعبة اختيارية',
        'اختر لعبة. الألعاب المحلية تعمل على جهاز المضيف، والألعاب الجماعية تتطلب انضماماً صريحاً.',
        [
          ...games.map((game) => ({
            text: game.displayName.ar,
            onPress: () => { void createRoomGameInvite(game.gameId); },
          })),
          { text: 'إلغاء', style: 'cancel' as const },
        ],
      );
    } catch (error) {
      Alert.alert(
        'الألعاب',
        error instanceof RoomGameRequestError
          ? error.message
          : roomGameErrorMessage(undefined, 'تعذر تحميل ألعاب الغرفة.'),
      );
    } finally {
      setGameCommandPending(false);
    }
  }, [
    createRoomGameInvite,
    gameCommandPending,
    room.id,
    roomGameSession,
    voiceRoomFeatureFlags.games,
  ]);

  const openJoinedRoomGame = useCallback(() => {
    if (!roomGameSession) return;
    openRoomGame(roomGameSession);
  }, [openRoomGame, roomGameSession]);

  const joinRoomGameInvite = useCallback(async () => {
    if (!roomGameSession) return;
    if (roomGameSession.sessionMode !== 'multiplayer') return;
    if (gameCommandPending) return;
    setGameCommandPending(true);
    try {
      await requestRoomGameCommand({
        action: 'join-room-game',
        roomId: room.id,
        sessionId: roomGameSession.sessionId,
      }, activeVoiceProviderConfig.liveKit);
      openJoinedRoomGame();
    } catch (error) {
      Alert.alert(
        'الألعاب',
        error instanceof RoomGameRequestError
          ? error.message
          : roomGameErrorMessage(undefined, 'تعذر الانضمام إلى اللوبي.'),
      );
    } finally {
      setGameCommandPending(false);
    }
  }, [gameCommandPending, openJoinedRoomGame, room.id, roomGameSession]);

  const endRoomGameSession = useCallback(async () => {
    if (!roomGameSession) return;
    if (gameCommandPending) return;
    setGameCommandPending(true);
    try {
      await requestRoomGameCommand({
        action: 'end-room-game',
        roomId: room.id,
        sessionId: roomGameSession.sessionId,
      }, activeVoiceProviderConfig.liveKit);
    } catch (error) {
      Alert.alert(
        'الألعاب',
        error instanceof RoomGameRequestError
          ? error.message
          : roomGameErrorMessage(undefined, 'تعذر إنهاء جلسة اللعبة.'),
      );
    } finally {
      setGameCommandPending(false);
    }
  }, [gameCommandPending, room.id, roomGameSession]);

  const showGift = useCallback(() => {
    setToolsVisible(false);
    if (!voiceRoomFeatureFlags.gifts) {
      Alert.alert('الهدايا', 'هدايا الغرفة غير مفعّلة حالياً.');
      return;
    }
    if (giftRecipients.length === 0) {
      Alert.alert('الهدايا', 'لا يوجد مستلم متاح في الغرفة حالياً.');
      return;
    }
    setGiftVisible(true);
  }, [giftRecipients.length, voiceRoomFeatureFlags.gifts]);

  const showReport = useCallback(() => {
    setToolsVisible(false);
    if (!voiceRoomFeatureFlags.safety) {
      Alert.alert('الإبلاغ', 'أدوات السلامة غير مفعّلة حالياً.');
      return;
    }
    Alert.alert('الإبلاغ عن الغرفة', 'اختر سبب البلاغ.', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'محتوى غير آمن',
        onPress: () => void roomChat.execute({
          action: 'report-content',
          category: 'unsafe-room',
          subjectType: 'room',
        }).catch(() => undefined),
      },
      {
        text: 'مضايقة',
        onPress: () => void roomChat.execute({
          action: 'report-content',
          category: 'harassment',
          subjectType: 'room',
        }).catch(() => undefined),
      },
    ]);
  }, [roomChat, voiceRoomFeatureFlags.safety]);

  const openCommandPanel = useCallback((panel: NonNullable<typeof commandPanel>) => {
    setToolsVisible(false);
    setCommandPanel(panel);
  }, []);

  const confirmMemberAction = useCallback((
    title: string,
    message: string,
    action: () => Promise<unknown>,
    destructive = false,
  ) => {
    Alert.alert(title, message, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'تأكيد',
        style: destructive ? 'destructive' : 'default',
        onPress: () => void action().catch(() => undefined),
      },
    ]);
  }, []);

  const reportChatMessage = useCallback((message: RoomChatMessage) => {
    const submit = (category: RoomReportCategory) => roomChat.execute({
      action: 'report-content',
      category,
      messageId: message.id,
      subjectType: 'message',
    });
    Alert.alert('الإبلاغ عن الرسالة', 'اختر سبب البلاغ.', [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'رسائل مزعجة', onPress: () => void submit('spam').catch(() => undefined) },
      { text: 'مضايقة', onPress: () => void submit('harassment').catch(() => undefined) },
      { text: 'محتوى جنسي', onPress: () => void submit('sexual-content').catch(() => undefined) },
    ]);
  }, [roomChat]);

  const blockChatSender = useCallback((message: RoomChatMessage) => {
    confirmMemberAction(
      'حظر المستخدم',
      `سيتم إخفاء رسائل ${message.senderDisplayName || 'هذا المستخدم'} ومنع التفاعلات الاجتماعية بينكما.`,
      () => roomChat.execute({
        action: 'block-user',
        targetUid: message.senderUid,
      }),
      true,
    );
  }, [confirmMemberAction, roomChat]);

  const deleteChatMessage = useCallback((message: RoomChatMessage) => {
    confirmMemberAction(
      'حذف الرسالة',
      'ستظهر علامة حذف للمستخدمين مع الاحتفاظ بسياق الإشراف.',
      () => roomChat.execute({
        action: 'delete-message',
        messageId: message.id,
      }),
      true,
    );
  }, [confirmMemberAction, roomChat]);

  const pinChatMessage = useCallback((message: RoomChatMessage) => {
    void roomChat.execute({
      action: roomChat.pinnedMessageId === message.id ? 'unpin-message' : 'pin-message',
      messageId: message.id,
    }).catch(() => undefined);
  }, [roomChat]);

  const bottomBar = (
    <VoiceRoomBottomBar
      isConnected={isConnected && (!localIsSeated || canPublishAudio)}
      isMicMuted={isMicMuted}
      isSeated={localIsSeated}
      isSpeakerEnabled={isSpeakerEnabled}
      onChat={() => setChatVisible(true)}
      onGift={showGift}
      onMic={handlePrimaryMic}
      onReaction={() => setReactionIndex((current) => (current + 1) % REACTIONS.length)}
      onSpeaker={() => setSpeakerEnabled(!isSpeakerEnabled)}
      onTools={() => setToolsVisible(true)}
    />
  );

  return (
    <>
      <ScreenContainer
        bottomInset
        decorativeGlows
        fixedBottom={bottomBar}
        horizontalPadding={spacing.md}
        scroll={false}
        topPadding={spacing.xs}
      >
        <Image
          accessibilityIgnoresInvertColors
          resizeMode="cover"
          source={resolvedTheme.backgroundSource}
          style={styles.roomBackground}
        />
        {roomImageUrl && room.roomImageReviewStatus === 'approved' && room.roomCustomizationSuspended !== true ? (
          <Image
            accessibilityIgnoresInvertColors
            resizeMode="cover"
            source={{ uri: roomImageUrl }}
            style={styles.roomBackground}
          />
        ) : null}
        <View style={styles.ambientOrb} />
        <VoiceRoomHeader
          audienceCount={Math.max(room.participantCount, speakers.length + listeners.length)}
          onAudiencePress={showParticipants}
          onLeave={() => void handleLeave()}
          onShare={handleShare}
          ownerName={ownerName}
          recordingActive={roomRecording.indicatorActive}
          roomId={room.id}
          title={room.title}
        />
        <View pointerEvents="box-none" style={styles.incentiveLaunchers}>
          <RoomRocketButton data={roomRocket} onPress={() => setRocketVisible(true)} />
          <RoomTargetButton data={roomTarget} onPress={() => setTargetVisible(true)} />
        </View>

        {roomRecording.noticeVisible ? (
          <View style={[styles.notice, styles.noticeWarning]}>
            <Pressable onPress={() => { void roomRecording.acknowledgeNotice(); }} style={styles.retry}>
              <Text style={styles.retryText}>موافق</Text>
            </Pressable>
            <Text style={styles.noticeText}>
              هذه غرفة ناضجة قد تُسجَّل صوتياً لأغراض الأمان عند التفعيل. التسجيل للطاقم فقط.
            </Text>
          </View>
        ) : null}
        {notice ? (
          <View
            accessibilityLiveRegion="polite"
            style={[
              styles.notice,
              notice.kind === 'critical' && styles.noticeCritical,
              notice.kind === 'warning' && styles.noticeWarning,
            ]}
          >
            <SymbolView
              name={
                notice.kind === 'critical'
                  ? { ios: 'exclamationmark.triangle.fill', android: 'warning', web: 'warning' }
                  : notice.kind === 'warning'
                    ? { ios: 'lock.shield.fill', android: 'gpp_maybe', web: 'gpp_maybe' }
                    : { ios: 'waveform', android: 'graphic_eq', web: 'graphic_eq' }
              }
              size={15}
              tintColor={notice.kind === 'critical' ? '#FFB4C2' : colors.goldSoft}
            />
            <Text numberOfLines={2} style={styles.noticeText}>{notice.message}</Text>
            {connectionState === 'disconnected' || connectionState === 'error' ? (
              <Pressable accessibilityRole="button" onPress={() => void reconnectToRoom()} style={styles.retry}>
                <Text style={styles.retryText}>إعادة</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <VoiceRoomStage
          cosmeticsFlags={cosmeticsFeatureFlags}
          manifest={resolvedTheme.manifest}
          modeLabel={seatModeLabel(room.seatMode)}
          onSeatPress={(seat) => void handleSeatPress(seat)}
          pendingSeatId={pendingSeatId}
          seats={seats}
          targetedGiftEffect={roomEffects.activeEffect?.kind === 'room-gift'
            && roomEffects.activeEffect.giftPresentationTier === 'targeted'
            && roomEffects.activeEffect.presentation === 'visual'
            ? roomEffects.activeEffect
            : undefined}
        />

        <View style={styles.activity}>
          <View style={styles.activityHeader}>
            <View style={styles.connectionPill}>
              <View style={[styles.connectionDot, !isConnected && styles.connectionDotOffline]} />
              <Text style={styles.connectionText}>{statusLabel}</Text>
            </View>
            <Text style={styles.activityTitle}>نشاط الغرفة</Text>
          </View>
          <View style={styles.eventRow}>
            <View style={styles.eventIcon}>
              <SymbolView
                name={{ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }}
                size={14}
                tintColor={colors.goldSoft}
              />
            </View>
            <Text numberOfLines={2} style={styles.eventText}>
              مرحباً بك في {room.title}. احترم الآخرين واستمتع بالحديث.
            </Text>
          </View>
          {room.currentGameId ? (
            <View style={styles.eventRow}>
              <View style={styles.eventIcon}>
                <SymbolView
                  name={{ ios: 'gamecontroller.fill', android: 'sports_esports', web: 'sports_esports' }}
                  size={14}
                  tintColor={colors.goldSoft}
                />
              </View>
              <Text numberOfLines={1} style={styles.eventText}>توجد لعبة مرتبطة بالغرفة الآن.</Text>
            </View>
          ) : null}
          {voiceRoomFeatureFlags.games
            && roomGameSession
            && (roomGameSession.status === 'lobby' || roomGameSession.status === 'active') ? (
            <RoomGameInviteCard
              isPlayer={Boolean(
                room.localMember?.id
                && roomGameSession.playerUids.includes(room.localMember.id),
              )}
              onEnd={
                room.localMember?.id
                && (
                  roomGameSession.hostUid === room.localMember.id
                  || authorityRole === 'owner'
                  || authorityRole === 'moderator'
                )
                  ? () => { void endRoomGameSession(); }
                  : undefined
              }
              onJoin={
                roomGameSession.sessionMode === 'multiplayer'
                  ? () => { void joinRoomGameInvite(); }
                  : undefined
              }
              onOpenGame={openJoinedRoomGame}
              session={roomGameSession}
            />
          ) : null}
          {voiceRoomFeatureFlags.chat ? roomChat.messages.slice(-2).map((message) => (
            <View key={message.id} style={styles.chatPreview}>
              <Text numberOfLines={1} style={styles.chatPreviewSender}>
                {message.kind === 'moderation' ? 'إشعار' : message.senderDisplayName || 'عضو'}
              </Text>
              <Text numberOfLines={1} style={styles.chatPreviewText}>
                {message.status === 'deleted' ? 'تم حذف الرسالة.' : message.text}
              </Text>
            </View>
          )) : null}
        </View>

        {reactionIndex >= 0 ? (
          <View accessibilityLiveRegion="polite" style={styles.reactionBubble}>
            <Text style={styles.reactionText}>{REACTIONS[reactionIndex]}</Text>
          </View>
        ) : null}
        {roomEffects.activeEffect
          && !(roomEffects.activeEffect.kind === 'room-gift'
            && roomEffects.activeEffect.giftPresentationTier === 'targeted'
            && roomEffects.activeEffect.presentation === 'visual') ? (
          <RoomEffectOverlay
            effect={roomEffects.activeEffect}
            flags={cosmeticsFeatureFlags}
            onComplete={() => roomEffects.completeActiveEffect('completed')}
            onError={() => roomEffects.completeActiveEffect('renderer-error')}
            viewerMode={roomEffects.viewerMode}
          />
        ) : null}

        {shouldShowDebugPanel ? (
          <View style={styles.debugPanel}>
            <Text numberOfLines={2} style={styles.debugText}>
              {connectionState} · {debugEvents.at(-1) || room.id}
            </Text>
          </View>
        ) : null}
      </ScreenContainer>

      <RoomCommandCenterSheet
        authorityRole={commandCenterAuthorityRole}
        hasPendingSeatOffer={!canManageRoom
          && (commandCenterData.seatInvites.length > 0 || commandCenterData.seatRequests.length > 0)}
        musicEnabled={voiceRoomFeatureFlags.sharedMusic}
        onClose={() => setToolsVisible(false)}
        onGame={showGame}
        onGift={showGift}
        onMicrophones={() => openCommandPanel('microphones')}
        onMusic={() => {
          setToolsVisible(false);
          setMusicVisible(true);
          void roomMusic.loadCatalog();
        }}
        onOwnership={() => openCommandPanel('ownership')}
        onParticipants={showParticipants}
        onPeople={() => openCommandPanel('people')}
        onReaction={() => {
          setToolsVisible(false);
          setReactionIndex((current) => (current + 1) % REACTIONS.length);
        }}
        onReport={showReport}
        onRoomSettings={() => openCommandPanel('settings')}
        onSafety={() => openCommandPanel('safety')}
        onSeatOffers={() => openCommandPanel('seat-offers')}
        onShare={() => {
          setToolsVisible(false);
          handleShare();
        }}
        visible={toolsVisible}
      />
      <RoomMusicSheet
        canControl={canControlMusic}
        catalog={roomMusic.catalog}
        errorMessage={roomMusic.errorMessage}
        lease={roomMusic.lease}
        musicMuted={roomMusic.musicMuted}
        musicVolume={roomMusic.musicVolume}
        onClaimTrack={(trackId) => { void roomMusic.claimTrack(trackId); }}
        onClose={() => setMusicVisible(false)}
        onLoadCatalog={() => { void roomMusic.loadCatalog(); }}
        onSetMuted={roomMusic.setMusicMuted}
        onSetPlaybackState={(state) => { void roomMusic.setPlaybackState(state); }}
        onSetVolume={roomMusic.setMusicVolume}
        onStop={() => { void roomMusic.stopMusic(); }}
        visible={musicVisible}
      />
      <RoomRocketSheet
        cosmeticsFlags={cosmeticsFeatureFlags}
        data={roomRocket}
        onClose={() => setRocketVisible(false)}
        payoutsEnabled={voiceRoomFeatureFlags.rocketRewards}
        visible={rocketVisible}
      />
      <RoomTargetSheet
        cosmeticsFlags={cosmeticsFeatureFlags}
        data={roomTarget}
        isOwner={authorityRole === 'owner'}
        onClose={() => setTargetVisible(false)}
        ownerUid={ownerUid}
        roomId={room.id}
        visible={targetVisible}
      />
      {canManageRoom ? (
        <RoomMicrophonesSheet
          audioLockdown={room.audioLockdown === true}
          isOwner={authorityRole === 'owner'}
          onClose={() => setCommandPanel(undefined)}
          onLockAudio={hostControls.lockAudio}
          onLockSeat={async (seatId) => { await seatControls.lockSeat(seatId); }}
          onApproveRequest={async (request) => {
            await seatControls.approveRequest(request.requesterUid, request.requestedSeatId);
          }}
          onRejectRequest={async (request) => {
            await seatControls.rejectRequest(request.requesterUid);
          }}
          nameForUid={nameForUid}
          onResizeSeats={async (count) => { await seatControls.resizeSeats(count); }}
          onSetSeatMode={async (mode) => { await seatControls.setSeatMode(mode); }}
          onUnlockAudio={hostControls.unlockAudio}
          onUnlockSeat={async (seatId) => { await seatControls.unlockSeat(seatId); }}
          pending={isCommandPending}
          pendingInvites={commandCenterData.seatInvites}
          pendingRequests={commandCenterData.seatRequests}
          seatMode={room.seatMode ?? 'open'}
          seats={room.seats ?? []}
          seatTargetCount={room.seatTargetCount ?? 10}
          visible={commandPanel === 'microphones'}
        />
      ) : null}
      {canManageRoom ? (
        <RoomPeopleManagementSheet
          actorRole={authorityRole === 'owner' ? 'owner' : 'moderator'}
          cosmeticsFlags={cosmeticsFeatureFlags}
          members={roomMembers}
          onAssignModerator={(uid) => confirmMemberAction(
            'تعيين مشرف',
            'سيحصل هذا العضو على صلاحيات إدارة الغرفة.',
            () => hostControls.assignModerator(uid),
          )}
          onBan={(uid) => confirmMemberAction(
            'حظر العضو',
            'سيُطرد العضو ولن يستطيع العودة إلى هذه الغرفة.',
            () => hostControls.banMember(uid, 'room-moderation'),
            true,
          )}
          onClose={() => setCommandPanel(undefined)}
          onGrantDj={(uid) => void hostControls.grantDj(uid).catch(() => undefined)}
          onInviteToSeat={room.seatMode === 'invite'
            ? (uid) => {
              const availableSeat = (room.seats ?? []).find((seat) => seat.state === 'open' && !seat.retired);
              if (availableSeat) {
                void seatControls.inviteToSeat(uid, String(availableSeat.seatNumber).padStart(2, '0')).catch(() => undefined);
              }
            }
            : undefined}
          onRemove={(uid) => confirmMemberAction(
            'طرد العضو',
            'سيغادر العضو الغرفة الآن.',
            () => hostControls.removeMember(uid),
            true,
          )}
          onRemoveModerator={(uid) => confirmMemberAction(
            'إلغاء الإشراف',
            'سيعود هذا المشرف إلى دور عضو عادي.',
            () => hostControls.removeModerator(uid),
          )}
          onRevokeDj={(uid) => void hostControls.revokeDj(uid).catch(() => undefined)}
          pending={isCommandPending}
          visible={commandPanel === 'people'}
        />
      ) : null}
      {canManageRoom ? (
        <RoomSafetySheet
          audioLockdown={room.audioLockdown === true}
          bans={commandCenterData.bans}
          moderationEvents={commandCenterData.moderationEvents}
          nameForUid={nameForUid}
          onClose={() => setCommandPanel(undefined)}
          onLockAudio={hostControls.lockAudio}
          onParticipants={() => {
            setCommandPanel(undefined);
            setParticipantsVisible(true);
          }}
          onReports={() => {
            setCommandPanel(undefined);
            setParticipantsVisible(true);
          }}
          onUnlockAudio={hostControls.unlockAudio}
          onUnban={(uid) => confirmMemberAction(
            'إلغاء حظر العضو',
            'سيتمكن هذا العضو من دخول الغرفة مرة أخرى.',
            () => hostControls.unbanMember(uid),
          )}
          pending={isCommandPending}
          visible={commandPanel === 'safety'}
        />
      ) : null}
      <RoomSeatOffersSheet
        invite={commandCenterData.seatInvites[0]}
        onAcceptInvite={async (seatId) => {
          await seatControls.acceptInvite(seatId);
          setCommandPanel(undefined);
        }}
        onCancelRequest={async () => {
          await seatControls.cancelRequest();
          setCommandPanel(undefined);
        }}
        onClose={() => setCommandPanel(undefined)}
        onDeclineInvite={async () => {
          await seatControls.declineInvite();
          setCommandPanel(undefined);
        }}
        pending={isCommandPending}
        request={commandCenterData.seatRequests[0]}
        visible={commandPanel === 'seat-offers'}
      />
      {canManageRoom && authorityRole === 'owner' ? (
        <RoomSettingsSheet
          currentThemeId={room.themeId ?? 'majlis-default'}
          errorMessage={hostControls.errorMessage}
          initialSettings={roomSettings}
          mediaEnabled={voiceRoomFeatureFlags.media && room.roomCustomizationSuspended !== true}
          mediaErrorMessage={roomMediaControls.errorMessage}
          mediaPending={roomMediaControls.pending}
          mediaStatus={room.roomImageReviewStatus ?? 'none'}
          onClose={() => setCommandPanel(undefined)}
          onSelectRoomImage={roomMediaControls.selectAndSubmitImage}
          onSave={async (settings) => {
            await hostControls.updateRoomSettings(settings);
            setCommandPanel(undefined);
          }}
          purchasesEnabled={voiceRoomFeatureFlags.themePurchases}
          roomId={room.id}
          saving={hostControls.isCommandPending('update-room-settings')}
          themesEnabled={voiceRoomFeatureFlags.themes}
          visible={commandPanel === 'settings'}
        />
      ) : null}
      {canManageRoom && authorityRole === 'owner' ? (
        <RoomOwnershipSheet
          candidates={voiceRoomFeatureFlags.ownershipTransfer
            ? roomMembers.filter((member) => member.authorityRole !== 'owner')
            : []}
          cosmeticsFlags={cosmeticsFeatureFlags}
          errorMessage={ownershipTransfer.errorMessage || hostControls.errorMessage}
          onClose={() => setCommandPanel(undefined)}
          onCancelTransfer={() => {
            void ownershipTransfer.cancel().catch(() => undefined);
          }}
          onRemoveRoom={(reason) => confirmMemberAction(
            'حذف الغرفة',
            'ستُغلق الغرفة فوراً مع الاحتفاظ بسجل قابل للاستعادة لفريق المنصة.',
            () => hostControls.removeRoom(reason),
            true,
          )}
          onTransfer={(member, password) => confirmMemberAction(
            'إرسال عرض ملكية الغرفة',
            `سيصل إلى ${member.displayName} عرض صالح لمدة 15 دقيقة ولن تتغير الملكية قبل قبوله.`,
            () => ownershipTransfer.offer(member.id, password),
            true,
          )}
          ownershipPending={!!ownershipTransfer.pendingAction}
          pendingTransfer={ownershipTransfer.transfer?.status === 'pending'
            ? ownershipTransfer.transfer
            : undefined}
          pending={isCommandPending}
          visible={commandPanel === 'ownership'}
        />
      ) : null}
      <RoomOwnershipOfferSheet
        errorMessage={ownershipTransfer.errorMessage}
        fromDisplayName={ownerName}
        onAccept={(password) => {
          void ownershipTransfer.accept(password).catch(() => undefined);
        }}
        onDecline={() => {
          void ownershipTransfer.decline().catch(() => undefined);
        }}
        pending={!!ownershipTransfer.pendingAction}
        visible={
          voiceRoomFeatureFlags.ownershipTransfer
          && ownershipTransfer.transfer?.status === 'pending'
          && ownershipTransfer.transfer.toUid === room.localMember?.id
        }
      />
      <RoomChatSheet
        canManage={canModerateChat}
        canSend={canSendChat}
        chatEnabled={voiceRoomFeatureFlags.chat}
        cosmeticsFlags={cosmeticsFeatureFlags}
        currentUid={room.localMember?.id}
        errorMessage={roomChat.errorMessage}
        hasOlderMessages={roomChat.hasOlderMessages}
        isLoadingOlder={roomChat.isLoadingOlder}
        messages={roomChat.messages}
        onBlock={blockChatSender}
        onClose={() => setChatVisible(false)}
        onDelete={deleteChatMessage}
        onLoadOlder={() => { void roomChat.loadOlder(); }}
        onOpenProfile={(uid) => {
          setChatVisible(false);
          if (uid === room.localMember?.id) navigation.navigate('MeProfile');
          else navigation.navigate('UserProfile', { uid });
        }}
        onPin={pinChatMessage}
        onReport={reportChatMessage}
        onRetry={(message) => { void roomChat.retryMessage(message.id).catch(() => undefined); }}
        onSend={roomChat.sendMessage}
        pinnedMessageId={roomChat.pinnedMessageId}
        safetyEnabled={voiceRoomFeatureFlags.safety}
        visible={chatVisible}
      />
      <RoomGiftSheet
        enabled={voiceRoomFeatureFlags.gifts}
        onClose={() => setGiftVisible(false)}
        onGiftCommitted={(effect) => {
          roomEffects.enqueueLocalEffect({
            ...(effect.cosmeticAsset ? {
              assetId: effect.cosmeticAsset.assetId,
              assetVersionId: effect.cosmeticAsset.assetVersionId,
            } : {}),
            animationEnabled: effect.animationEnabled,
            audioEnabled: effect.audioEnabled,
            comboCount: effect.comboCount,
            comboKey: effect.comboKey,
            comboSequence: effect.comboSequence,
            durationMs: effect.durationMs,
            eventId: effect.eventId,
            expiresAtMs: effect.expiresAtMs,
            giftPresentationTier: effect.presentationTier,
            hapticPolicy: effect.hapticPolicy,
            kind: 'room-gift',
            label: `${effect.senderDisplayName} أرسل ${effect.nameAr}${effect.quantity > 1 ? ` ×${effect.quantity}` : ''} إلى ${effect.recipientDisplayName}`,
            priority: effect.priority,
            quantity: effect.quantity,
            recipientDisplayName: effect.recipientDisplayName,
            recipientUid: effect.recipientUid,
            senderDisplayName: effect.senderDisplayName,
            senderUid: effect.senderUid,
          });
        }}
        recipients={giftRecipients}
        roomId={room.id}
        visible={giftVisible}
      />
      <RoomParticipantsSheet
        cosmeticsFlags={cosmeticsFeatureFlags}
        listeners={listeners}
        onClose={() => setParticipantsVisible(false)}
        onChat={socialFeatureFlags.directMessages ? (participant) => {
          if (participant.id === room.localMember?.id) return;
          setParticipantsVisible(false);
          navigation.navigate('DirectChat', { source: 'room', targetUid: participant.id });
        } : undefined}
        onParticipantPress={handleParticipantPress}
        speakers={speakers}
        visible={participantsVisible}
      />
    </>
  );
}

const styles = StyleSheet.create({
  unavailableRoom: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.md,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  unavailableRoomTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: typography.weights.black,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  unavailableRoomText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  unavailableRoomButton: {
    backgroundColor: colors.gold,
    borderRadius: radius.full,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  unavailableRoomButtonText: {
    color: colors.background,
    fontWeight: typography.weights.black,
  },
  roomBackground: {
    bottom: 0,
    left: 0,
    opacity: 0.24,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  ambientOrb: {
    backgroundColor: 'rgba(184, 41, 75, 0.13)',
    borderRadius: radius.full,
    height: 260,
    position: 'absolute',
    right: -110,
    top: 80,
    width: 260,
  },
  incentiveLaunchers: {
    alignItems: 'flex-start',
    gap: 7,
    left: spacing.md,
    position: 'absolute',
    top: 82,
    zIndex: 20,
  },
  notice: {
    alignItems: 'center',
    backgroundColor: 'rgba(43, 203, 136, 0.10)',
    borderColor: 'rgba(43, 203, 136, 0.28)',
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    marginTop: spacing.sm,
    minHeight: 38,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  noticeCritical: {
    backgroundColor: 'rgba(184, 41, 75, 0.18)',
    borderColor: 'rgba(255, 122, 148, 0.42)',
  },
  noticeWarning: {
    backgroundColor: 'rgba(232, 190, 97, 0.12)',
    borderColor: colors.borderGold,
  },
  noticeText: {
    color: colors.text,
    flex: 1,
    fontSize: 10,
    fontWeight: typography.weights.bold,
    lineHeight: 15,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  retry: {
    backgroundColor: colors.surfaceStrong,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  retryText: {
    color: colors.goldSoft,
    fontSize: 9,
    fontWeight: typography.weights.black,
  },
  activity: {
    backgroundColor: 'rgba(5, 3, 9, 0.64)',
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flex: 1,
    marginTop: spacing.xs,
    maxHeight: 132,
    minHeight: 76,
    padding: spacing.sm,
  },
  activityHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  activityTitle: {
    color: colors.goldSoft,
    fontSize: 10,
    fontWeight: typography.weights.black,
    writingDirection: 'rtl',
  },
  connectionPill: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  connectionDot: {
    backgroundColor: colors.emerald,
    borderRadius: radius.full,
    height: 5,
    width: 5,
  },
  connectionDotOffline: {
    backgroundColor: colors.ruby,
  },
  connectionText: {
    color: colors.textSubtle,
    fontSize: 8,
    writingDirection: 'rtl',
  },
  eventRow: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    minHeight: 28,
  },
  eventIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(232,190,97,0.10)',
    borderRadius: radius.full,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  eventText: {
    color: colors.textMuted,
    flex: 1,
    fontSize: 10,
    lineHeight: 15,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  chatPreview: {
    alignItems: 'center',
    borderColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    marginTop: 4,
    paddingTop: 6,
  },
  chatPreviewSender: {
    color: colors.goldSoft,
    fontSize: 9,
    fontWeight: typography.weights.bold,
    maxWidth: 84,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  chatPreviewText: {
    color: colors.textSubtle,
    flex: 1,
    fontSize: 9,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  reactionBubble: {
    alignItems: 'center',
    backgroundColor: 'rgba(3,2,7,0.82)',
    borderColor: colors.borderGold,
    borderRadius: radius.full,
    borderWidth: 1,
    height: 58,
    justifyContent: 'center',
    position: 'absolute',
    right: spacing.xl,
    top: '52%',
    width: 58,
  },
  reactionText: {
    fontSize: 28,
  },
  giftEffect: {
    alignSelf: 'center',
    backgroundColor: 'rgba(3,2,7,0.88)',
    borderColor: colors.borderGold,
    borderRadius: radius.md,
    borderWidth: 1,
    bottom: 118,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    position: 'absolute',
  },
  compactEffect: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  giftEffectText: {
    color: colors.goldSoft,
    fontSize: 13,
    fontWeight: typography.weights.bold,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  entryEffectThumb: {
    borderRadius: radius.sm,
    height: 96,
    marginBottom: spacing.xs,
    resizeMode: 'cover',
    width: 172,
  },
  giftEffectThumb: {
    height: 48,
    width: 48,
  },
  debugPanel: {
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderRadius: radius.sm,
    bottom: 105,
    left: spacing.md,
    maxWidth: '70%',
    padding: spacing.xs,
    position: 'absolute',
  },
  debugText: {
    color: colors.textSubtle,
    fontSize: 8,
  },
});

function waitForEntryEffectRetry(delayMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
