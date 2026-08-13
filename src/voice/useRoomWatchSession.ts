import { useVideoPlayer } from 'expo-video';
import { doc, onSnapshot } from 'firebase/firestore';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '../auth/AuthProvider';
import { firebaseDb } from '../auth/firebase';
import { useGrowthFeatureFlags } from '../growth/featureFlags';
import { activeVoiceProviderConfig } from './activeVoiceProviderConfig';
import {
  RoomWatchCatalogItem,
  RoomWatchLease,
  requestRoomWatchCommand,
  roomWatchErrorMessage,
} from './requestRoomWatchCommand';
import {
  estimateRoomWatchServerNowMs,
  resolveRoomWatchTargetPositionMs,
  shouldSeekRoomWatch,
} from './roomWatchSync';

type UseRoomWatchSessionOptions = {
  canControlWatch: boolean;
  enabled: boolean;
  roomId: string;
};

export function useRoomWatchSession({
  canControlWatch,
  enabled,
  roomId,
}: UseRoomWatchSessionOptions) {
  const { authUser } = useAuth();
  const growthFlags = useGrowthFeatureFlags();
  const [lease, setLease] = useState<RoomWatchLease | null>(null);
  const [catalog, setCatalog] = useState<RoomWatchCatalogItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [watchMuted, setWatchMuted] = useState(false);
  const [appIsActive, setAppIsActive] = useState(AppState.currentState === 'active');
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const serverClockOffsetRef = useRef(0);
  const lastSyncKeyRef = useRef('');
  const playbackUri = lease?.status === 'active' ? lease?.nowPlaying?.playbackUri || '' : '';
  const player = useVideoPlayer(
    playbackUri ? { uri: playbackUri, useCaching: false } : null,
    (instance) => {
      instance.loop = false;
      instance.muted = watchMuted;
    },
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppIsActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (player) player.muted = watchMuted;
  }, [player, watchMuted]);

  useEffect(() => {
    if (!enabled || !growthFlags.watchTogether || !roomId) {
      setLease(null);
      return undefined;
    }

    let unsubscribeLease: (() => void) | undefined;
    const unsubscribeRoom = onSnapshot(doc(firebaseDb, 'rooms', roomId), (snapshot) => {
      unsubscribeLease?.();
      unsubscribeLease = undefined;
      const activeLeaseId = typeof snapshot.data()?.activeWatchLeaseId === 'string'
        ? snapshot.data()?.activeWatchLeaseId.trim()
        : '';
      if (!activeLeaseId) {
        setLease(null);
        return;
      }
      unsubscribeLease = onSnapshot(
        doc(firebaseDb, 'rooms', roomId, 'watchLeases', activeLeaseId),
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
            || expiresAtMs <= estimateRoomWatchServerNowMs(
              observedAtMs,
              serverClockOffsetRef.current,
            )
          ) {
            setLease(null);
            return;
          }
          setLease({
            expiresAtMs,
            hostDisplayName: typeof data.hostDisplayName === 'string' ? data.hostDisplayName : '',
            hostUid: typeof data.hostUid === 'string' ? data.hostUid : '',
            leaseId: leaseSnapshot.id,
            nowPlaying: data.nowPlaying && typeof data.nowPlaying === 'object'
              ? {
                durationMs: Number(data.nowPlaying.durationMs || 0),
                itemId: String(data.nowPlaying.itemId || ''),
                playbackState: String(data.nowPlaying.playbackState || 'idle'),
                playbackUri: String(data.nowPlaying.playbackUri || ''),
                positionMs: Number(data.nowPlaying.positionMs || 0),
                titleAr: String(data.nowPlaying.titleAr || ''),
                updatedAtMs: Number(data.nowPlaying.updatedAtMs || 0) || undefined,
              }
              : null,
            revision: Number(data.revision || 1),
            roomId,
            status: String(data.status || 'active'),
          });
        },
      );
    });

    return () => {
      unsubscribeLease?.();
      unsubscribeRoom();
    };
  }, [enabled, growthFlags.watchTogether, roomId]);

  useEffect(() => {
    if (!player || !lease?.nowPlaying || !appIsActive || !playbackUri) return;
    const serverNowMs = estimateRoomWatchServerNowMs(Date.now(), serverClockOffsetRef.current);
    const targetPositionMs = resolveRoomWatchTargetPositionMs(lease.nowPlaying, serverNowMs);
    const syncKey = `${lease.leaseId}:${lease.revision}:${lease.nowPlaying.playbackState}:${Math.floor(targetPositionMs / 500)}`;
    if (lastSyncKeyRef.current === syncKey) return;
    lastSyncKeyRef.current = syncKey;

    const synchronize = async () => {
      const currentMs = (player.currentTime || 0) * 1_000;
      if (shouldSeekRoomWatch(currentMs, targetPositionMs)) {
        player.currentTime = targetPositionMs / 1_000;
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
      setErrorMessage('تعذّرت مزامنة المشاهدة المشتركة.');
    });
  }, [
    appIsActive,
    lease?.leaseId,
    lease?.nowPlaying,
    lease?.revision,
    playbackUri,
    player,
  ]);

  useEffect(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    if (!lease || !authUser || lease.hostUid !== authUser.uid || lease.status !== 'active') {
      return undefined;
    }
    heartbeatRef.current = setInterval(() => {
      void requestRoomWatchCommand(
        {
          action: 'heartbeat-watch-lease',
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
    try {
      const result = await requestRoomWatchCommand(
        { action: 'list-room-watch-catalog', roomId },
        activeVoiceProviderConfig.liveKit,
      );
      setCatalog(result.catalog || []);
      setErrorMessage(undefined);
    } catch (error) {
      setErrorMessage(roomWatchErrorMessage(error));
    }
  }, [roomId]);

  const claimItem = useCallback(async (itemId: string) => {
    if (!canControlWatch) return;
    try {
      await requestRoomWatchCommand(
        { action: 'claim-watch-lease', itemId, roomId },
        activeVoiceProviderConfig.liveKit,
      );
      setErrorMessage(undefined);
    } catch (error) {
      setErrorMessage(roomWatchErrorMessage(error));
    }
  }, [canControlWatch, roomId]);

  const setPlaybackState = useCallback(async (playbackState: 'playing' | 'paused') => {
    if (!canControlWatch || !lease) return;
    try {
      const positionMs = Math.floor((player?.currentTime || 0) * 1_000);
      await requestRoomWatchCommand(
        {
          action: 'update-watch-playback',
          leaseId: lease.leaseId,
          playbackState,
          positionMs,
          roomId,
        },
        activeVoiceProviderConfig.liveKit,
      );
      setErrorMessage(undefined);
    } catch (error) {
      setErrorMessage(roomWatchErrorMessage(error));
    }
  }, [canControlWatch, lease, player, roomId]);

  const stopWatch = useCallback(async () => {
    if (!canControlWatch || !lease) return;
    try {
      await requestRoomWatchCommand(
        { action: 'stop-watch', leaseId: lease.leaseId, roomId },
        activeVoiceProviderConfig.liveKit,
      );
      setErrorMessage(undefined);
    } catch (error) {
      setErrorMessage(roomWatchErrorMessage(error));
    }
  }, [canControlWatch, lease, roomId]);

  return {
    catalog,
    claimItem,
    errorMessage,
    lease,
    loadCatalog,
    player,
    setPlaybackState,
    setWatchMuted,
    stopWatch,
    watchMuted,
  };
}
