import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, AppState } from 'react-native';

import { debugError, debugLog } from '../utils/debugLog';
import { recordCosmeticsRuntimeEvent } from '../cosmetics/runtimeTelemetry';
import {
  QueuedRoomEffect,
  ROCKET_EFFECT_DELIVERY_GRACE_MS,
  RoomEffectKind,
  enqueueRoomEffect,
  isRoomEffectComboUpdate,
  mapRoomEventDocument,
  removeRoomEffect,
  resolveViewerEffectMode,
  selectActiveRoomEffect,
} from './roomEffectsQueue';

export function useRoomEffectsQueue(options: {
  entryEffectsEnabled: boolean;
  giftsEnabled: boolean;
  giftGlobalEffectsEnabled?: boolean;
  rocketEnabled?: boolean;
  roomEffectsPolicy?: string;
  roomId: string;
  suspended?: boolean;
  uid?: string;
  viewerCountryCode?: string;
  viewerRoomVisibility?: string;
}) {
  const [queue, setQueue] = useState<QueuedRoomEffect[]>([]);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [lowMemory, setLowMemory] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [nowMs, setNowMs] = useState(Date.now());
  const seenEventIdsRef = useRef(new Set<string>());
  const blockedUidsRef = useRef(new Set<string>());
  const presentUidsRef = useRef<Set<string> | undefined>(undefined);
  const enteredRoomAtRef = useRef(Date.now());
  const enabled = options.entryEffectsEnabled || options.giftsEnabled || options.rocketEnabled;
  const enabledKindsKey = `${options.entryEffectsEnabled ? 'entry' : ''}|${options.giftsEnabled ? 'gift' : ''}|${options.rocketEnabled ? 'rocket' : ''}`;

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReducedMotion(value);
    });
    const subscription = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReducedMotion);
    return () => {
      mounted = false;
      subscription?.remove?.();
    };
  }, []);

  useEffect(() => {
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      const active = state === 'active';
      if (active) enteredRoomAtRef.current = Date.now();
      setAppActive(active);
      if (!active) {
        setQueue((current) => {
          current.forEach((effect) => logDropped(effect, 'app-background'));
          return [];
        });
      }
    });
    const memorySubscription = AppState.addEventListener('memoryWarning', () => {
      setLowMemory(true);
      setQueue((current) => {
        current.forEach((effect) => logDropped(effect, 'memory-warning'));
        return [];
      });
    });
    return () => {
      appStateSubscription.remove();
      memorySubscription.remove();
    };
  }, []);

  useEffect(() => {
    enteredRoomAtRef.current = Date.now();
    seenEventIdsRef.current.clear();
    blockedUidsRef.current.clear();
    presentUidsRef.current = undefined;
    setQueue([]);
  }, [options.roomId]);

  useEffect(() => {
    if (options.rocketEnabled) enteredRoomAtRef.current = Date.now();
  }, [options.rocketEnabled]);

  useEffect(() => {
    const allowedKinds = new Set<RoomEffectKind>();
    if (options.entryEffectsEnabled) allowedKinds.add('room-entry');
    if (options.giftsEnabled) allowedKinds.add('room-gift');
    if (options.rocketEnabled) allowedKinds.add('room-rocket');
    setQueue((current) => current.filter((effect) => allowedKinds.has(effect.kind)));
  }, [enabledKindsKey, options.entryEffectsEnabled, options.giftsEnabled, options.rocketEnabled]);

  useEffect(() => {
    if (!enabled || !options.roomId || !appActive) {
      setQueue([]);
      return undefined;
    }
    let cancelled = false;
    const unsubscribers: (() => void)[] = [];
    void (async () => {
      const [{ firebaseDb }, firestore] = await Promise.all([
        import('../auth/firebase'),
        import('firebase/firestore'),
      ]);
      if (cancelled) return;
      if (options.uid) {
        const blockedSnapshot = await firestore.getDocs(
          firestore.collection(firebaseDb, 'blocks', options.uid, 'blocked'),
        );
        if (cancelled) return;
        blockedUidsRef.current = new Set(blockedSnapshot.docs.map((document) => document.id));
      }
      const enabledKinds = new Set<RoomEffectKind>();
      if (options.entryEffectsEnabled) enabledKinds.add('room-entry');
      if (options.giftsEnabled) enabledKinds.add('room-gift');
      if (options.rocketEnabled) enabledKinds.add('room-rocket');
      unsubscribers.push(
        firestore.onSnapshot(
          firestore.query(
            firestore.collection(firebaseDb, 'rooms', options.roomId, 'events'),
            firestore.orderBy('createdAt', 'desc'),
            firestore.limit(20),
          ),
          (snapshot) => {
            const now = Date.now();
            setNowMs(now);
            setQueue((current) => {
              let next = current.filter((item) => {
                const keep = item.expiresAtMs > now;
                if (!keep) logDropped(item, 'expired');
                return keep;
              });
              for (const document of snapshot.docs) {
                if (seenEventIdsRef.current.has(document.id)) continue;
                const mapped = mapRoomEventDocument({
                  ...document.data(),
                  eventId: document.id,
                }, now, {
                  blockedUids: blockedUidsRef.current,
                  enabledKinds,
                  expectedRoomId: options.roomId,
                });
                if (!mapped) continue;
                if (
                  mapped.kind === 'room-rocket'
                  && mapped.expiresAtMs - mapped.durationMs - ROCKET_EFFECT_DELIVERY_GRACE_MS
                    < enteredRoomAtRef.current
                ) {
                  seenEventIdsRef.current.add(mapped.eventId);
                  logDropped(mapped, 'joined-after-event');
                  continue;
                }
                if (
                  mapped.kind === 'room-entry'
                  && mapped.occurredAtMs
                  && mapped.occurredAtMs < enteredRoomAtRef.current
                ) {
                  seenEventIdsRef.current.add(mapped.eventId);
                  logDropped(mapped, 'already-present');
                  continue;
                }
                if (
                  mapped.kind === 'room-entry'
                  && presentUidsRef.current
                  && (!mapped.senderUid || !presentUidsRef.current.has(mapped.senderUid))
                ) {
                  logDropped(mapped, 'participant-left');
                  seenEventIdsRef.current.add(mapped.eventId);
                  continue;
                }
                const comboUpdate = isRoomEffectComboUpdate(next, mapped);
                seenEventIdsRef.current.add(mapped.eventId);
                const beforeEnqueue = next;
                next = enqueueRoomEffect(next, mapped, now);
                beforeEnqueue.forEach((item) => {
                  if (!next.some((queued) => queued.eventId === item.eventId)) {
                    logDropped(item, 'priority-cap');
                  }
                });
                if (!comboUpdate && !next.some((item) => item.eventId === mapped.eventId)) {
                  logDropped(mapped, 'priority-cap');
                }
                if (comboUpdate) {
                  recordCosmeticsRuntimeEvent('combo-update', { reason: mapped.comboKey });
                }
                debugLog('voice.effects', 'queued', {
                  eventId: mapped.eventId,
                  kind: mapped.kind,
                  roomId: options.roomId,
                });
              }
              return next;
            });
          },
          (error) => debugError('voice.effects', 'subscription:error', error, { roomId: options.roomId }),
        ),
        firestore.onSnapshot(
          firestore.collection(firebaseDb, 'rooms', options.roomId, 'presence'),
          (snapshot) => {
            const present = new Set(
              snapshot.docs
                .filter((document) => ['online', 'reconnecting'].includes(String(document.data().status)))
                .map((document) => document.id),
            );
            presentUidsRef.current = present;
            setQueue((current) => current.filter((effect) => {
              const keep = effect.kind !== 'room-entry' || (!!effect.senderUid && present.has(effect.senderUid));
              if (!keep) logDropped(effect, 'participant-left');
              return keep;
            }));
          },
          (error) => debugError('voice.effects', 'presence:error', error, { roomId: options.roomId }),
        ),
      );
      if (options.giftsEnabled && options.giftGlobalEffectsEnabled) {
        unsubscribers.push(
          firestore.onSnapshot(
            firestore.query(
              firestore.collection(firebaseDb, 'globalRoomEffects'),
              firestore.orderBy('createdAt', 'desc'),
              firestore.limit(20),
            ),
            (snapshot) => {
              const now = Date.now();
              setNowMs(now);
              setQueue((current) => {
                let next = current.filter((item) => item.expiresAtMs > now);
                for (const document of snapshot.docs) {
                  if (seenEventIdsRef.current.has(document.id)) continue;
                  const mapped = mapRoomEventDocument({
                    ...document.data(),
                    eventId: document.id,
                  }, now, {
                    blockedUids: blockedUidsRef.current,
                    enabledKinds: new Set<RoomEffectKind>(['room-gift']),
                    globalEvent: true,
                    viewerCountryCode: options.viewerCountryCode,
                    viewerRoomVisibility: options.viewerRoomVisibility,
                  });
                  if (!mapped || mapped.giftPresentationTier !== 'global') continue;
                  seenEventIdsRef.current.add(mapped.eventId);
                  next = enqueueRoomEffect(next, mapped, now);
                }
                return next;
              });
            },
            (error) => debugError('voice.effects', 'global-subscription:error', error, { roomId: options.roomId }),
          ),
        );
      }
      if (options.uid) {
        unsubscribers.push(
          firestore.onSnapshot(
            firestore.collection(firebaseDb, 'blocks', options.uid, 'blocked'),
            (snapshot) => {
              const blocked = new Set(snapshot.docs.map((document) => document.id));
              blockedUidsRef.current = blocked;
              setQueue((current) => current.filter((effect) => {
                const keep = !effect.senderUid || !blocked.has(effect.senderUid);
                if (!keep) logDropped(effect, 'blocked-sender');
                return keep;
              }));
            },
            (error) => debugError('voice.effects', 'blocks:error', error, { roomId: options.roomId }),
          ),
        );
      }
    })().catch((error) => {
      debugError('voice.effects', 'startup:error', error, { roomId: options.roomId });
    });
    return () => {
      cancelled = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [
    appActive,
    enabled,
    enabledKindsKey,
    options.entryEffectsEnabled,
    options.giftGlobalEffectsEnabled,
    options.giftsEnabled,
    options.rocketEnabled,
    options.roomId,
    options.uid,
    options.viewerCountryCode,
    options.viewerRoomVisibility,
  ]);

  useEffect(() => {
    if (!options.suspended) return;
    setQueue((current) => {
      current.forEach((effect) => logDropped(effect, 'room-suspended'));
      return [];
    });
  }, [options.suspended]);

  useEffect(() => {
    if (!queue.length) return undefined;
    const timer = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(timer);
  }, [queue.length]);

  const viewerMode = useMemo(
    () => resolveViewerEffectMode({
      appReducedMotion: reducedMotion || !appActive,
      lowMemory,
      roomEffectsPolicy: options.roomEffectsPolicy,
    }),
    [appActive, lowMemory, options.roomEffectsPolicy, reducedMotion],
  );

  const activeEffect = useMemo(
    () => options.suspended ? null : selectActiveRoomEffect(queue, viewerMode, nowMs),
    [nowMs, options.suspended, queue, viewerMode],
  );

  useEffect(() => {
    if (!activeEffect) return undefined;
    debugLog('voice.effects', 'played', {
      eventId: activeEffect.eventId,
      kind: activeEffect.kind,
      presentation: activeEffect.presentation,
      roomId: options.roomId,
    });
    recordCosmeticsRuntimeEvent('queue-wait', {
      elapsedMs: Date.now() - (activeEffect.queuedAtMs || Date.now()),
      reason: activeEffect.kind,
    });
    const remainingMs = Math.max(0, activeEffect.expiresAtMs - Date.now());
    const timeout = setTimeout(() => {
      setQueue((current) => removeRoomEffect(current, activeEffect.eventId));
      setNowMs(Date.now());
      debugLog('voice.effects', 'completed', {
        eventId: activeEffect.eventId,
        kind: activeEffect.kind,
        roomId: options.roomId,
      });
    }, Math.min(activeEffect.durationMs, remainingMs));
    return () => clearTimeout(timeout);
  }, [
    activeEffect?.durationMs,
    activeEffect?.eventId,
    activeEffect?.kind,
    activeEffect?.presentation,
    activeEffect?.expiresAtMs,
    options.roomId,
  ]);

  const enqueueLocalEffect = useCallback((effect: QueuedRoomEffect) => {
    if (!options.giftsEnabled || seenEventIdsRef.current.has(effect.eventId)) return;
    seenEventIdsRef.current.add(effect.eventId);
    setQueue((current) => enqueueRoomEffect(current, effect));
  }, [options.giftsEnabled]);

  const completeActiveEffect = useCallback((reason: 'completed' | 'renderer-error' = 'completed') => {
    setQueue((current) => {
      const active = selectActiveRoomEffect(current, viewerMode, Date.now());
      if (!active) return current;
      recordCosmeticsRuntimeEvent(
        reason === 'completed' ? 'completion' : 'failure',
        { reason: `${active.kind}:${reason}` },
      );
      return removeRoomEffect(current, active.eventId);
    });
    setNowMs(Date.now());
  }, [viewerMode]);

  return { activeEffect, completeActiveEffect, enqueueLocalEffect, viewerMode };
}

function logDropped(effect: QueuedRoomEffect, reason: string) {
  debugLog('voice.effects', 'dropped', {
    eventId: effect.eventId,
    kind: effect.kind,
    reason,
  });
  recordCosmeticsRuntimeEvent(
    reason === 'expired'
      ? 'queue-expiry'
      : reason === 'priority-cap' ? 'priority-drop' : 'cancellation',
    { reason: `${effect.kind}:${reason}` },
  );
}
