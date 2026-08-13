import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, AppState } from 'react-native';

import { debugError, debugLog } from '../utils/debugLog';
import {
  recordBottomEffectStageRuntimeEvent,
  recordCosmeticsRuntimeEvent,
} from '../cosmetics/runtimeTelemetry';
import { resolveBottomEffectCompletionDelay } from './bottomEffectStage';
import {
  areRoomEntryParticipantsPresent,
  resolveRoomEntryPlaybackDropReason,
} from './roomEntryPlayback';
import {
  QueuedRoomEffect,
  ROCKET_EFFECT_DELIVERY_GRACE_MS,
  RoomEffectKind,
  completeRoomEffectIfActive,
  enqueueRoomEffectWithOutcome,
  mapRoomEventDocument,
  removeRoomEffect,
  resolveViewerEffectMode,
  selectActiveRoomEffect,
} from './roomEffectsQueue';

export function useRoomEffectsQueue(options: {
  bottomEffectStageEnabled?: boolean;
  coupleEntrancesEnabled?: boolean;
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
  const coalescedPairEventIdsRef = useRef(new Set<string>());
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
          current.forEach((effect) => logDropped(effect, 'app-background', options.bottomEffectStageEnabled));
          return [];
        });
      }
    });
    const memorySubscription = AppState.addEventListener('memoryWarning', () => {
      setLowMemory(true);
      setQueue((current) => {
        current.forEach((effect) => logDropped(effect, 'memory-warning', options.bottomEffectStageEnabled));
        return [];
      });
    });
    return () => {
      appStateSubscription.remove();
      memorySubscription.remove();
    };
  }, [options.bottomEffectStageEnabled]);

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
    setQueue((current) => current.filter((effect) => (
      allowedKinds.has(effect.kind)
      && (!effect.coupleEntrance || options.coupleEntrancesEnabled === true)
    )));
  }, [
    enabledKindsKey,
    options.coupleEntrancesEnabled,
    options.entryEffectsEnabled,
    options.giftsEnabled,
    options.rocketEnabled,
  ]);

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
                if (!keep) logDropped(item, 'expired', options.bottomEffectStageEnabled);
                return keep;
              });
              for (const document of snapshot.docs) {
                if (seenEventIdsRef.current.has(document.id)) {
                  if (
                    !coalescedPairEventIdsRef.current.has(document.id)
                    && current.some((effect) => effect.eventId === document.id && effect.coupleEntrance)
                  ) {
                    coalescedPairEventIdsRef.current.add(document.id);
                    recordCosmeticsRuntimeEvent('pair-entrance-coalesced');
                  }
                  continue;
                }
                const mapped = mapRoomEventDocument({
                  ...document.data(),
                  eventId: document.id,
                }, now, {
                  blockedUids: blockedUidsRef.current,
                  coupleEntrancesEnabled: options.coupleEntrancesEnabled,
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
                  logDropped(mapped, 'joined-after-event', options.bottomEffectStageEnabled);
                  continue;
                }
                const entryDropReason = resolveRoomEntryPlaybackDropReason(mapped, {
                  enteredRoomAtMs: enteredRoomAtRef.current,
                  presentUids: presentUidsRef.current,
                  seenEventIds: seenEventIdsRef.current,
                });
                if (entryDropReason) {
                  logDropped(mapped, entryDropReason, options.bottomEffectStageEnabled);
                  seenEventIdsRef.current.add(mapped.eventId);
                  continue;
                }
                seenEventIdsRef.current.add(mapped.eventId);
                const outcome = enqueueRoomEffectWithOutcome(next, mapped, now);
                next = outcome.queue;
                logEnqueueOutcome(outcome, mapped, options.bottomEffectStageEnabled);
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
              const keep = effect.kind !== 'room-entry'
                || areRoomEntryParticipantsPresent(effect, present);
              if (!keep) logDropped(effect, 'participant-left', options.bottomEffectStageEnabled);
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
                let next = current.filter((item) => {
                  const keep = item.expiresAtMs > now;
                  if (!keep) logDropped(item, 'expired', options.bottomEffectStageEnabled);
                  return keep;
                });
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
                  const outcome = enqueueRoomEffectWithOutcome(next, mapped, now);
                  next = outcome.queue;
                  logEnqueueOutcome(outcome, mapped, options.bottomEffectStageEnabled);
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
                const keep = effect.participantUids
                  ? effect.participantUids.every((uid) => !blocked.has(uid))
                  : !effect.senderUid || !blocked.has(effect.senderUid);
                if (!keep) logDropped(effect, 'blocked-sender', options.bottomEffectStageEnabled);
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
    options.coupleEntrancesEnabled,
    options.bottomEffectStageEnabled,
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
      current.forEach((effect) => logDropped(effect, 'room-suspended', options.bottomEffectStageEnabled));
      return [];
    });
  }, [options.bottomEffectStageEnabled, options.suspended]);

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
    const timeoutMs = resolveBottomEffectCompletionDelay({
      durationMs: activeEffect.durationMs,
      expiresAtMs: activeEffect.expiresAtMs,
      nowMs: Date.now(),
    });
    const timeout = setTimeout(() => {
      if (options.bottomEffectStageEnabled && isBottomStageEffect(activeEffect)) {
        recordBottomEffectStageRuntimeEvent('bottom-stage-completion', {
          kind: activeEffect.kind === 'room-gift' ? 'gift' : 'entry',
          reason: 'completed',
        });
      }
      setQueue((current) => removeRoomEffect(current, activeEffect.eventId));
      setNowMs(Date.now());
      debugLog('voice.effects', 'completed', {
        eventId: activeEffect.eventId,
        kind: activeEffect.kind,
        roomId: options.roomId,
      });
    }, timeoutMs);
    return () => clearTimeout(timeout);
  }, [
    activeEffect?.durationMs,
    activeEffect?.eventId,
    activeEffect?.kind,
    activeEffect?.presentation,
    activeEffect?.expiresAtMs,
    options.roomId,
    options.bottomEffectStageEnabled,
  ]);

  const enqueueLocalEffect = useCallback((effect: QueuedRoomEffect) => {
    if (!options.giftsEnabled || seenEventIdsRef.current.has(effect.eventId)) return;
    seenEventIdsRef.current.add(effect.eventId);
    setQueue((current) => {
      const outcome = enqueueRoomEffectWithOutcome(current, effect);
      logEnqueueOutcome(outcome, effect, options.bottomEffectStageEnabled);
      return outcome.queue;
    });
  }, [options.bottomEffectStageEnabled, options.giftsEnabled]);

  const completeActiveEffect = useCallback((
    eventId: string,
    reason: 'completed' | 'renderer-error' = 'completed',
  ) => {
    setQueue((current) => {
      const active = selectActiveRoomEffect(current, viewerMode, Date.now());
      if (!active || active.eventId !== eventId) return current;
      recordCosmeticsRuntimeEvent(
        reason === 'completed' ? 'completion' : 'failure',
        { reason: `${active.kind}:${reason}` },
      );
      if (options.bottomEffectStageEnabled && isBottomStageEffect(active)) {
        recordBottomEffectStageRuntimeEvent(
          reason === 'completed' ? 'bottom-stage-completion' : 'bottom-stage-decode-error',
          {
            kind: active.kind === 'room-gift' ? 'gift' : 'entry',
            reason: reason === 'completed' ? 'completed' : 'renderer-error',
          },
        );
      }
      return completeRoomEffectIfActive(current, eventId, viewerMode, Date.now());
    });
    setNowMs(Date.now());
  }, [options.bottomEffectStageEnabled, viewerMode]);

  return { activeEffect, completeActiveEffect, enqueueLocalEffect, viewerMode };
}

function logDropped(
  effect: QueuedRoomEffect,
  reason: string,
  bottomEffectStageEnabled = false,
) {
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
  if (bottomEffectStageEnabled && isBottomStageEffect(effect)) {
    const kind = effect.kind === 'room-gift' ? 'gift' : 'entry';
    recordBottomEffectStageRuntimeEvent('bottom-stage-queue-drop', { kind, reason });
    if (['app-background', 'memory-warning', 'participant-left', 'room-suspended'].includes(reason)) {
      recordBottomEffectStageRuntimeEvent('bottom-stage-cancellation', { kind, reason });
    }
  }
}

function logEnqueueOutcome(
  outcome: ReturnType<typeof enqueueRoomEffectWithOutcome>,
  effect: QueuedRoomEffect,
  bottomEffectStageEnabled = false,
) {
  outcome.dropped.forEach((item) => {
    logDropped(item.effect, item.reason, bottomEffectStageEnabled);
  });
  if (!outcome.comboUpdate) return;
  recordCosmeticsRuntimeEvent('combo-update', { reason: effect.kind });
  if (bottomEffectStageEnabled && isBottomStageEffect(effect)) {
    recordBottomEffectStageRuntimeEvent('bottom-stage-combo-update', { kind: 'gift' });
  }
}

function isBottomStageEffect(effect: QueuedRoomEffect) {
  return effect.kind === 'room-entry'
    || (effect.kind === 'room-gift'
      && (effect.giftPresentationTier === 'major' || effect.giftPresentationTier === 'global'));
}
