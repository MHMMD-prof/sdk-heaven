import { I18nManager, Pressable, StyleSheet, Text, View } from 'react-native';

import type { AvatarFrameProjection } from '../../cosmetics/avatarFrameProjection';
import type { CosmeticsFeatureFlags } from '../../cosmetics/featureFlags';
import { ChatAvatar } from './ChatAvatar';
import { ChatIcon } from './ChatIcon';
import { chatColors, chatMetrics, chatTypography } from './chatTheme';
import type { StatusPresentation } from '../../status/statusPresentation';
import { StatusBadgeRow } from '../../components/status/StatusBadgeRow';

export type ChatConversationRowPresentation = {
  accessibilityLabel: string;
  archiveLabel: string;
  avatarUrl?: string;
  displayName: string;
  frame?: AvatarFrameProjection;
  muted: boolean;
  muteLabel: string;
  online?: boolean;
  preview: string;
  statusPresentation?: StatusPresentation;
  timestampLabel: string;
  unreadCount: number;
};

export function ChatConversationRow({ flags, onArchive, onLongPress, onMute, onPress, presentation }: {
  flags: CosmeticsFeatureFlags;
  onArchive?: () => void;
  onLongPress?: () => void;
  onMute?: () => void;
  onPress: () => void;
  presentation: ChatConversationRowPresentation;
}) {
  const unread = presentation.unreadCount > 0;
  return (
    <Pressable
      accessibilityLabel={presentation.accessibilityLabel}
      accessibilityActions={[
        { label: presentation.muteLabel, name: 'mute' },
        { label: presentation.archiveLabel, name: 'archive' },
      ]}
      accessibilityRole="button"
      onAccessibilityAction={({ nativeEvent }) => {
        if (nativeEvent.actionName === 'mute') onMute?.();
        if (nativeEvent.actionName === 'archive') onArchive?.();
      }}
      onLongPress={onLongPress}
      onPress={onPress}
      style={({ pressed }) => [styles.root, unread && styles.unreadRoot, pressed && styles.pressed]}
    >
      <ChatAvatar
        avatarUrl={presentation.avatarUrl}
        flags={flags}
        frame={presentation.frame}
        label={presentation.displayName}
        online={presentation.online}
        size={chatMetrics.avatarInbox}
      />
      <View style={styles.copy}>
        <View style={styles.line}>
          <View style={styles.identity}>
            <Text maxFontSizeMultiplier={2} numberOfLines={1} style={[styles.name, unread && styles.unreadText]}>{presentation.displayName}</Text>
            <StatusBadgeRow compact presentation={presentation.statusPresentation} />
          </View>
          <Text maxFontSizeMultiplier={2} numberOfLines={1} style={styles.time}>{presentation.timestampLabel}</Text>
        </View>
        <View style={styles.line}>
          <Text maxFontSizeMultiplier={2} numberOfLines={1} style={[styles.preview, unread && styles.unreadText]}>{presentation.preview}</Text>
          {presentation.muted ? <ChatIcon color={chatColors.textTertiary} name="mute" size={15} /> : null}
          {unread ? <View accessibilityElementsHidden importantForAccessibility="no" style={styles.badge}><Text style={styles.badgeText}>{presentation.unreadCount > 99 ? '99+' : presentation.unreadCount}</Text></View> : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', backgroundColor: chatColors.royalRedBright, borderRadius: 12, justifyContent: 'center', minHeight: 22, minWidth: 22, paddingHorizontal: 6 },
  badgeText: { color: chatColors.textPrimary, fontSize: 11, fontWeight: '800' },
  copy: { flex: 1, gap: 5, minWidth: 0 },
  line: { alignItems: 'center', flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row', gap: 8, justifyContent: 'space-between' },
  identity: { alignItems: 'center', flex: 1, flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row', gap: 5, minWidth: 0 },
  name: { ...chatTypography.name, color: chatColors.textPrimary, flex: 1, textAlign: I18nManager.isRTL ? 'right' : 'left' },
  pressed: { backgroundColor: chatColors.surfacePressed },
  preview: { color: chatColors.textSecondary, flex: 1, fontSize: 14, textAlign: I18nManager.isRTL ? 'right' : 'left', writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr' },
  root: { alignItems: 'center', borderBottomColor: chatColors.divider, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row', gap: 12, minHeight: chatMetrics.rowMinHeight, paddingHorizontal: chatMetrics.gutter, paddingVertical: 10 },
  time: { ...chatTypography.metadata, color: chatColors.textTertiary },
  unreadRoot: { backgroundColor: 'rgba(61,12,23,0.16)' },
  unreadText: { color: chatColors.textPrimary, fontWeight: '700' },
});
