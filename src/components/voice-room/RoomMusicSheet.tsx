import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, spacing, typography } from '../../theme';
import { RoomMusicCatalogTrack, RoomMusicLease } from '../../voice/requestRoomMusicCommand';

type RoomMusicSheetProps = {
  canControl: boolean;
  catalog: RoomMusicCatalogTrack[];
  errorMessage?: string;
  lease: RoomMusicLease | null;
  musicMuted: boolean;
  musicVolume: number;
  onClaimTrack: (trackId: string) => void;
  onClose: () => void;
  onLoadCatalog: () => void;
  onSetMuted: (muted: boolean) => void;
  onSetPlaybackState: (state: 'playing' | 'paused') => void;
  onSetVolume: (volume: number) => void;
  onStop: () => void;
  visible: boolean;
};

export function RoomMusicSheet({
  canControl,
  catalog,
  errorMessage,
  lease,
  musicMuted,
  musicVolume,
  onClaimTrack,
  onClose,
  onLoadCatalog,
  onSetMuted,
  onSetPlaybackState,
  onSetVolume,
  onStop,
  visible,
}: RoomMusicSheetProps) {
  const insets = useSafeAreaInsets();
  const playing = lease?.nowPlaying?.playbackState === 'playing';

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <Pressable onPress={onClose} style={[StyleSheet.absoluteFill, styles.backdrop]} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <Text style={styles.title}>موسيقى الغرفة</Text>
        <Text style={styles.subtitle}>كتالوج مشترك · مستوى الصوت منفصل عن الميكروفونات</Text>

        {lease?.nowPlaying ? (
          <View style={styles.nowPlaying}>
            <Text style={styles.nowPlayingTitle}>{lease.nowPlaying.title}</Text>
            <Text style={styles.nowPlayingMeta}>
              {lease.nowPlaying.artist}
              {lease.djDisplayName ? ` · DJ ${lease.djDisplayName}` : ''}
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
                  <Text style={styles.buttonText}>إيقاف</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : (
          <Text style={styles.empty}>لا يوجد تشغيل حالياً</Text>
        )}

        <View style={styles.row}>
          <Pressable onPress={() => onSetMuted(!musicMuted)} style={styles.secondary}>
            <Text style={styles.secondaryText}>{musicMuted ? 'إلغاء كتم الموسيقى' : 'كتم الموسيقى'}</Text>
          </Pressable>
          <Pressable
            onPress={() => onSetVolume(Math.max(0.1, Math.min(1, musicVolume + (musicVolume >= 0.7 ? -0.2 : 0.2))))}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>الصوت {Math.round(musicVolume * 100)}%</Text>
          </Pressable>
        </View>

        {canControl ? (
          <>
            <Pressable onPress={onLoadCatalog} style={styles.linkButton}>
              <Text style={styles.linkText}>تحديث الكتالوج</Text>
            </Pressable>
            <ScrollView style={styles.list}>
              {catalog.map((track) => (
                <Pressable
                  key={track.trackId}
                  onPress={() => onClaimTrack(track.trackId)}
                  style={styles.trackRow}
                >
                  <Text style={styles.trackTitle}>{track.title}</Text>
                  <Text style={styles.trackMeta}>{track.artist}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        ) : null}

        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    backgroundColor: colors.backgroundDeep,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    bottom: 0,
    left: 0,
    maxHeight: '78%',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    position: 'absolute',
    right: 0,
  },
  title: {
    color: colors.text,
    fontSize: typography.sizes.title,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: typography.sizes.caption,
    marginBottom: spacing.md,
    marginTop: spacing.xs,
    textAlign: 'right',
  },
  nowPlaying: {
    backgroundColor: colors.surfaceStrong,
    borderRadius: radius.md,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  nowPlayingTitle: {
    color: colors.text,
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.semibold,
    textAlign: 'right',
  },
  nowPlayingMeta: {
    color: colors.textMuted,
    fontSize: typography.sizes.caption,
    marginTop: spacing.xs,
    textAlign: 'right',
  },
  empty: {
    color: colors.textMuted,
    fontSize: typography.sizes.body,
    marginBottom: spacing.md,
    textAlign: 'right',
  },
  row: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  button: {
    backgroundColor: colors.gold,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  danger: {
    backgroundColor: colors.ruby,
  },
  buttonText: {
    color: colors.backgroundDeep,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
  },
  secondary: {
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  secondaryText: {
    color: colors.text,
    fontSize: typography.sizes.caption,
  },
  linkButton: {
    alignSelf: 'flex-end',
    marginBottom: spacing.sm,
  },
  linkText: {
    color: colors.gold,
    fontSize: typography.sizes.caption,
  },
  list: {
    maxHeight: 220,
  },
  trackRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.sm,
  },
  trackTitle: {
    color: colors.text,
    fontSize: typography.sizes.body,
    textAlign: 'right',
  },
  trackMeta: {
    color: colors.textMuted,
    fontSize: typography.sizes.caption,
    textAlign: 'right',
  },
  error: {
    color: colors.ruby,
    fontSize: typography.sizes.caption,
    marginTop: spacing.sm,
    textAlign: 'right',
  },
});
