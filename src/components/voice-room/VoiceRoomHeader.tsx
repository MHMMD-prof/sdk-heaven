import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { AvatarFrameProjection } from '../../cosmetics/avatarFrameProjection';
import type { CosmeticsFeatureFlags } from '../../cosmetics/featureFlags';
import { colors, radius, typography } from '../../theme';
import { formatRoomDisplayId } from '../../voice/roomSceneShellModel';
import { AvatarPresentation } from '../AvatarPresentation';

type VoiceRoomHeaderProps = {
  audienceCount: number;
  cosmeticsFlags: CosmeticsFeatureFlags;
  onAudiencePress: () => void;
  onLeave: () => void;
  onShare: () => void;
  ownerAvatarFrame?: AvatarFrameProjection;
  ownerAvatarLabel: string;
  ownerName: string;
  recordingActive?: boolean;
  roomId: string;
  title: string;
};

export function VoiceRoomHeader({
  audienceCount,
  cosmeticsFlags,
  onAudiencePress,
  onLeave,
  onShare,
  ownerAvatarFrame,
  ownerAvatarLabel,
  ownerName,
  recordingActive = false,
  roomId,
  title,
}: VoiceRoomHeaderProps) {
  const displayRoomId = formatRoomDisplayId(roomId);
  return (
    <View style={styles.root}>
      <View pointerEvents="none" style={styles.topGlint} />
      <View style={styles.actions}>
        <RoundButton
          accessibilityLabel={`المشاركون، ${audienceCount}`}
          badge={audienceCount}
          icon={{ ios: 'person.2.fill', android: 'groups', web: 'groups' }}
          onPress={onAudiencePress}
        />
        <RoundButton
          accessibilityLabel="مشاركة الغرفة"
          icon={{ ios: 'square.and.arrow.up', android: 'share', web: 'share' }}
          onPress={onShare}
        />
      </View>
      <View style={styles.identity}>
        <View style={styles.identityCopy}>
          <Text maxFontSizeMultiplier={1.2} numberOfLines={1} style={styles.title}>{title}</Text>
          <View style={styles.metaRow}>
            <Text maxFontSizeMultiplier={1.2} numberOfLines={1} style={styles.owner}>{ownerName}</Text>
            <View style={styles.dot} />
            <Text accessibilityLabel={`معرف الغرفة ${roomId}`} numberOfLines={1} style={styles.roomId}>
              ID {displayRoomId}
            </Text>
            {recordingActive ? (
              <>
                <View style={styles.dot} />
                <Text accessibilityLabel="تسجيل أمان نشط" style={styles.recording}>REC</Text>
              </>
            ) : null}
          </View>
        </View>
        <View style={styles.ownerAvatarShell}>
          <AvatarPresentation
            flags={cosmeticsFlags}
            frame={ownerAvatarFrame}
            label={ownerAvatarLabel}
            renderLegacyFrameWhenUnifiedDisabled
            size={44}
          />
          <View pointerEvents="none" style={styles.ownerMark}>
            <SymbolView
              name={{ ios: 'crown.fill', android: 'workspace_premium', web: 'workspace_premium' }}
              size={9}
              tintColor="#2A1604"
            />
          </View>
        </View>
      </View>
      <RoundButton
        accessibilityLabel="مغادرة الغرفة"
        icon={{ ios: 'rectangle.portrait.and.arrow.right', android: 'logout', web: 'logout' }}
        onPress={onLeave}
        tone="leave"
      />
    </View>
  );
}

function RoundButton({
  accessibilityLabel,
  badge,
  icon,
  onPress,
  tone = 'default',
}: {
  accessibilityLabel: string;
  badge?: number;
  icon: React.ComponentProps<typeof SymbolView>['name'];
  onPress: () => void;
  tone?: 'default' | 'leave';
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.roundButton,
        tone === 'leave' && styles.leaveButton,
        pressed && styles.pressed,
      ]}
    >
      <SymbolView
        name={icon}
        size={17}
        tintColor={tone === 'leave' ? '#FFBAC8' : '#F4D58A'}
      />
      {badge !== undefined ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 999 ? '999+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    backgroundColor: 'rgba(7, 3, 4, 0.82)',
    borderColor: 'rgba(230, 184, 94, 0.48)',
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: 7,
    minHeight: 66,
    overflow: 'visible',
    paddingHorizontal: 9,
    paddingVertical: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.38,
    shadowRadius: 14,
  },
  topGlint: {
    backgroundColor: 'rgba(255, 224, 159, 0.46)',
    borderRadius: radius.full,
    height: 1,
    left: 24,
    position: 'absolute',
    right: 24,
    top: 0,
  },
  identity: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row-reverse',
    gap: 9,
    minWidth: 0,
  },
  identityCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: '#FFF4DE',
    fontSize: 16,
    fontWeight: typography.weights.black,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: 5,
    marginTop: 3,
    minWidth: 0,
  },
  owner: {
    color: '#F4D58A',
    flexShrink: 1,
    fontSize: 10,
    fontWeight: typography.weights.bold,
    writingDirection: 'rtl',
  },
  roomId: {
    color: '#CDBB9D',
    flexShrink: 1,
    fontSize: 10,
    maxWidth: 98,
    writingDirection: 'ltr',
  },
  recording: {
    color: colors.ruby,
    fontSize: 10,
    fontWeight: typography.weights.bold,
  },
  dot: {
    backgroundColor: 'rgba(214, 168, 79, 0.55)',
    borderRadius: radius.full,
    height: 3,
    width: 3,
  },
  actions: {
    flexDirection: 'row',
    gap: 5,
  },
  ownerAvatarShell: {
    height: 48,
    justifyContent: 'center',
    position: 'relative',
    width: 48,
  },
  ownerMark: {
    alignItems: 'center',
    backgroundColor: colors.gold,
    borderColor: '#FFF0BE',
    borderRadius: radius.full,
    borderWidth: 1,
    bottom: -1,
    height: 18,
    justifyContent: 'center',
    position: 'absolute',
    right: -1,
    width: 18,
    zIndex: 5,
  },
  roundButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(8, 4, 5, 0.72)',
    borderColor: 'rgba(214, 168, 79, 0.4)',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  leaveButton: {
    borderColor: 'rgba(255, 122, 148, 0.45)',
  },
  pressed: {
    opacity: 0.72,
    transform: [{ scale: 0.97 }],
  },
  badge: {
    alignItems: 'center',
    backgroundColor: colors.ruby,
    borderColor: '#080405',
    borderRadius: radius.full,
    borderWidth: 1,
    minWidth: 17,
    paddingHorizontal: 3,
    position: 'absolute',
    right: -4,
    top: -4,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: typography.weights.black,
  },
});
