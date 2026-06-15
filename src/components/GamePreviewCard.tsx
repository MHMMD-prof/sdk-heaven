import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../theme';
import { FeaturedGame } from '../types/game';

type GamePreviewCardProps = {
  game: FeaturedGame;
  featured?: boolean;
  onPress?: () => void;
};

export function GamePreviewCard({ game, featured = false, onPress }: GamePreviewCardProps) {
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        featured && styles.featuredCard,
        !onPress && styles.disabledCard,
        pressed && styles.cardPressed,
      ]}
    >
      <LinearGradient
        colors={[`${game.accentColor}66`, 'rgba(255,255,255,0.06)', 'rgba(8,5,15,0.78)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.art}
      >
        <View style={styles.tableLine} />
        <View style={[styles.coin, { borderColor: game.accentColor }]}>
          <Text style={styles.coinText}>♛</Text>
        </View>
        <View style={styles.tableBadge}>
          <Text style={styles.tableBadgeText}>{game.tableLabel}</Text>
        </View>
      </LinearGradient>
      <View style={styles.copy}>
        <View style={styles.titleRow}>
          {game.isComingSoon ? <Text style={styles.soon}>قريبا</Text> : <Text style={styles.live}>مباشر</Text>}
          <Text style={styles.category}>{game.category}</Text>
        </View>
        <Text style={styles.title}>{game.title}</Text>
        <Text style={styles.description}>{game.description}</Text>
        <View style={styles.footer}>
          <Text style={styles.provider}>{game.provider}</Text>
          <Text style={styles.players}>{game.playerCount} لاعب</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(255,255,255,0.065)',
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  featuredCard: {
    borderColor: colors.borderGold,
  },
  disabledCard: {
    opacity: 0.78,
  },
  cardPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.99 }],
  },
  art: {
    height: 126,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  tableLine: {
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: radius.full,
    height: 1,
    position: 'absolute',
    top: 78,
    width: '72%',
  },
  coin: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(8, 5, 15, 0.68)',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 58,
    justifyContent: 'center',
    width: 58,
  },
  coinText: {
    color: colors.goldSoft,
    fontSize: 28,
  },
  tableBadge: {
    backgroundColor: 'rgba(8,5,15,0.48)',
    borderRadius: radius.full,
    bottom: spacing.md,
    left: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    position: 'absolute',
  },
  tableBadgeText: {
    color: colors.goldSoft,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    writingDirection: 'rtl',
  },
  copy: {
    padding: spacing.lg,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  category: {
    color: colors.gold,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: typography.weights.black,
    marginTop: spacing.xs,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  description: {
    color: colors.textMuted,
    fontSize: typography.sizes.body,
    lineHeight: 21,
    marginTop: spacing.sm,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  provider: {
    color: colors.textSubtle,
    fontSize: typography.sizes.caption,
  },
  players: {
    color: colors.textMuted,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    writingDirection: 'rtl',
  },
  live: {
    color: colors.emerald,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    writingDirection: 'rtl',
  },
  soon: {
    color: colors.ruby,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    writingDirection: 'rtl',
  },
});
