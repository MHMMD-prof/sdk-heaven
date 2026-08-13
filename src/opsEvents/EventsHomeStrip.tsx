import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { useGrowthFeatureFlags } from '../growth/featureFlags';
import { requestClaimOpsMission, requestOpsMissions } from '../social/requestSocialCommand';
import type { OpsMissionsOverview } from '../social/types';
import { colors, radius, spacing, typography } from '../theme';

export function EventsHomeStrip({ uid }: { uid?: string }) {
  const growthFlags = useGrowthFeatureFlags();
  const enabled = growthFlags.dailyMissions || growthFlags.opsEvents;
  const [overview, setOverview] = useState<OpsMissionsOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyMissionId, setBusyMissionId] = useState('');

  const load = useCallback(async () => {
    if (!enabled || !uid) {
      setOverview(null);
      return;
    }
    setLoading(true);
    const response = await requestOpsMissions();
    if (response.ok) setOverview(response.result);
    else setOverview(null);
    setLoading(false);
  }, [enabled, uid]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!enabled || !uid) return null;

  const claim = async (missionId: string) => {
    setBusyMissionId(missionId);
    const response = await requestClaimOpsMission(missionId);
    setBusyMissionId('');
    if (!response.ok) {
      Alert.alert('تعذر الاستلام', response.error.messageAr);
      return;
    }
    Alert.alert('تم', `حصلت على ${response.result.amount} عملة`);
    await load();
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.kicker}>الفعاليات والمهام</Text>
      {overview?.event ? (
        <View style={styles.eventCard}>
          <Text style={styles.eventTitle}>{overview.event.titleAr}</Text>
          {overview.event.themeAr ? (
            <Text style={styles.eventTheme}>{overview.event.themeAr}</Text>
          ) : null}
        </View>
      ) : (
        <Text style={styles.muted}>لا توجد فعالية منشورة حالياً — المهام اليومية ما زالت متاحة.</Text>
      )}

      {loading ? <ActivityIndicator color={colors.gold} /> : null}

      {(overview?.missions || []).map((mission) => (
        <View key={mission.missionId} style={styles.missionRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.missionTitle}>{mission.titleAr}</Text>
            <Text style={styles.muted}>
              {mission.progress}/{mission.target}
              {mission.claimed ? ' · تم الاستلام' : mission.claimable ? ' · جاهز للاستلام' : ''}
            </Text>
          </View>
          {mission.claimable ? (
            <Pressable
              disabled={busyMissionId === mission.missionId}
              onPress={() => void claim(mission.missionId)}
              style={styles.claimButton}
            >
              <Text style={styles.claimText}>+{mission.rewardCoins}</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  claimButton: {
    backgroundColor: colors.gold,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  claimText: {
    color: '#2A090C',
    fontWeight: typography.weights.black,
  },
  eventCard: {
    backgroundColor: 'rgba(232,190,97,0.12)',
    borderColor: 'rgba(232,190,97,0.35)',
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: 4,
    padding: spacing.md,
  },
  eventTheme: {
    color: colors.textMuted,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  eventTitle: {
    color: colors.goldSoft,
    fontSize: 16,
    fontWeight: typography.weights.black,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  kicker: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  missionRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  missionTitle: {
    color: colors.text,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  muted: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  wrap: {
    gap: spacing.sm,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.lg,
  },
});
