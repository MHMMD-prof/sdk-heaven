import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEvent } from 'expo';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import LottieView from 'lottie-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { GlassCard } from '../components/GlassCard';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, radius, spacing, typography } from '../theme';
import type { RootStackParamList } from '../types/navigation';
import { readCosmeticsFeasibilityConfig } from './feasibilityConfig';

type CosmeticsFeasibilityScreenProps =
  NativeStackScreenProps<RootStackParamList, 'CosmeticsLab'>;

const lottieFixture = require('../../assets/cosmetics-lab/wave0-ring.json');
const staticFixture = require('../../assets/icon.png');

export function CosmeticsFeasibilityScreen({
  navigation,
}: CosmeticsFeasibilityScreenProps) {
  const config = useMemo(() => readCosmeticsFeasibilityConfig(), []);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [lottieState, setLottieState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [staticState, setStaticState] = useState<'loading' | 'ready' | 'error'>('loading');
  const lottieRef = useRef<LottieView>(null);

  const videoSource = useMemo(
    () => config.videoUrl
      ? { uri: config.videoUrl, contentType: 'progressive' as const, useCaching: true }
      : null,
    [config.videoUrl],
  );
  const videoPlayer = useVideoPlayer(videoSource, (player) => {
    player.loop = false;
    player.muted = true;
    player.staysActiveInBackground = false;
  });
  const videoStatus = useEvent(
    videoPlayer,
    'statusChange',
    { status: videoPlayer.status },
  );
  const videoPlaying = useEvent(
    videoPlayer,
    'playingChange',
    { isPlaying: videoPlayer.playing },
  );

  const audioPlayer = useAudioPlayer(config.audioUrl, {
    downloadFirst: true,
    keepAudioSessionActive: false,
    updateInterval: 250,
  });
  const audioStatus = useAudioPlayerStatus(audioPlayer);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion);
    const reducedMotionSubscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReducedMotion,
    );
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (!reducedMotion) lottieRef.current?.resume();
        return;
      }

      lottieRef.current?.pause();
      videoPlayer.pause();
      audioPlayer.pause();
    });

    return () => {
      appStateSubscription.remove();
      reducedMotionSubscription.remove();
    };
  }, [audioPlayer, reducedMotion, videoPlayer]);

  useEffect(() => {
    void setAudioModeAsync({
      interruptionMode: 'mixWithOthers',
      playsInSilentMode: true,
      shouldPlayInBackground: false,
    });
  }, []);

  const playVideo = () => {
    videoPlayer.currentTime = 0;
    videoPlayer.play();
  };

  const playAudio = () => {
    void audioPlayer.seekTo(0).then(() => audioPlayer.play());
  };

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>DEVELOPMENT ONLY</Text>
          <Text style={styles.title}>Cosmetics Wave 0 Lab</Text>
        </View>
      </View>

      <GlassCard style={styles.card}>
        <Text style={styles.sectionTitle}>Static image + cache</Text>
        <View style={styles.preview}>
          <Image
            cachePolicy="memory-disk"
            contentFit="contain"
            onError={() => setStaticState('error')}
            onLoad={() => setStaticState('ready')}
            source={staticFixture}
            style={styles.staticImage}
            transition={120}
          />
        </View>
        <StatusRow label="PNG fixture" value={staticState} />
      </GlassCard>

      <GlassCard style={styles.card}>
        <Text style={styles.sectionTitle}>Lottie JSON</Text>
        <View style={styles.preview}>
          {reducedMotion ? (
            <Image
              cachePolicy="memory"
              contentFit="contain"
              source={staticFixture}
              style={styles.staticImage}
            />
          ) : (
            <LottieView
              autoPlay
              cacheComposition
              enableSafeModeAndroid
              loop
              onAnimationFailure={() => setLottieState('error')}
              onAnimationLoaded={() => setLottieState('ready')}
              ref={lottieRef}
              renderMode="AUTOMATIC"
              resizeMode="contain"
              source={lottieFixture}
              style={styles.lottie}
            />
          )}
        </View>
        <StatusRow
          label="Vector fixture"
          value={reducedMotion ? 'static fallback (OS reduced motion)' : lottieState}
        />
      </GlassCard>

      <GlassCard style={styles.card}>
        <Text style={styles.sectionTitle}>H.264 MP4</Text>
        {config.videoUrl ? (
          <>
            <VideoView
              allowsPictureInPicture={false}
              contentFit="contain"
              nativeControls={false}
              player={videoPlayer}
              style={styles.video}
              surfaceType="textureView"
            />
            <LabButton
              label={videoPlaying.isPlaying ? 'Pause video' : 'Replay video'}
              onPress={videoPlaying.isPlaying ? () => videoPlayer.pause() : playVideo}
            />
            <StatusRow
              label="Cached progressive MP4"
              value={videoStatus.error?.message ?? videoStatus.status}
            />
          </>
        ) : (
          <MissingFixture variable="EXPO_PUBLIC_COSMETICS_LAB_VIDEO_URL" />
        )}
      </GlassCard>

      <GlassCard style={styles.card}>
        <Text style={styles.sectionTitle}>M4A / AAC effect audio</Text>
        {config.audioUrl ? (
          <>
            <LabButton
              label={audioStatus.playing ? 'Pause effect' : 'Play effect'}
              onPress={audioStatus.playing ? () => audioPlayer.pause() : playAudio}
            />
            <StatusRow
              label="Downloaded before playback"
              value={
                audioStatus.error
                ?? (audioStatus.isBuffering ? 'buffering' : audioStatus.playbackState)
              }
            />
            <Text style={styles.note}>
              Audio mode is mixWithOthers so this short effect must not stop LiveKit room audio.
            </Text>
          </>
        ) : (
          <MissingFixture variable="EXPO_PUBLIC_COSMETICS_LAB_AUDIO_URL" />
        )}
      </GlassCard>

      <GlassCard style={styles.card}>
        <Text style={styles.sectionTitle}>Physical-device exit checks</Text>
        <ChecklistItem text="Android: static, Lottie, MP4, and M4A all render/play." />
        <ChecklistItem text="iOS: static, Lottie, MP4, and M4A all render/play." />
        <ChecklistItem text="While connected to LiveKit, effect audio mixes without dropping voice." />
        <ChecklistItem text="Backgrounding pauses all effects; leaving this screen releases hook-owned players." />
        <ChecklistItem text="Reduced Motion replaces animation with a static fallback." />
        <ChecklistItem text="Slow network, replay/cache, rapid back navigation, and repeated opens do not crash." />
      </GlassCard>
    </ScreenContainer>
  );
}

function LabButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [
      styles.labButton,
      pressed && styles.pressed,
    ]}>
      <Text style={styles.labButtonText}>{label}</Text>
    </Pressable>
  );
}

function MissingFixture({ variable }: { variable: string }) {
  return (
    <View style={styles.missingFixture}>
      <Text style={styles.note}>No approved test asset configured.</Text>
      <Text selectable style={styles.variable}>{variable}</Text>
      <Text style={styles.note}>Set this to an HTTPS URL in local development only.</Text>
    </View>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statusRow}>
      <Text style={styles.statusLabel}>{label}</Text>
      <Text style={styles.statusValue}>{value}</Text>
    </View>
  );
}

function ChecklistItem({ text }: { text: string }) {
  return (
    <View style={styles.checkRow}>
      <View style={styles.checkDot} />
      <Text style={styles.checkText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  backText: {
    color: colors.gold,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
  },
  card: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  checkDot: {
    backgroundColor: colors.gold,
    borderRadius: radius.full,
    height: 7,
    marginTop: 7,
    width: 7,
  },
  checkRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  checkText: {
    color: colors.textMuted,
    flex: 1,
    fontSize: typography.sizes.body,
    lineHeight: 21,
  },
  eyebrow: {
    color: colors.gold,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  headerCopy: {
    flex: 1,
  },
  labButton: {
    alignItems: 'center',
    backgroundColor: colors.gold,
    borderRadius: radius.full,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  labButtonText: {
    color: colors.backgroundDeep,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.black,
  },
  lottie: {
    height: 190,
    width: 190,
  },
  missingFixture: {
    backgroundColor: colors.input,
    borderRadius: radius.md,
    gap: spacing.sm,
    padding: spacing.md,
  },
  note: {
    color: colors.textMuted,
    fontSize: typography.sizes.caption,
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.82,
  },
  preview: {
    alignItems: 'center',
    backgroundColor: colors.input,
    borderRadius: radius.lg,
    height: 210,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  sectionTitle: {
    color: colors.goldSoft,
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.black,
  },
  staticImage: {
    height: 150,
    width: 150,
  },
  statusLabel: {
    color: colors.textMuted,
    flex: 1,
    fontSize: typography.sizes.caption,
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statusValue: {
    color: colors.emerald,
    flexShrink: 1,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
  },
  title: {
    color: colors.text,
    fontSize: typography.sizes.title,
    fontWeight: typography.weights.black,
  },
  variable: {
    color: colors.gold,
    fontFamily: 'monospace',
    fontSize: typography.sizes.caption,
  },
  video: {
    backgroundColor: colors.backgroundDeep,
    borderRadius: radius.lg,
    height: 210,
    overflow: 'hidden',
    width: '100%',
  },
});
