import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { StatusFeatureFlags } from '../../status/featureFlags';
import type { StatusPresentation } from '../../status/statusPresentation';

const svipArtwork = require('../../../assets/status/svip-card-v1.png');
const aristocracyArtwork = require('../../../assets/status/aristocracy-card-v1.png');

export function StatusCardRow({ flags, onOpenAristocracy, onOpenVip, presentation }: {
  flags: Pick<StatusFeatureFlags, 'aristocracyCard' | 'statusPresentation' | 'svipCard'>;
  onOpenAristocracy?: () => void;
  onOpenVip?: () => void;
  presentation?: StatusPresentation;
}) {
  if (!flags.statusPresentation || (!flags.svipCard && !flags.aristocracyCard)) return null;
  const vip = presentation?.visibility === 'public' ? presentation.vip : undefined;
  const aristocracy = presentation?.visibility === 'public' ? presentation.aristocracy : undefined;
  const safeOpenVip = onOpenVip || (() => undefined);
  const safeOpenAristocracy = onOpenAristocracy || (() => undefined);
  return (
    <View accessibilityLabel="أنظمة الحالة" style={styles.row}>
      {flags.svipCard ? (
        <StatusCard
          accessibilityLabel={vip ? `${vip.band === 'svip' ? 'SVIP' : 'VIP'}، المستوى ${vip.level}، عرض التقدم` : 'SVIP، عرض المزايا والتقدم'}
          artwork={svipArtwork}
          fallbackColors={['#052D25', '#06110F']}
          label="SVIP"
          onPress={safeOpenVip}
          subtitle={vip ? `المستوى ${vip.level}` : 'المزايا والتقدم'}
        />
      ) : null}
      {flags.aristocracyCard ? (
        <StatusCard
          accessibilityLabel={aristocracy ? `الأرستقراطية، ${aristocracy.nameAr}، عرض الرتبة` : 'الأرستقراطية، عرض الرتب والمزايا'}
          artwork={aristocracyArtwork}
          fallbackColors={['#101D40', '#080A12']}
          label="الأرستقراطية"
          onPress={safeOpenAristocracy}
          subtitle={aristocracy?.nameAr || 'الرتب والمزايا'}
        />
      ) : null}
    </View>
  );
}

function StatusCard({ accessibilityLabel, artwork, fallbackColors, label, onPress, subtitle }: {
  accessibilityLabel: string;
  artwork: number;
  fallbackColors: [string, string];
  label: string;
  onPress?: () => void;
  subtitle: string;
}) {
  return (
    <Pressable
      accessibilityHint="يفتح مركز الحالة"
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <LinearGradient colors={fallbackColors} end={{ x: 1, y: 0 }} start={{ x: 0, y: 0 }} style={StyleSheet.absoluteFill} />
      <Image accessibilityIgnoresInvertColors contentFit="cover" pointerEvents="none" source={artwork} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={['rgba(4,2,3,0)', 'rgba(4,2,3,0.12)', 'rgba(4,2,3,0.7)']} end={{ x: 1, y: 0 }} pointerEvents="none" start={{ x: 0.15, y: 0 }} style={StyleSheet.absoluteFill} />
      <View pointerEvents="none" style={styles.copy}>
        <Text adjustsFontSizeToFit maxFontSizeMultiplier={1.35} minimumFontScale={0.72} numberOfLines={1} style={styles.title}>{label}</Text>
        <Text maxFontSizeMultiplier={1.25} numberOfLines={1} style={styles.subtitle}>{subtitle}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { aspectRatio: 3.4, borderColor: 'rgba(237,197,104,0.46)', borderRadius: 13, borderWidth: 1, elevation: 4, flex: 1, justifyContent: 'center', minHeight: 64, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.32, shadowRadius: 8 },
  copy: { alignItems: 'flex-end', alignSelf: 'stretch', paddingLeft: '37%', paddingRight: 10 },
  pressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  row: { flexDirection: 'row', gap: 10, minHeight: 64 },
  subtitle: { color: '#E6D4AF', fontSize: 9, fontWeight: '700', textAlign: 'right', writingDirection: 'rtl' },
  title: { color: '#FFF0BB', fontSize: 16, fontWeight: '900', textAlign: 'right', textShadowColor: '#120805', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4, writingDirection: 'rtl' },
});
