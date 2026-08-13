import { StyleSheet, View } from 'react-native';

import { AvatarPresentation } from '../../components/AvatarPresentation';
import type { AvatarFrameProjection } from '../../cosmetics/avatarFrameProjection';
import type { CosmeticsFeatureFlags } from '../../cosmetics/featureFlags';
import { chatColors } from './chatTheme';

export function ChatAvatar({
  avatarUrl,
  flags,
  frame,
  label,
  online = false,
  onlineAccessibilityLabel = 'Online',
  size,
}: {
  avatarUrl?: string;
  flags: CosmeticsFeatureFlags;
  frame?: AvatarFrameProjection;
  label: string;
  online?: boolean;
  onlineAccessibilityLabel?: string;
  size: number;
}) {
  return (
    <View style={[styles.ring, { borderRadius: size / 2, height: size, width: size }]}>
      <AvatarPresentation avatarUrl={avatarUrl} flags={flags} frame={frame} label={label} size={size - 4} viewerMode="reduced" />
      {online ? <View accessibilityLabel={onlineAccessibilityLabel} style={styles.online} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  online: {
    backgroundColor: chatColors.online,
    borderColor: chatColors.canvas,
    borderRadius: 7,
    borderWidth: 2,
    bottom: 0,
    height: 14,
    position: 'absolute',
    right: 0,
    width: 14,
  },
  ring: {
    alignItems: 'center',
    backgroundColor: chatColors.surface,
    borderColor: chatColors.gold,
    borderWidth: 1,
    justifyContent: 'center',
    position: 'relative',
  },
});
