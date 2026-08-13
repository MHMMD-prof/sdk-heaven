import { VideoView } from 'expo-video';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, spacing, typography } from '../../theme';
import { RoomWatchCatalogItem, RoomWatchLease } from '../../voice/requestRoomWatchCommand';

type RoomWatchSheetProps = {
  canControl: boolean;
  catalog: RoomWatchCatalogItem[];
  errorMessage?: string;
  lease: RoomWatchLease | null;
  onClaimItem: (itemId: string) => void;
  onClose: () => void;
  onLoadCatalog: () => void;
  onSetMuted: (muted: boolean) => void;
  onSetPlaybackState: (state: 'playing' | 'paused') => void;
  onStop: () => void;
  player: ReturnType<typeof import('expo-video').useVideoPlayer> | null;
  visible: boolean;
  watchMuted: boolean;
};

export function RoomWatchSheet({
  canControl,
  catalog,
  errorMessage,
  lease,
  onClaimItem,
  onClose,
  onLoadCatalog,
  onSetMuted,
  onSetPlaybackState,
  onStop,
  player,
  visible,
  watchMuted,
}: RoomWatchSheetProps) {
  const insets = useSafeAreaInsets();
  const playing = lease?.nowPlaying?.playbackState === 'playing';

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <Pressable onPress={onClose} style={[StyleSheet.absoluteFill, styles.backdrop]} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <Text style={styles.title}>مشاهدة مشتركة</Text>
        <Text style={styles.subtitle}>كتالوج معتمد · الصوت منفصل عن الميكروفونات</Text>

        {player && lease?.nowPlaying ? (
          <VideoView
            player={player}
            style={styles.video}
            contentFit="contain"
            nativeControls={false}
          />
        ) : null}

        {lease?.nowPlaying ? (
          <View style={styles.nowPlaying}>
            <Text style={styles.nowPlayingTitle}>{lease.nowPlaying.titleAr}</Text>
            <Text style={styles.nowPlayingMeta}>
              {lease.hostDisplayName ? `يستضيف ${lease.hostDisplayName}` : 'جلسة نشطة'}
            </Text>
            <View style={styles.row}>
              {canControl ? (
                <Pressable
                  onPress={() => onSetPlaybackState(playing ? 'paused' : 'playing')}
                  style={styles.button}
                >
                  <Text style={styles.buttonText}>{playing ? 'إيقاف مؤقت' : 'تشغيل'}</Text>
                </Pressable>
              ) : null}
              {canControl ? (
                <Pressable onPress={onStop} style={[styles.button, styles.danger]}>
                  <Text style={styles.buttonText}>إنهاء</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : (
          <Text style={styles.empty}>لا توجد مشاهدة حالياً</Text>
        )}

        <View style={styles.row}>
          <Pressable onPress={() => onSetMuted(!watchMuted)} style={styles.secondary}>
            <Text style={styles.secondaryText}>{watchMuted ? 'إلغاء كتم الفيديو' : 'كتم الفيديو'}</Text>
          </Pressable>
          <Pressable onPress={onLoadCatalog} style={styles.secondary}>
            <Text style={styles.secondaryText}>تحديث الكتالوج</Text>
          </Pressable>
        </View>

        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

        {canControl ? (
          <ScrollView style={styles.catalog}>
            {catalog.map((item) => (
              <Pressable
                key={item.itemId}
                onPress={() => onClaimItem(item.itemId)}
                style={styles.catalogItem}
              >
                <Text style={styles.catalogTitle}>{item.titleAr}</Text>
                <Text style={styles.catalogMeta}>{Math.round(item.durationMs / 1000)} ث</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.45)' },
  button: {
    backgroundColor: colors.gold,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  buttonText: { color: '#2A090C', fontWeight: typography.weights.black },
  catalog: { maxHeight: 180 },
  catalogItem: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  catalogMeta: { color: colors.textMuted },
  catalogTitle: { color: colors.text, fontWeight: typography.weights.bold },
  danger: { backgroundColor: '#B85C5C' },
  empty: { color: colors.textMuted, textAlign: 'right' },
  error: { color: '#E8A0A0', textAlign: 'right' },
  nowPlaying: { gap: spacing.sm },
  nowPlayingMeta: { color: colors.textMuted, textAlign: 'right' },
  nowPlayingTitle: {
    color: colors.goldSoft,
    fontSize: 16,
    fontWeight: typography.weights.black,
    textAlign: 'right',
  },
  row: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: spacing.sm },
  secondary: {
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  secondaryText: { color: colors.text },
  sheet: {
    backgroundColor: '#12080C',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    bottom: 0,
    gap: spacing.md,
    left: 0,
    padding: spacing.lg,
    position: 'absolute',
    right: 0,
  },
  subtitle: { color: colors.textMuted, textAlign: 'right' },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: typography.weights.black,
    textAlign: 'right',
  },
  video: {
    alignSelf: 'stretch',
    backgroundColor: '#000',
    borderRadius: radius.md,
    height: 180,
  },
});
