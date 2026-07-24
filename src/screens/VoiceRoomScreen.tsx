import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Image, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '../components/ScreenContainer';
import { useRepresentativeBadgeProjection } from '../social/useRepresentativeBadgeProjection';
import {
  RoomMicrophonesSheet,
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
import { VoiceRoomStage } from '../components/voice-room/VoiceRoomStage';
import { colors, radius, spacing, typography } from '../theme';
import { RootStackParamList } from '../types/navigation';
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
import { useVoiceRoomController } from '../voice/useVoiceRoomController';
import { useVoiceRooms } from '../voice/useVoiceRooms';
import { useVoiceRoomFeatureFlags } from '../voice/voiceRoomFeatureFlags';

type VoiceRoomScreenProps = NativeStackScreenProps<RootStackParamList, 'VoiceRoom'>;

const REACTIONS = ['👏', '❤️', '🔥', '✨'];

export function VoiceRoomScreen({ navigation, route }: VoiceRoomScreenProps) {
  const { getRoomById, startRoomPresence, stopRoomPresence } = useVoiceRooms();
  const sourceRoom = getRoomById(route.params.roomId);
  const voiceRoomFeatureFlags = useVoiceRoomFeatureFlags();
  const roomMediaControls = useRoomMediaControls(sourceRoom);
  const roomImageUrl = useRoomImageUrl(sourceRoom.activeRoomImagePath);
  const debugEvents = useDebugEvents();
  const shouldShowDebugPanel = isDebugLogEnabled();
  const [toolsVisible, setToolsVisible] = useState(false);
  const [participantsVisible, setParticipantsVisible] = useState(false);
  const [chatVisible, setChatVisible] = useState(false);
  const [commandPanel, setCommandPanel] = useState<
    'microphones' | 'people' | 'safety' | 'seat-offers' | 'settings' | 'ownership'
  >();
  const [pendingSeatId, setPendingSeatId] = useState<string>();
  const [reactionIndex, setReactionIndex] = useState(-1);
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
  const speakers = useMemo(
    () => sourceSpeakers.map((participant) => ({
      ...participant,
      representativeBadgeActive: activeBadges[participant.id] === true,
    })),
    [activeBadges, sourceSpeakers],
  );
  const listeners = useMemo(
    () => sourceListeners.map((participant) => ({
      ...participant,
      representativeBadgeActive: activeBadges[participant.id] === true,
    })),
    [activeBadges, sourceListeners],
  );
  const room = useMemo(() => ({
    ...sourceRoom,
    listeners: sourceRoom.listeners.map((member) => ({
      ...member,
      representativeBadgeActive: activeBadges[member.id] === true,
    })),
    localMember: sourceRoom.localMember ? {
      ...sourceRoom.localMember,
      representativeBadgeActive: activeBadges[sourceRoom.localMember.id] === true,
    } : undefined,
    speakers: sourceRoom.speakers.map((member) => ({
      ...member,
      representativeBadgeActive: activeBadges[member.id] === true,
    })),
  }), [activeBadges, sourceRoom]);

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
  const canModerateChat = authorityRole === 'owner' || authorityRole === 'moderator';
  const commandCenterAuthorityRole = voiceRoomFeatureFlags.commandCenter ? authorityRole : undefined;
  const commandCenterData = useRoomCommandCenterData(room.id, room.localMember?.id, canManageRoom);
  const roomChat = useRoomChat({
    avatarLabel: room.localMember?.avatarLabel || '',
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
  const roomSettings = useMemo(() => ({
    announcement: room.announcement ?? '',
    welcomeMessage: room.welcomeMessage ?? '',
    themeId: room.themeId ?? 'midnight',
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
      await stopRoomPresence(room.id);
      await leaveRoom();
      debugLog('voice.screen', 'leave:success', { roomId: room.id });
    } catch (error) {
      debugError('voice.screen', 'leave:error', error, { roomId: room.id });
    } finally {
      navigation.goBack();
    }
  }, [leaveRoom, navigation, room.id, stopRoomPresence]);

  useEffect(() => {
    debugLog('voice.screen', 'presence:start', { roomId: room.id });
    startRoomPresence(room.id);
    return () => {
      debugLog('voice.screen', 'presence:stop', { roomId: room.id });
      void stopRoomPresence(room.id);
    };
  }, [room.id, startRoomPresence, stopRoomPresence]);

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

  const showGame = useCallback(() => {
    setToolsVisible(false);
    navigation.navigate('DrawingGuess', {
      mode: 'online',
      roomId: room.id,
      source: 'voice-room',
    });
  }, [navigation, room.id]);

  const showGift = useCallback(() => {
    setToolsVisible(false);
    navigation.navigate('Gifts', {});
  }, [navigation]);

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
        {roomImageUrl ? (
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
          roomId={room.id}
          title={room.title}
        />

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
          modeLabel={seatModeLabel(room.seatMode)}
          onSeatPress={(seat) => void handleSeatPress(seat)}
          pendingSeatId={pendingSeatId}
          seats={seats}
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
        onClose={() => setToolsVisible(false)}
        onGame={showGame}
        onGift={showGift}
        onMicrophones={() => openCommandPanel('microphones')}
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
          saving={hostControls.isCommandPending('update-room-settings')}
          visible={commandPanel === 'settings'}
        />
      ) : null}
      {canManageRoom && authorityRole === 'owner' ? (
        <RoomOwnershipSheet
          candidates={roomMembers.filter((member) => member.authorityRole !== 'owner')}
          errorMessage={hostControls.errorMessage}
          onClose={() => setCommandPanel(undefined)}
          onRemoveRoom={(reason) => confirmMemberAction(
            'حذف الغرفة',
            'ستُغلق الغرفة فوراً مع الاحتفاظ بسجل قابل للاستعادة لفريق المنصة.',
            () => hostControls.removeRoom(reason),
            true,
          )}
          onTransfer={(member) => confirmMemberAction(
            'نقل ملكية الغرفة',
            `سيصبح ${member.displayName} المالك الجديد فوراً.`,
            () => hostControls.transferOwnership(member.id),
            true,
          )}
          pending={isCommandPending}
          visible={commandPanel === 'ownership'}
        />
      ) : null}
      <RoomChatSheet
        canManage={canModerateChat}
        canSend={canSendChat}
        chatEnabled={voiceRoomFeatureFlags.chat}
        currentUid={room.localMember?.id}
        errorMessage={roomChat.errorMessage}
        hasOlderMessages={roomChat.hasOlderMessages}
        isLoadingOlder={roomChat.isLoadingOlder}
        messages={roomChat.messages}
        onBlock={blockChatSender}
        onClose={() => setChatVisible(false)}
        onDelete={deleteChatMessage}
        onLoadOlder={() => { void roomChat.loadOlder(); }}
        onPin={pinChatMessage}
        onReport={reportChatMessage}
        onRetry={(message) => { void roomChat.retryMessage(message.id).catch(() => undefined); }}
        onSend={roomChat.sendMessage}
        pinnedMessageId={roomChat.pinnedMessageId}
        safetyEnabled={voiceRoomFeatureFlags.safety}
        visible={chatVisible}
      />
      <RoomParticipantsSheet
        listeners={listeners}
        onClose={() => setParticipantsVisible(false)}
        onParticipantPress={handleParticipantPress}
        speakers={speakers}
        visible={participantsVisible}
      />
    </>
  );
}

const styles = StyleSheet.create({
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
