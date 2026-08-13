import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';

import { usePublishedCosmeticAsset } from '../../cosmetics/assetRegistry';
import { CosmeticAssetRenderer } from '../../cosmetics/CosmeticAssetRenderer';
import type { CosmeticViewerMode } from '../../cosmetics/contracts';
import type { CosmeticsFeatureFlags } from '../../cosmetics/featureFlags';
import { recordCosmeticsRuntimeEvent } from '../../cosmetics/runtimeTelemetry';
import {
  aggregateAmbientReaction,
  type AmbientReactionGroup,
  type RoomReactionEnvelope,
} from '../../voice/roomAmbientReactions';

export function RoomAmbientReactions({
  enabled,
  flags,
  latest,
  roomId,
  suppressed,
  viewerMode,
}: {
  enabled: boolean;
  flags: CosmeticsFeatureFlags;
  latest?: RoomReactionEnvelope;
  roomId: string;
  suppressed: boolean;
  viewerMode: CosmeticViewerMode;
}) {
  const [groups, setGroups] = useState<AmbientReactionGroup[]>([]);
  const consumedEventIds = useRef(new Set<string>());

  useEffect(() => {
    if (!latest || latest.roomId !== roomId) return;
    if (consumedEventIds.current.has(latest.eventId)) return;
    consumedEventIds.current.add(latest.eventId);
    while (consumedEventIds.current.size > 64) {
      consumedEventIds.current.delete(consumedEventIds.current.values().next().value as string);
    }
    if (latest.expiresAtMs <= Date.now()) {
      recordCosmeticsRuntimeEvent('reaction-drop', { reason: 'expired' });
      return;
    }
    if (!enabled || suppressed || viewerMode === 'off') {
      recordCosmeticsRuntimeEvent('reaction-drop', { reason: !enabled ? 'flag-disabled' : suppressed ? 'suppressed' : 'viewer-off' });
      return;
    }
    recordCosmeticsRuntimeEvent('reaction-aggregate', {
      descriptor: {
        assetId: latest.assetId,
        assetVersionId: latest.assetVersionId,
        category: 'room-reaction',
        format: latest.format,
      },
    });
    setGroups((current) => aggregateAmbientReaction(current, latest));
  }, [enabled, latest, roomId, suppressed, viewerMode]);

  useEffect(() => {
    consumedEventIds.current.clear();
    setGroups([]);
  }, [roomId]);

  useEffect(() => {
    if (!enabled || suppressed || viewerMode === 'off') {
      setGroups([]);
      return undefined;
    }
    const interval = setInterval(() => {
      const nowMs = Date.now();
      setGroups((current) => current.filter((group) => group.expiresAtMs > nowMs));
    }, 500);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') setGroups([]);
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [enabled, suppressed, viewerMode]);

  if (!enabled || suppressed || viewerMode === 'off' || groups.length === 0) return null;
  return (
    <View pointerEvents="none" style={styles.overlay}>
      {groups.map((group, index) => (
        <ReactionGroup
          flags={flags}
          group={group}
          index={index}
          key={`${group.eventId}:${group.receivedAtMs}`}
          viewerMode={viewerMode}
        />
      ))}
    </View>
  );
}

function ReactionGroup({
  flags,
  group,
  index,
  viewerMode,
}: {
  flags: CosmeticsFeatureFlags;
  group: AmbientReactionGroup;
  index: number;
  viewerMode: CosmeticViewerMode;
}) {
  const bundle = usePublishedCosmeticAsset(group.assetId, group.assetVersionId, true);
  if (!bundle || bundle.primary.category !== 'room-reaction' || bundle.primary.sha256 !== group.checksum) {
    return null;
  }
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.group, { bottom: 84 + (index % 2) * 52, right: 18 + index * 54 }]}
    >
      <CosmeticAssetRenderer
        descriptor={bundle.primary}
        fallbackDescriptor={bundle.fallback}
        flags={flags}
        muted
        style={styles.artwork}
        viewerMode={viewerMode}
      />
      {group.count > 1 ? <Text style={styles.count}>×{group.count}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  artwork: {
    height: 64,
    width: 64,
  },
  count: {
    backgroundColor: 'rgba(8,4,5,0.82)',
    borderRadius: 10,
    bottom: -2,
    color: '#FFF4DE',
    fontSize: 12,
    fontWeight: '800',
    paddingHorizontal: 6,
    paddingVertical: 2,
    position: 'absolute',
    right: -4,
  },
  group: {
    height: 68,
    position: 'absolute',
    width: 68,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 40,
  },
});
