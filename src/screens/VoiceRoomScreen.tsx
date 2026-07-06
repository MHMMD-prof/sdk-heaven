import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ReactNode, useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '../components/GlassCard';
import { LuxuryButton } from '../components/LuxuryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, radius, spacing, typography } from '../theme';
import { RootStackParamList } from '../types/navigation';
import { VoiceParticipant } from '../voice/types';
import { useVoiceRoomController } from '../voice/useVoiceRoomController';
import { useVoiceRooms } from '../voice/useVoiceRooms';

type VoiceRoomScreenProps = NativeStackScreenProps<RootStackParamList, 'VoiceRoom'>;

export function VoiceRoomScreen({ navigation, route }: VoiceRoomScreenProps) {
  const { getRoomById } = useVoiceRooms();
  const room = getRoomById(route.params.roomId);
  const {
    canPublishAudio,
    connectionState,
    errorMessage,
    isConnected,
    isMicMuted,
    isSpeakerEnabled,
    leaveRoom,
    listeners,
    moderationActions,
    muteMic,
    reconnectToRoom,
    setSpeakerEnabled,
    speakers,
    speakingParticipantIds,
    statusLabel,
    unmuteMic,
  } = useVoiceRoomController(room);

  const handleLeave = async () => {
    await leaveRoom();
    navigation.goBack();
  };

  useEffect(() => {
    if (room.status === 'closed' || room.localMember?.status === 'removed') {
      void handleLeave();
    }
  }, [room.localMember?.status, room.status]);

  const isMicControlDisabled = !isConnected || !canPublishAudio;
  const isSpeakerControlDisabled = !isConnected;

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Pressable onPress={handleLeave} style={styles.closeButton}>
          <Text style={styles.closeIcon}>×</Text>
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>{statusLabel}</Text>
          <Text style={styles.title}>{room.title}</Text>
          <Text style={styles.subtitle}>
            المتحدثون والمستمعون ظاهرون هنا من جلسة الصوت الحالية وبيانات المجموعة المحلية.
          </Text>
        </View>
      </View>

      {connectionState === 'error' && errorMessage ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      ) : null}

      <GlassCard style={styles.stageCard}>
        <View style={styles.stageTop}>
          <Text style={styles.stageMeta}>{speakers.length} متحدث</Text>
          <Text style={styles.stageTitle}>منصة المجموعة</Text>
        </View>
        <View style={styles.participantGrid}>
          {speakers.map((participant) => (
            <ParticipantBubble
              isSpeaking={speakingParticipantIds.includes(participant.id)}
              key={participant.id}
              participant={participant}
            />
          ))}
        </View>
      </GlassCard>

      <View style={styles.controls}>
        <Pressable
          disabled={isMicControlDisabled}
          onPress={isMicMuted ? unmuteMic : muteMic}
          style={[
            styles.controlButton,
            isMicMuted && styles.controlButtonMuted,
            isMicControlDisabled && styles.controlButtonDisabled,
          ]}
        >
          <Text style={styles.controlIcon}>{isMicMuted ? 'كتم' : 'صوت'}</Text>
          <Text style={styles.controlLabel}>{isMicMuted ? 'إلغاء الكتم' : 'كتم الميكروفون'}</Text>
        </Pressable>
        <Pressable
          disabled={isSpeakerControlDisabled}
          onPress={() => setSpeakerEnabled(!isSpeakerEnabled)}
          style={[
            styles.controlButton,
            !isSpeakerEnabled && styles.controlButtonMuted,
            isSpeakerControlDisabled && styles.controlButtonDisabled,
          ]}
        >
          <Text style={styles.controlIcon}>{isSpeakerEnabled ? 'سماعة' : 'صامت'}</Text>
          <Text style={styles.controlLabel}>{isSpeakerEnabled ? 'إيقاف السماعة' : 'تشغيل السماعة'}</Text>
        </Pressable>
      </View>

      {connectionState === 'disconnected' || connectionState === 'error' ? (
        <LuxuryButton onPress={reconnectToRoom} style={styles.reconnectButton} title="إعادة الاتصال" />
      ) : null}

      <GlassCard style={styles.actionCard}>
        <View style={styles.actionHeader}>
          <Text style={styles.actionBadge}>LiveKit</Text>
          <Text style={styles.actionTitle}>Start Drawing Guess</Text>
        </View>
        <Text style={styles.actionBody}>
          Opens Drawing Guess with this voice room id while voice stays connected separately.
        </Text>
        <LuxuryButton
          onPress={() =>
            navigation.navigate('DrawingGuess', {
              roomId: room.id,
              source: 'voice-room',
              mode: 'online',
            })
          }
          style={styles.startGameButton}
          title="Start Drawing Guess"
        />
      </GlassCard>

      <SectionBlock count={listeners.length} title="المستمعون">
        <View style={styles.listenerList}>
          {listeners.map((participant) => (
            <View key={participant.id} style={styles.listenerRow}>
              <View style={styles.smallAvatar}>
                <Text style={styles.smallAvatarText}>{participant.avatarLabel}</Text>
              </View>
              <Text style={styles.listenerName}>{participant.displayName}</Text>
            </View>
          ))}
        </View>
      </SectionBlock>

      <SectionBlock title="أدوات الإشراف">
        <View style={styles.moderationGrid}>
          {moderationActions.map((action) => (
            <Pressable
              disabled={action.isDisabled}
              key={action.key}
              onPress={action.onPress}
              style={[styles.moderationButton, action.isDisabled && styles.disabledModerationButton]}
            >
              <Text style={styles.moderationLabel}>{action.label}</Text>
            </Pressable>
          ))}
        </View>
      </SectionBlock>
    </ScreenContainer>
  );
}

type ParticipantBubbleProps = {
  participant: VoiceParticipant;
  isSpeaking: boolean;
};

function ParticipantBubble({ participant, isSpeaking }: ParticipantBubbleProps) {
  return (
    <View style={styles.participant}>
      <View style={[styles.participantAvatar, isSpeaking && styles.speakingAvatar]}>
        <Text style={styles.participantAvatarText}>{participant.avatarLabel}</Text>
      </View>
      <Text style={styles.participantName}>{participant.displayName}</Text>
      <Text style={[styles.participantStatus, isSpeaking && styles.speakingText]}>
        {participant.isMuted ? 'مكتوم' : isSpeaking ? 'يتحدث' : 'جاهز'}
      </Text>
    </View>
  );
}

type SectionBlockProps = {
  children: ReactNode;
  title: string;
  count?: number;
};

function SectionBlock({ children, count, title }: SectionBlockProps) {
  return (
    <GlassCard style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionCount}>{count ?? ''}</Text>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {children}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  closeButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  closeIcon: {
    color: colors.goldSoft,
    fontSize: 30,
    lineHeight: 34,
  },
  headerCopy: {
    flex: 1,
  },
  eyebrow: {
    color: colors.emerald,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  title: {
    color: colors.text,
    fontSize: typography.sizes.title,
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
  errorBanner: {
    backgroundColor: 'rgba(184, 41, 75, 0.16)',
    borderColor: 'rgba(184, 41, 75, 0.42)',
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  errorText: {
    color: colors.text,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  stageCard: {
    borderColor: colors.borderGold,
    gap: spacing.lg,
    marginBottom: spacing.md,
  },
  stageTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  stageMeta: {
    color: colors.gold,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    writingDirection: 'rtl',
  },
  stageTitle: {
    color: colors.text,
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.black,
    writingDirection: 'rtl',
  },
  participantGrid: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'center',
  },
  participant: {
    alignItems: 'center',
    width: 86,
  },
  participantAvatar: {
    alignItems: 'center',
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    height: 68,
    justifyContent: 'center',
    width: 68,
  },
  speakingAvatar: {
    borderColor: colors.emerald,
    borderWidth: 2,
    shadowColor: colors.emerald,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
  },
  participantAvatarText: {
    color: colors.goldSoft,
    fontSize: 24,
    fontWeight: typography.weights.black,
  },
  participantName: {
    color: colors.text,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    marginTop: spacing.sm,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  participantStatus: {
    color: colors.textSubtle,
    fontSize: 11,
    marginTop: 2,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  speakingText: {
    color: colors.emerald,
  },
  controls: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  controlButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.borderGold,
    borderRadius: radius.lg,
    borderWidth: 1,
    flex: 1,
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 76,
    padding: spacing.sm,
  },
  controlButtonMuted: {
    borderColor: 'rgba(184, 41, 75, 0.45)',
  },
  controlButtonDisabled: {
    opacity: 0.5,
  },
  controlIcon: {
    color: colors.goldSoft,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  controlLabel: {
    color: colors.text,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  reconnectButton: {
    marginBottom: spacing.md,
  },
  actionCard: {
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  actionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionBadge: {
    backgroundColor: colors.gold,
    borderRadius: radius.full,
    color: colors.backgroundDeep,
    fontSize: 11,
    fontWeight: typography.weights.bold,
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    writingDirection: 'rtl',
  },
  actionTitle: {
    color: colors.goldSoft,
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.black,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  actionBody: {
    color: colors.textMuted,
    fontSize: typography.sizes.caption,
    lineHeight: 19,
    marginTop: spacing.sm,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  startGameButton: {
    marginTop: spacing.md,
  },
  sectionCard: {
    gap: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionCount: {
    color: colors.gold,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.black,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  listenerList: {
    gap: spacing.sm,
  },
  listenerRow: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: spacing.sm,
  },
  smallAvatar: {
    alignItems: 'center',
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  smallAvatarText: {
    color: colors.text,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
  },
  listenerName: {
    color: colors.textMuted,
    flex: 1,
    fontSize: typography.sizes.body,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  moderationGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  moderationButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 42,
  },
  disabledModerationButton: {
    opacity: 0.45,
  },
  moderationLabel: {
    color: colors.textMuted,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
});
