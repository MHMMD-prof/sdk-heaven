import Constants from 'expo-constants';
import { useEventListener } from 'expo';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { Image, type ImageContentFit } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import LottieView, { type AnimationObject } from 'lottie-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  StyleSheet,
  View,
  type StyleProp,
  type ImageStyle,
  type ViewStyle,
} from 'react-native';

import {
  CosmeticAssetPreparationError,
  prepareCosmeticAsset,
  type PreparedCosmeticAsset,
} from './assetCache';
import {
  type CosmeticAssetDescriptorV1,
  type CosmeticPerformanceTier,
  type CosmeticRenderState,
  type CosmeticViewerMode,
  validateCosmeticAssetDescriptorV1,
} from './contracts';
import type { CosmeticsFeatureFlags } from './featureFlags';
import {
  resolveCosmeticRenderPlan,
  type CosmeticRenderPlan,
  type CosmeticRenderSource,
} from './rendererCore';
import { recordCosmeticsRuntimeEvent } from './runtimeTelemetry';

export type CosmeticAssetRendererProps = {
  compatibilityUri?: string;
  contentFit?: ImageContentFit;
  descriptor?: CosmeticAssetDescriptorV1;
  deviceTier?: CosmeticPerformanceTier;
  fallbackDescriptor?: CosmeticAssetDescriptorV1;
  flags: CosmeticsFeatureFlags;
  muted?: boolean;
  onComplete?: () => void;
  onError?: (reason: string) => void;
  onFirstFrame?: () => void;
  onStateChange?: (state: CosmeticRenderState, source: CosmeticRenderSource) => void;
  style?: StyleProp<ViewStyle>;
  viewerMode: CosmeticViewerMode;
};

type LoadedState = {
  asset?: PreparedCosmeticAsset;
  compatibilityUri?: string;
  posterUri?: string;
  source: CosmeticRenderSource;
};

export function CosmeticAssetRenderer(props: CosmeticAssetRendererProps) {
  const callbacksRef = useRef(props);
  callbacksRef.current = props;
  const appActive = useAppActive();
  const currentClientVersion = Constants.expoConfig?.version || '0.0.0';
  const plan = useMemo(() => resolveCosmeticRenderPlan({
    appActive,
    compatibilityUri: props.compatibilityUri,
    currentClientVersion,
    descriptor: props.descriptor,
    deviceTier: props.deviceTier,
    fallbackDescriptor: props.fallbackDescriptor,
    flags: props.flags,
    muted: props.muted,
    viewerMode: props.viewerMode,
  }), [
    appActive,
    currentClientVersion,
    props.compatibilityUri,
    props.descriptor,
    props.deviceTier,
    props.fallbackDescriptor,
    props.flags,
    props.muted,
    props.viewerMode,
  ]);
  const [loaded, setLoaded] = useState<LoadedState>({ source: 'none' });
  const [runtimeFailed, setRuntimeFailed] = useState(false);
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;
    setRuntimeFailed(false);
    if (plan.reason) {
      recordCosmeticsRuntimeEvent('fallback', {
        descriptor: props.descriptor,
        reason: plan.reason,
      });
    }
    if (plan.source === 'none') {
      setLoaded({ source: 'none' });
      callbacksRef.current.onStateChange?.(
        callbacksRef.current.viewerMode === 'off' ? 'off' : 'disabled',
        'none',
      );
      return () => controller.abort();
    }
    if (plan.source === 'compatibility') {
      setLoaded({ compatibilityUri: props.compatibilityUri, source: 'compatibility' });
      callbacksRef.current.onStateChange?.('static', 'compatibility');
      return () => controller.abort();
    }
    if (!plan.descriptor) return () => controller.abort();

    setLoaded({ source: plan.source });
    callbacksRef.current.onStateChange?.('loading', plan.source);
    const fallbackPromise = plan.source === 'primary'
      && validStaticDescriptor(props.fallbackDescriptor)
      ? prepareCosmeticAsset(props.fallbackDescriptor, controller.signal)
          .then((fallback) => {
            if (mounted) setLoaded((current) => ({ ...current, posterUri: fallback.uri }));
            return fallback;
          })
          .catch(() => undefined)
      : Promise.resolve(undefined);

    void prepareCosmeticAsset(plan.descriptor, controller.signal).then((asset) => {
      if (!mounted) return;
      setLoaded((current) => ({ ...current, asset, source: plan.source }));
    }).catch(async (error: unknown) => {
      if (!mounted || controller.signal.aborted) return;
      const fallback = await fallbackPromise;
      if (!mounted) return;
      const reason = error instanceof CosmeticAssetPreparationError
        ? error.reason
        : 'prepare-failed';
      recordCosmeticsRuntimeEvent('failure', { descriptor: plan.descriptor, reason });
      if (fallback) {
        recordCosmeticsRuntimeEvent('fallback', {
          descriptor: plan.descriptor,
          reason: 'prepare-failed',
        });
        setLoaded({ asset: fallback, posterUri: fallback.uri, source: 'fallback' });
        callbacksRef.current.onStateChange?.('static', 'fallback');
      } else if (props.compatibilityUri) {
        setLoaded({ compatibilityUri: props.compatibilityUri, source: 'compatibility' });
        callbacksRef.current.onStateChange?.('static', 'compatibility');
      } else {
        setLoaded({ source: 'none' });
        callbacksRef.current.onStateChange?.('failed', 'none');
        callbacksRef.current.onError?.(reason);
      }
    });

    return () => {
      mounted = false;
      controller.abort();
      recordCosmeticsRuntimeEvent('cancellation', { descriptor: plan.descriptor });
    };
  }, [
    plan,
    props.compatibilityUri,
    props.descriptor,
    props.fallbackDescriptor,
  ]);

  const failRenderer = useCallback((reason: string) => {
    const current = loadedRef.current;
    setRuntimeFailed(true);
    recordCosmeticsRuntimeEvent('failure', {
      descriptor: current.asset?.descriptor,
      reason,
    });
    if (current.source === 'primary' && current.posterUri) {
      setLoaded({ ...current, source: 'fallback' });
      callbacksRef.current.onStateChange?.('static', 'fallback');
      recordCosmeticsRuntimeEvent('fallback', {
        descriptor: current.asset?.descriptor,
        reason,
      });
      return;
    }
    if (
      current.source !== 'compatibility'
      && callbacksRef.current.compatibilityUri
    ) {
      setLoaded({ ...current, source: 'compatibility' });
      callbacksRef.current.onStateChange?.('static', 'compatibility');
      recordCosmeticsRuntimeEvent('fallback', {
        descriptor: current.asset?.descriptor,
        reason,
      });
      return;
    }
    setLoaded({ source: 'none' });
    callbacksRef.current.onStateChange?.('failed', current.source);
    callbacksRef.current.onError?.(reason);
  }, []);
  const ready = useCallback(() => {
    const current = loadedRef.current;
    callbacksRef.current.onStateChange?.('ready', current.source);
    recordCosmeticsRuntimeEvent('ready', { descriptor: current.asset?.descriptor });
  }, []);
  const firstFrame = useCallback(() => {
    ready();
    callbacksRef.current.onFirstFrame?.();
    recordCosmeticsRuntimeEvent('first-frame', {
      descriptor: loadedRef.current.asset?.descriptor,
    });
  }, [ready]);
  const complete = useCallback(() => callbacksRef.current.onComplete?.(), []);

  if (runtimeFailed) {
    const uri = loaded.source === 'fallback'
      ? loaded.posterUri
      : loaded.source === 'compatibility' ? props.compatibilityUri : undefined;
    return uri ? <StaticAsset contentFit={props.contentFit} onError={() => failRenderer('fallback-image-failed')} onReady={() => undefined} style={props.style} uri={uri} /> : null;
  }
  if (loaded.compatibilityUri) {
    return <StaticAsset contentFit={props.contentFit} onError={() => failRenderer('compatibility-failed')} onReady={ready} style={props.style} uri={loaded.compatibilityUri} />;
  }
  if (!loaded.asset) return <View style={props.style} />;
  const { asset } = loaded;
  if (asset.descriptor.format === 'lottie-json' && asset.animationData) {
    return (
      <LottieView
        autoPlay={appActive}
        cacheComposition
        enableSafeModeAndroid
        loop={asset.descriptor.loop}
        onAnimationFailure={() => failRenderer('lottie-failed')}
        onAnimationFinish={(cancelled) => {
          if (!cancelled) {
            complete();
            recordCosmeticsRuntimeEvent('completion', { descriptor: asset.descriptor });
          }
        }}
        onAnimationLoaded={ready}
        renderMode="AUTOMATIC"
        resizeMode={props.contentFit === 'cover' ? 'cover' : 'contain'}
        source={asset.animationData as unknown as AnimationObject}
        style={props.style}
      />
    );
  }
  if (asset.descriptor.format === 'mp4') {
    return (
      <CosmeticVideo
        asset={asset}
        onComplete={complete}
        onError={failRenderer}
        onFirstFrame={firstFrame}
        posterUri={loaded.posterUri || props.compatibilityUri}
        style={props.style}
      />
    );
  }
  if (asset.descriptor.format === 'm4a-aac') {
    return (
      <CosmeticAudio
        asset={asset}
        muted={props.muted === true || !appActive}
        onComplete={complete}
        onError={failRenderer}
        onReady={ready}
      />
    );
  }
  return <StaticAsset contentFit={props.contentFit} onError={() => failRenderer('image-failed')} onReady={firstFrame} style={props.style} uri={asset.uri} />;
}

function StaticAsset({
  contentFit = 'contain',
  onError,
  onReady,
  style,
  uri,
}: {
  contentFit?: ImageContentFit;
  onError: () => void;
  onReady: () => void;
  style?: StyleProp<ViewStyle>;
  uri: string;
}) {
  return (
    <Image
      cachePolicy="none"
      contentFit={contentFit}
      onDisplay={onReady}
      onError={onError}
      recyclingKey={uri}
      source={{ uri }}
      style={style as StyleProp<ImageStyle>}
      transition={100}
    />
  );
}

function CosmeticVideo({ asset, onComplete, onError, onFirstFrame, posterUri, style }: {
  asset: PreparedCosmeticAsset;
  onComplete?: () => void;
  onError: (reason: string) => void;
  onFirstFrame: () => void;
  posterUri?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const [firstFrame, setFirstFrame] = useState(false);
  const failedRef = useRef(false);
  const player = useVideoPlayer({ uri: asset.uri, useCaching: false }, (instance) => {
    instance.loop = asset.descriptor.loop;
    instance.muted = true;
    instance.staysActiveInBackground = false;
    instance.play();
  });
  useEffect(() => {
    failedRef.current = false;
    setFirstFrame(false);
  }, [asset.descriptor.assetId, asset.descriptor.assetVersionId]);
  useEventListener(player, 'playToEnd', () => {
    if (!asset.descriptor.loop) {
      onComplete?.();
      recordCosmeticsRuntimeEvent('completion', { descriptor: asset.descriptor });
    }
  });
  useEventListener(player, 'statusChange', ({ error, status }) => {
    if ((status === 'error' || error) && !failedRef.current) {
      failedRef.current = true;
      onError('video-failed');
    }
  });
  useEffect(() => () => {
    player.pause();
    recordCosmeticsRuntimeEvent('teardown', { descriptor: asset.descriptor });
  }, [asset.descriptor, player]);
  return (
    <View style={style}>
      {!firstFrame && posterUri ? (
        <Image cachePolicy="none" contentFit="contain" source={{ uri: posterUri }} style={StyleSheet.absoluteFill} />
      ) : null}
      <VideoView
        allowsPictureInPicture={false}
        contentFit="contain"
        fullscreenOptions={{ enable: false }}
        nativeControls={false}
        onFirstFrameRender={() => {
          if (!firstFrame) onFirstFrame();
          setFirstFrame(true);
        }}
        player={player}
        style={StyleSheet.absoluteFill}
        surfaceType="textureView"
      />
    </View>
  );
}

function CosmeticAudio({ asset, muted, onComplete, onError, onReady }: {
  asset: PreparedCosmeticAsset;
  muted: boolean;
  onComplete?: () => void;
  onError: (reason: string) => void;
  onReady: () => void;
}) {
  const player = useAudioPlayer(asset.uri, {
    downloadFirst: false,
    keepAudioSessionActive: false,
    updateInterval: 250,
  });
  const completedRef = useRef(false);
  useEffect(() => {
    if (muted) {
      player.pause();
      return undefined;
    }
    let active = true;
    let completion: ReturnType<typeof setTimeout> | undefined;
    completedRef.current = false;
    void setAudioModeAsync({
      interruptionMode: 'mixWithOthers',
      playsInSilentMode: true,
      shouldPlayInBackground: false,
    }).then(async () => {
      if (!active) return;
      player.volume = 0.7;
      await player.seekTo(0);
      if (!active) return;
      player.play();
      onReady();
      const duration = Math.max(1, asset.descriptor.durationMs || 1);
      completion = setTimeout(() => {
        if (!active || completedRef.current) return;
        completedRef.current = true;
        onComplete?.();
        recordCosmeticsRuntimeEvent('completion', { descriptor: asset.descriptor });
      }, duration);
    }).catch(() => {
      if (active) onError('audio-start-failed');
    });
    return () => {
      active = false;
      if (completion) clearTimeout(completion);
      player.pause();
      recordCosmeticsRuntimeEvent('teardown', { descriptor: asset.descriptor });
    };
  }, [asset.descriptor, muted, onComplete, onError, onReady, player]);
  return null;
}

function validStaticDescriptor(value: unknown): value is CosmeticAssetDescriptorV1 {
  const result = validateCosmeticAssetDescriptorV1(value, {
    allowLegacyWebp: true,
    requireRenderable: true,
  });
  return result.ok && ['png', 'jpeg', 'legacy-webp'].includes(result.descriptor.format);
}

function useAppActive() {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => subscription.remove();
  }, []);
  return active;
}
