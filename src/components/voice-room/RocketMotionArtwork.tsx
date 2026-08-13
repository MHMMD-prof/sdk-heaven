import { useEventListener } from 'expo';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import LottieView from 'lottie-react-native';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, type ImageStyle, type StyleProp } from 'react-native';

import type { CosmeticsFeatureFlags } from '../../cosmetics/featureFlags';

export type RocketMotionFormat = 'animated-webp' | 'lottie-json' | 'mp4';

export function RocketMotionArtwork({
  flags,
  format,
  motionUri,
  onComplete,
  onError,
  posterUri,
  style,
}: {
  flags: CosmeticsFeatureFlags;
  format?: RocketMotionFormat;
  motionUri?: string;
  onComplete?: () => void;
  onError?: () => void;
  posterUri?: string;
  style?: StyleProp<ImageStyle>;
}) {
  const videoAllowed = format !== 'mp4' || flags.video === true;
  const lottieAllowed = format !== 'lottie-json' || flags.lottie === true;
  const canPlayMotion = Boolean(motionUri) && videoAllowed && lottieAllowed;

  if (!canPlayMotion) {
    if (posterUri) {
      return (
        <Image
          cachePolicy="none"
          contentFit="contain"
          onError={onError}
          source={{ uri: posterUri }}
          style={[styles.fill, style]}
        />
      );
    }
    return null;
  }

  if (format === 'mp4' && motionUri) {
    return (
      <RocketVideo
        onComplete={onComplete}
        onError={onError}
        posterUri={posterUri}
        style={style}
        uri={motionUri}
      />
    );
  }

  if (format === 'lottie-json' && motionUri) {
    return (
      <LottieView
        autoPlay
        loop={false}
        onAnimationFailure={() => onError?.()}
        onAnimationFinish={(cancelled) => {
          if (!cancelled) onComplete?.();
        }}
        renderMode="AUTOMATIC"
        resizeMode="contain"
        source={{ uri: motionUri }}
        style={[styles.fill, style]}
      />
    );
  }

  return (
    <Image
      cachePolicy="none"
      contentFit="contain"
      onError={() => {
        if (posterUri) return;
        onError?.();
      }}
      source={{ uri: motionUri }}
      style={[styles.fill, style]}
    />
  );
}

function RocketVideo({
  onComplete,
  onError,
  posterUri,
  style,
  uri,
}: {
  onComplete?: () => void;
  onError?: () => void;
  posterUri?: string;
  style?: StyleProp<ImageStyle>;
  uri: string;
}) {
  const [failed, setFailed] = useState(false);
  const failedRef = useRef(false);
  const player = useVideoPlayer({ uri, useCaching: false }, (instance) => {
    instance.loop = false;
    instance.muted = true;
    instance.staysActiveInBackground = false;
    instance.play();
  });

  useEffect(() => {
    failedRef.current = false;
    setFailed(false);
  }, [uri]);

  useEventListener(player, 'playToEnd', () => {
    onComplete?.();
  });
  useEventListener(player, 'statusChange', ({ error, status }) => {
    if ((status === 'error' || error) && !failedRef.current) {
      failedRef.current = true;
      setFailed(true);
      onError?.();
    }
  });

  if (failed && posterUri) {
    return (
      <Image
        cachePolicy="none"
        contentFit="contain"
        source={{ uri: posterUri }}
        style={[styles.fill, style]}
      />
    );
  }

  return (
    <VideoView
      contentFit="contain"
      nativeControls={false}
      player={player}
      style={[styles.fill, style]}
    />
  );
}

const styles = StyleSheet.create({
  fill: {
    height: '100%',
    width: '100%',
  },
});
