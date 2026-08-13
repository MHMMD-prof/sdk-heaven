import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { CosmeticsFeatureFlags } from '../../cosmetics/featureFlags';
import type { RoomChatMessage } from '../../voice/roomChat';
import type { RoomThemeManifest } from '../../voice/roomThemeContract';
import { resolveRoomActivityPreview } from '../../voice/roomActivityPreviewModel';
import { AvatarPresentation } from '../AvatarPresentation';

const activityIcons = {
  chat: { ios: 'message.fill', android: 'chat_bubble', web: 'chat_bubble' },
  entry: { ios: 'door.left.hand.open', android: 'login', web: 'login' },
  game: { ios: 'gamecontroller.fill', android: 'sports_esports', web: 'sports_esports' },
  gift: { ios: 'gift.fill', android: 'redeem', web: 'redeem' },
  notice: { ios: 'megaphone.fill', android: 'campaign', web: 'campaign' },
} as const;

export function VoiceRoomActivityPreview({
  cosmeticsFlags,
  manifest,
  messages,
  onPress,
}: {
  cosmeticsFlags: CosmeticsFeatureFlags;
  manifest: RoomThemeManifest;
  messages: RoomChatMessage[];
  onPress: () => void;
}) {
  const activity = resolveRoomActivityPreview(messages);
  const isPerson = activity.message
    && activity.message.kind !== 'moderation'
    && activity.message.kind !== 'system';

  return (
    <Pressable
      accessibilityHint="يفتح دردشة الغرفة"
      accessibilityLabel={`${activity.sender}: ${activity.text}`}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
    >
      <LinearGradient
        colors={[`${manifest.colors.panelRaised}B8`, `${manifest.colors.panel}9E`]}
        end={{ x: 0, y: 1 }}
        start={{ x: 1, y: 0 }}
        style={[styles.card, { borderColor: `${manifest.colors.gold}7A` }]}
      >
        <View style={[styles.edge, { backgroundColor: manifest.colors.rubyBright }]} />
        {isPerson && activity.message ? (
          <AvatarPresentation
            flags={cosmeticsFlags}
            frame={activity.message.senderAvatarFrame}
            label={activity.message.senderAvatarLabel || activity.sender}
            size={26}
            viewerMode="reduced"
          />
        ) : (
          <View style={[styles.iconWell, { borderColor: `${manifest.colors.gold}99` }]}>
            <SymbolView
              name={activityIcons[activity.icon]}
              size={15}
              tintColor={manifest.colors.goldSoft}
            />
          </View>
        )}
        <Text numberOfLines={1} style={[styles.text, { color: manifest.colors.text }]}>
          <Text style={[styles.sender, { color: manifest.colors.goldSoft }]}>{activity.sender} · </Text>
          {activity.text}
        </Text>
        <SymbolView
          name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }}
          size={16}
          tintColor={manifest.colors.textMuted}
        />
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: 7,
    height: 40,
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  edge: {
    bottom: 7,
    borderRadius: 3,
    position: 'absolute',
    right: 0,
    top: 7,
    width: 2,
  },
  iconWell: {
    alignItems: 'center',
    backgroundColor: 'rgba(91, 12, 25, 0.56)',
    borderRadius: 999,
    borderWidth: 1,
    height: 26,
    justifyContent: 'center',
    width: 26,
  },
  pressable: {
    alignSelf: 'stretch',
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.99 }],
  },
  sender: {
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  text: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    minWidth: 0,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
});
