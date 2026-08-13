import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import { ComponentProps, ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, spacing, typography } from '../../theme';
import { RepresentativeBadge } from '../RepresentativeBadge';
import { RoomAuthorityRole } from '../../voice/roomV2Contract';
import { hasRoomCommandCenterCapability } from '../../voice/roomCommandCenterModel';
import { VoiceParticipant } from '../../voice/types';
import { AvatarPresentation } from '../AvatarPresentation';
import type { CosmeticsFeatureFlags } from '../../cosmetics/featureFlags';

type SymbolName = ComponentProps<typeof SymbolView>['name'];

type RoomCommandCenterSheetProps = {
  authorityRole?: RoomAuthorityRole;
  hasPendingSeatOffer?: boolean;
  isSpeakerEnabled?: boolean;
  musicEnabled?: boolean;
  watchEnabled?: boolean;
  onClose: () => void;
  onGame: () => void;
  onGift: () => void;
  onMicrophones: () => void;
  onMusic?: () => void;
  onWatch?: () => void;
  onOwnership: () => void;
  onParticipants: () => void;
  onPeople: () => void;
  onPk?: () => void;
  onReaction: () => void;
  onReport: () => void;
  onRoomSettings: () => void;
  onSafety: () => void;
  onSeatOffers: () => void;
  onShare: () => void;
  onSpeaker?: () => void;
  visible: boolean;
};

export function RoomCommandCenterSheet({
  authorityRole,
  hasPendingSeatOffer,
  isSpeakerEnabled = true,
  musicEnabled = false,
  watchEnabled = false,
  onClose,
  onGame,
  onGift,
  onMicrophones,
  onMusic,
  onWatch,
  onOwnership,
  onParticipants,
  onPeople,
  onPk,
  onReaction,
  onReport,
  onRoomSettings,
  onSafety,
  onSeatOffers,
  onShare,
  onSpeaker,
  visible,
}: RoomCommandCenterSheetProps) {
  const canManageMicrophones = hasRoomCommandCenterCapability(authorityRole, 'microphones');
  const canManagePeople = hasRoomCommandCenterCapability(authorityRole, 'people');
  const canManageSafety = hasRoomCommandCenterCapability(authorityRole, 'safety');
  const canManageSettings = hasRoomCommandCenterCapability(authorityRole, 'room-settings');
  const canManageOwnership = hasRoomCommandCenterCapability(authorityRole, 'ownership');

  return (
    <RoomSheet onClose={onClose} title="مركز أوامر الغرفة" visible={visible}>
      <Text style={styles.sheetSubtitle}>كل أدوات الغرفة في مكان واحد</Text>
      <View style={styles.toolGrid}>
        <Tool
          icon={{ ios: 'square.and.arrow.up.fill', android: 'share', web: 'share' }}
          label="مشاركة"
          onPress={onShare}
        />
        <Tool
          icon={{ ios: 'gamecontroller.fill', android: 'sports_esports', web: 'sports_esports' }}
          label="الألعاب"
          onPress={onGame}
        />
        {onPk ? (
          <Tool
            icon={{ ios: 'flag.checkered', android: 'sports_kabaddi', web: 'sports_kabaddi' }}
            label="تحدي PK"
            onPress={onPk}
          />
        ) : null}
        <Tool
          icon={{ ios: 'gift.fill', android: 'redeem', web: 'redeem' }}
          label="الهدايا"
          onPress={onGift}
        />
        <Tool
          icon={{ ios: 'face.smiling.fill', android: 'emoji_emotions', web: 'emoji_emotions' }}
          label="تفاعل"
          onPress={onReaction}
        />
        <Tool
          icon={
            isSpeakerEnabled
              ? { ios: 'speaker.wave.2.fill', android: 'volume_up', web: 'volume_up' }
              : { ios: 'speaker.slash.fill', android: 'volume_off', web: 'volume_off' }
          }
          label={isSpeakerEnabled ? 'السماعة' : 'صامت'}
          note={isSpeakerEnabled ? 'تشغيل' : 'كتم'}
          onPress={() => onSpeaker?.()}
        />
        <Tool
          icon={{ ios: 'person.3.fill', android: 'groups', web: 'groups' }}
          label="المشاركون"
          onPress={onParticipants}
        />
        <Tool
          icon={{ ios: 'exclamationmark.shield.fill', android: 'report', web: 'report' }}
          label="الإبلاغ"
          onPress={onReport}
        />
        {hasPendingSeatOffer ? (
          <Tool
            icon={{ ios: 'mic.badge.plus', android: 'mic', web: 'mic' }}
            label="طلب الميكروفون"
            note="بانتظار الإجراء"
            onPress={onSeatOffers}
          />
        ) : null}
        <Tool
          disabled={!musicEnabled}
          icon={{ ios: 'music.note', android: 'music_note', web: 'music_note' }}
          label="موسيقى"
          note={musicEnabled ? undefined : 'بانتظار تفعيل الميزة'}
          onPress={() => {
            if (musicEnabled) onMusic?.();
          }}
        />
        <Tool
          disabled={!watchEnabled}
          icon={{ ios: 'play.rectangle.fill', android: 'ondemand_video', web: 'ondemand_video' }}
          label="مشاهدة"
          note={watchEnabled ? undefined : 'بانتظار تفعيل الميزة'}
          onPress={() => {
            if (watchEnabled) onWatch?.();
          }}
        />
        {canManageMicrophones ? (
          <Tool
            icon={{ ios: 'mic.fill', android: 'mic', web: 'mic' }}
            label="الميكروفونات"
            onPress={onMicrophones}
          />
        ) : null}
        {canManagePeople ? (
          <Tool
            icon={{ ios: 'person.badge.shield.checkmark.fill', android: 'manage_accounts', web: 'manage_accounts' }}
            label="إدارة الأشخاص"
            onPress={onPeople}
          />
        ) : null}
        {canManageSafety ? (
          <Tool
            icon={{ ios: 'lock.shield.fill', android: 'gpp_good', web: 'gpp_good' }}
            label="السلامة"
            onPress={onSafety}
          />
        ) : null}
        {canManageSettings ? (
          <Tool
            icon={{ ios: 'slider.horizontal.3', android: 'tune', web: 'tune' }}
            label="إعدادات الغرفة"
            onPress={onRoomSettings}
          />
        ) : null}
        {canManageOwnership ? (
          <Tool
            icon={{ ios: 'crown.fill', android: 'workspace_premium', web: 'workspace_premium' }}
            label="الملكية والحذف"
            onPress={onOwnership}
          />
        ) : null}
      </View>
    </RoomSheet>
  );
}

export function RoomParticipantsSheet({
  cosmeticsFlags,
  listeners,
  onClose,
  onChat,
  onParticipantPress,
  speakers,
  visible,
}: {
  cosmeticsFlags: CosmeticsFeatureFlags;
  listeners: VoiceParticipant[];
  onClose: () => void;
  onChat?: (participant: VoiceParticipant) => void;
  onParticipantPress: (participant: VoiceParticipant) => void;
  speakers: VoiceParticipant[];
  visible: boolean;
}) {
  return (
    <RoomSheet onClose={onClose} title={`المشاركون (${speakers.length + listeners.length})`} visible={visible}>
      <ScrollView contentContainerStyle={styles.participantList} showsVerticalScrollIndicator={false}>
        {speakers.length ? <Text style={styles.sectionLabel}>على الميكروفون</Text> : null}
        {speakers.map((participant) => (
          <ParticipantRow cosmeticsFlags={cosmeticsFlags} key={participant.id} onChat={onChat ? () => onChat(participant) : undefined} onPress={() => onParticipantPress(participant)} participant={participant} />
        ))}
        {listeners.length ? <Text style={styles.sectionLabel}>المستمعون</Text> : null}
        {listeners.map((participant) => (
          <ParticipantRow cosmeticsFlags={cosmeticsFlags} key={participant.id} onChat={onChat ? () => onChat(participant) : undefined} onPress={() => onParticipantPress(participant)} participant={participant} />
        ))}
        {!speakers.length && !listeners.length ? (
          <Text style={styles.emptyText}>لا يوجد مشاركون آخرون الآن.</Text>
        ) : null}
      </ScrollView>
    </RoomSheet>
  );
}

export function RoomSheet({
  children,
  onClose,
  title,
  visible,
}: {
  children: ReactNode;
  onClose: () => void;
  title: string;
  visible: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalRoot}>
        <Pressable accessibilityLabel="إغلاق النافذة" onPress={onClose} style={styles.backdrop} />
        <LinearGradient
          colors={['#1C0B08', '#090405', '#020202']}
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.md }]}
        >
          <View style={styles.handle} />
          <View style={styles.sheetHeader}>
            <Pressable accessibilityLabel="إغلاق" accessibilityRole="button" onPress={onClose} style={styles.close}>
              <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={20} tintColor={colors.goldSoft} />
            </Pressable>
            <Text style={styles.sheetTitle}>{title}</Text>
          </View>
          {children}
        </LinearGradient>
      </View>
    </Modal>
  );
}

function Tool({
  disabled = false,
  icon,
  label,
  note,
  onPress,
}: {
  disabled?: boolean;
  icon: SymbolName;
  label: string;
  note?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={note ? `${label}، ${note}` : label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.tool, disabled && styles.toolDisabled, pressed && styles.pressed]}
    >
      <LinearGradient colors={['#6F170F', '#2A0807', '#0C0303']} style={styles.toolIcon}>
        <SymbolView name={icon} size={25} tintColor={colors.goldSoft} />
      </LinearGradient>
      <Text style={styles.toolLabel}>{label}</Text>
      {note ? <Text style={styles.toolNote}>{note}</Text> : null}
    </Pressable>
  );
}

function ParticipantRow({ cosmeticsFlags, onChat, onPress, participant }: { cosmeticsFlags: CosmeticsFeatureFlags; onChat?: () => void; onPress: () => void; participant: VoiceParticipant }) {
  const frame = participant.avatarFrameAssetUrl && participant.avatarFrameItemId ? {
    assetUrl: participant.avatarFrameAssetUrl,
    itemId: participant.avatarFrameItemId,
    ...(participant.avatarFrameAssetId && participant.avatarFrameAssetVersionId ? { canonicalAsset: { assetId: participant.avatarFrameAssetId, assetVersionId: participant.avatarFrameAssetVersionId } } : {}),
  } : undefined;
  return (
    <Pressable
      accessibilityLabel={`${participant.displayName}، ${participant.role === 'listener' ? 'مستمع' : 'على الميكروفون'}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.participantRow, pressed && styles.pressed]}
    >
      <AvatarPresentation flags={cosmeticsFlags} frame={frame} label={participant.avatarLabel} size={48} />
      <View style={styles.rowCopy}>
        <View style={styles.participantNameRow}>
          <Text numberOfLines={1} style={styles.rowName}>{participant.displayName}</Text>
          <RepresentativeBadge active={participant.representativeBadgeActive} />
        </View>
        <Text style={styles.rowMeta}>
          {participant.role === 'listener' ? 'مستمع' : participant.isMuted ? 'الميكروفون مكتوم' : 'على الميكروفون'}
        </Text>
      </View>
      <SymbolView
        name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }}
        size={18}
        tintColor={colors.textSubtle}
      />
      {onChat ? (
        <Pressable
          accessibilityLabel={`محادثة خاصة مع ${participant.displayName}`}
          accessibilityRole="button"
          hitSlop={8}
          onPress={(event) => {
            event.stopPropagation();
            onChat();
          }}
          style={styles.participantChat}
        >
          <SymbolView name={{ ios: 'bubble.left.fill', android: 'chat', web: 'chat' }} size={19} tintColor={colors.goldSoft} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.68)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  sheet: {
    borderColor: colors.borderGold,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    maxHeight: '82%',
    minHeight: 320,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    backgroundColor: 'rgba(246,217,145,0.38)',
    borderRadius: radius.full,
    height: 4,
    marginBottom: spacing.md,
    width: 44,
  },
  sheetHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sheetTitle: {
    color: colors.goldSoft,
    flex: 1,
    fontSize: typography.sizes.title,
    fontWeight: typography.weights.black,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  close: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  participantChat: {
    alignItems: 'center',
    backgroundColor: '#5B1118',
    borderColor: colors.borderGold,
    borderRadius: radius.full,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  sheetSubtitle: {
    color: colors.textMuted,
    fontSize: typography.sizes.caption,
    marginTop: spacing.xs,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  toolGrid: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    marginTop: spacing.lg,
  },
  tool: {
    alignItems: 'center',
    marginBottom: spacing.lg,
    width: '25%',
  },
  toolDisabled: {
    opacity: 0.46,
  },
  toolIcon: {
    alignItems: 'center',
    borderColor: 'rgba(232,190,97,0.54)',
    borderRadius: radius.lg,
    borderWidth: 1,
    height: 54,
    justifyContent: 'center',
    shadowColor: colors.goldDeep,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    width: 54,
  },
  toolLabel: {
    color: colors.text,
    fontSize: 10,
    fontWeight: typography.weights.bold,
    marginTop: 6,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  toolNote: {
    color: colors.textSubtle,
    fontSize: 8,
    marginTop: 1,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  pressed: {
    opacity: 0.72,
  },
  participantList: {
    gap: spacing.sm,
    paddingBottom: spacing.lg,
    paddingTop: spacing.md,
  },
  sectionLabel: {
    color: colors.gold,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
    marginTop: spacing.sm,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  participantRow: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: spacing.md,
    minHeight: 60,
    paddingHorizontal: spacing.md,
  },
  rowAvatar: {
    alignItems: 'center',
    backgroundColor: '#26101A',
    borderColor: colors.borderGold,
    borderRadius: radius.full,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  rowAvatarText: {
    color: colors.goldSoft,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.black,
  },
  rowCopy: {
    flex: 1,
  },
  participantNameRow: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: spacing.sm,
  },
  rowName: {
    color: colors.text,
    flexShrink: 1,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  rowMeta: {
    color: colors.textSubtle,
    fontSize: 10,
    marginTop: 2,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: typography.sizes.body,
    paddingVertical: spacing.xxl,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
});
