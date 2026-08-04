import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { doc, onSnapshot } from 'firebase/firestore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '../auth/AuthProvider';
import { firebaseDb } from '../auth/firebase';
import { activeVoiceProviderConfig } from './activeVoiceProviderConfig';
import {
  RoomMusicCatalogTrack,
  RoomMusicLease,
  RoomMusicRequestError,
  requestRoomMusicCommand,
  roomMusicErrorMessage,
} from './requestRoomMusicCommand';
import {
  estimateRoomMusicServerNowMs,
  resolveRoomMusicTargetPositionMs,
  shouldSeekRoomMusic,
} from './roomMusicSync';
import { useVoiceRoomFeatureFlags } from './voiceRoomFeatureFlags';

type UseRoomMusicSessionOptions = {
  canControlMusic: boolean;
  enabled: boolean;
  roomId: string;
};

export function useRoomMusicSession({
  canControlMusic,
  enabled,
  roomId,
}: UseRoomMusicSessionOptions) {
  const { authUser } = useAuth();
  const flags = useVoiceRoomFeatureFlags();
  const [lease, setLease] = useState<RoomMusicLease | null>(null);
  const [catalog, setCatalog] = useState<RoomMusicCatalogTrack[]>([]);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [musicMuted, setMusicMuted] = useState(false);
  const [musicVolume, setMusicVolume] = useState(0.55);
  const [appIsActive, setAppIsActive] = useState(AppState.currentState === 'active');
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const expiryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serverClockOffsetRef = useRef(0);
  const lastSyncKeyRef = useRef('');
  const playbackUri = lease?.status === 'active' ? lease?.nowPlaying?.playbackUri || '' : '';
  const player = useAudioPlayer(playbackUri || undefined);
  const playerStatus = useAudioPlayerStatus(player);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppIsActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!enabled || !flags.sharedMusic || !roomId) {
      setLease(null);
      return undefined;
    }

    let unsubscribeLease: (() => void) | undefined;
    const unsubscribeRoom = onSnapshot(doc(firebaseDb, 'rooms', roomId), (snapshot) => {
      unsubscribeLease?.();
      unsubscribeLease = undefined;
      const activeLeaseId = typeof snapshot.data()?.activeMusicLeaseId === 'string'
        ? snapshot.data()?.activeMusicLeaseId.trim()
        : '';
      if (!activeLeaseId) {
        setLease(null);
        return;
      }
      unsubscribeLease = onSnapshot(
        doc(firebaseDb, 'rooms', roomId, 'musicLeases', activeLeaseId),
        (leaseSnapshot) => {
          if (!leaseSnapshot.exists()) {
            setLease(null);
            return;
          }
          const data = leaseSnapshot.data();
          const observedAtMs = Date.now();
          const serverUpdatedAtMs = typeof data.updatedAt?.toMillis === 'function'
            ? data.updatedAt.toMillis()
            : Number(data.nowPlaying?.updatedAtMs || 0);
          if (serverUpdatedAtMs > 0) {
            const observedOffset = observedAtMs - serverUpdatedAtMs;
            serverClockOffsetRef.current = serverClockOffsetRef.current === 0
              ? observedOffset
              : Math.min(serverClockOffsetRef.current, observedOffset);
          }
          const expiresAtMs = Number(data.expiresAtMs || 0);
          if (
            String(data.status || 'active') !== 'active'
            || !expiresAtMs
            || expiresAtMs <= estimateRoomMusicServerNowMs(
              observedAtMs,
              serverClockOffsetRef.current,
            )
          ) {
            setLease(null);
            return;
          }
          setLease({
            djDisplayName: typeof data.djDisplayName === 'string' ? data.djDisplayName : '',
            djUid: typeof data.djUid === 'string' ? data.djUid : '',
            expiresAtMs,
            leaseId: leaseSnapshot.id,
            nowPlaying: data.nowPlaying && typeof data.nowPlaying === 'object'
              ? {
                artist: String(data.nowPlaying.artist || ''),
                durationMs: Number(data.nowPlaying.durationMs || 0),
                playbackState: String(data.nowPlaying.playbackState || 'idle'),
                playbackUri: String(data.nowPlaying.playbackUri || ''),
                positionMs: Number(data.nowPlaying.positionMs || 0),
                title: String(data.nowPlaying.title || ''),
                trackId: String(data.nowPlaying.trackId || ''),
                updatedAtMs: Number(data.nowPlaying.updatedAtMs || 0) || undefined,
              }
              : null,
            publishedTrackSid: typeof data.publishedTrackSid === 'string' ? data.publishedTrackSid : '',
            revision: Number(data.revision || 1),
            roomId,
            serverUpdatedAtMs: serverUpdatedAtMs || undefined,
            status: String(data.status || 'active'),
          });
        },
      );
    });

    return () => {
      unsubscribeLease?.();
      unsubscribeRoom();
    };
  }, [enabled, flags.sharedMusic, roomId]);

  useEffect(() => {
    if (expiryRef.current) {
      clearTimeout(expiryRef.current);
      expiryRef.current = null;
    }
    if (!lease) return undefined;
    const serverNowMs = estimateRoomMusicServerNowMs(Date.now(), serverClockOffsetRef.current);
    const remainingMs = lease.expiresAtMs - serverNowMs;
    if (remainingMs <= 0) {
      setLease(null);
      try {
        player.pause();
      } catch {
        // Player may already be released.
      }
      return undefined;
    }
    expiryRef.current = setTimeout(() => {
      setLease(null);
      try {
        player.pause();
      } catch {
        // Player may already be released.
      }
    }, remainingMs);
    return () => {
      if (expiryRef.current) {
        clearTimeout(expiryRef.current);
        expiryRef.current = null;
      }
    };
  }, [lease, player]);

  useEffect(() => {
    if (!playbackUri) return;
    try {
      player.volume = musicMuted ? 0 : musicVolume;
    } catch {
      // Player may not be ready yet.
    }
  }, [musicMuted, musicVolume, playbackUri, player]);

  useEffect(() => {
    if (!playbackUri || !lease?.nowPlaying || !playerStatus.isLoaded) return;
    const syncKey = [
      lease.leaseId,
      lease.revision,
      lease.nowPlaying.trackId,
      lease.nowPlaying.playbackState,
      appIsActive,
    ].join(':');
    if (lastSyncKeyRef.current === syncKey) return;
    lastSyncKeyRef.current = syncKey;
    if (!appIsActive) {
      try {
        player.pause();
      } catch {
        // Player may be transitioning.
      }
      return;
    }
    const serverNowMs = estimateRoomMusicServerNowMs(Date.now(), serverClockOffsetRef.current);
    const targetPositionMs = resolveRoomMusicTargetPositionMs(lease.nowPlaying, serverNowMs);
    const synchronize = async () => {
      if (shouldSeekRoomMusic(playerStatus.currentTime * 1_000, targetPositionMs)) {
        await player.seekTo(targetPositionMs / 1_000);
      }
      if (
        lease.nowPlaying?.playbackState === 'playing'
        && targetPositionMs < lease.nowPlaying.durationMs
      ) {
        player.play();
      } else {
        player.pause();
      }
    };
    void synchronize().catch(() => {
      setErrorMessage('تعذّرت مزامنة تشغيل الموسيقى.');
    });
  }, [
    appIsActive,
    lease?.leaseId,
    lease?.nowPlaying,
    lease?.revision,
    playbackUri,
    player,
    playerStatus.currentTime,
    playerStatus.isLoaded,
  ]);

  useEffect(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    if (!lease || !authUser || lease.djUid !== authUser.uid || lease.status !== 'active') {
      return undefined;
    }
    heartbeatRef.current = setInterval(() => {
      void requestRoomMusicCommand(
        {
          action: 'heartbeat-dj-lease',
          leaseId: lease.leaseId,
          roomId,
        },
        activeVoiceProviderConfig.liveKit,
      ).catch(() => undefined);
    }, 15_000);
    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };
  }, [authUser, lease, roomId]);

  const loadCatalog = useCallback(async () => {
    if (!flags.sharedMusic) return [];
    try {
      const result = await requestRoomMusicCommand(
        { action: 'list-room-music-catalog', roomId },
        activeVoiceProviderConfig.liveKit,
      );
      const next = result.catalog || [];
      setCatalog(next);
      setErrorMessage(undefined);
      return next;
    } catch (error) {
      const message = error instanceof RoomMusicRequestError
        ? roomMusicErrorMessage(error.code, error.message)
        : 'تعذّر تحميل كتالوج الموسيقى.';
      setErrorMessage(message);
      return [];
    }
  }, [flags.sharedMusic, roomId]);

  const claimTrack = useCallback(async (trackId: string) => {
    if (!canControlMusic) {
      setErrorMessage('ليست لديك صلاحية تشغيل الموسيقى.');
      return;
    }
    try {
      const result = await requestRoomMusicCommand(
        { action: 'claim-dj-lease', roomId, trackId },
        activeVoiceProviderConfig.liveKit,
      );
      if (result.lease) setLease(result.lease);
      setErrorMessage(undefined);
    } catch (error) {
      setErrorMessage(
        error instanceof RoomMusicRequestError
          ? roomMusicErrorMessage(error.code, error.message)
          : 'تعذّر بدء الموسيقى.',
      );
    }
  }, [canControlMusic, roomId]);

  const setPlaybackState = useCallback(async (playbackState: 'playing' | 'paused') => {
    if (!lease || !canControlMusic) return;
    try {
      const result = await requestRoomMusicCommand(
        {
          action: 'update-now-playing',
          leaseId: lease.leaseId,
          playbackState,
          positionMs: Math.max(0, Math.floor(playerStatus.currentTime * 1_000)),
          roomId,
          trackId: lease.nowPlaying?.trackId,
        },
        activeVoiceProviderConfig.liveKit,
      );
      if (result.lease) setLease(result.lease);
      setErrorMessage(undefined);
    } catch (error) {
      setErrorMessage(
        error instanceof RoomMusicRequestError
          ? roomMusicErrorMessage(error.code, error.message)
          : 'تعذّر تحديث التشغيل.',
      );
    }
  }, [canControlMusic, lease, playerStatus.currentTime, roomId]);

  const stopMusic = useCallback(async () => {
    if (!lease) return false;
    try {
      await requestRoomMusicCommand(
        { action: 'stop-music', leaseId: lease.leaseId, roomId },
        activeVoiceProviderConfig.liveKit,
      );
      setLease(null);
      setErrorMessage(undefined);
      return true;
    } catch (error) {
      setErrorMessage(
        error instanceof RoomMusicRequestError
          ? roomMusicErrorMessage(error.code, error.message)
          : 'تعذّر إيقاف الموسيقى.',
      );
      return false;
    }
  }, [lease, roomId]);

  const stopIfLocalDj = useCallback(async () => {
    if (!lease || !authUser || lease.djUid !== authUser.uid) return true;
    return stopMusic();
  }, [authUser, lease, stopMusic]);

  useEffect(() => {
    if (
      playerStatus.didJustFinish
      && lease
      && authUser
      && lease.djUid === authUser.uid
    ) {
      void stopMusic();
    }
  }, [authUser, lease, playerStatus.didJustFinish, stopMusic]);

  const nowPlayingLabel = useMemo(() => {
    if (!lease?.nowPlaying) return undefined;
    const { title, artist } = lease.nowPlaying;
    return `${title}${artist ? ` · ${artist}` : ''}${lease.djDisplayName ? ` · ${lease.djDisplayName}` : ''}`;
  }, [lease]);

  return {
    catalog,
    claimTrack,
    errorMessage,
    lease,
    loadCatalog,
    musicMuted,
    musicVolume,
    nowPlayingLabel,
    setMusicMuted,
    setMusicVolume,
    setPlaybackState,
    stopMusic,
    stopIfLocalDj,
  };
}
