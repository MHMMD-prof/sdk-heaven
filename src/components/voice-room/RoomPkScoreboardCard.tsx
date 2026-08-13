import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { RoomPkSession, RoomPkTeam } from '../../voice/requestRoomPkCommand';
import { colors, radius, spacing, typography } from '../../theme';

type RoomPkScoreboardCardProps = {
  canManage: boolean;
  compact?: boolean;
  isBusy?: boolean;
  onEnd?: () => void;
  onJoinTeam?: (team: RoomPkTeam) => void;
  session: RoomPkSession;
  uid?: string;
};

export function RoomPkScoreboardCard({
  canManage,
  compact = false,
  isBusy = false,
  onEnd,
  onJoinTeam,
  session,
  uid,
}: RoomPkScoreboardCardProps) {
  const remainingMs = Math.max(0, session.endsAtMs - Date.now());
  const remainingSec = Math.ceil(remainingMs / 1000);
  const myTeam = uid
    ? (session.teams.red.memberUids.includes(uid)
      ? 'red'
      : session.teams.blue.memberUids.includes(uid)
        ? 'blue'
        : null)
    : null;
  const ended = session.status !== 'active' && session.status !== 'lobby';
  const winnerLabel = session.winner === 'red'
    ? 'فوز الأحمر'
    : session.winner === 'blue'
      ? 'فوز الأزرق'
      : session.winner === 'draw'
        ? 'تعادل'
        : session.winner === 'void'
          ? 'ملغاة'
          : null;

  if (compact) {
    return (
      <View accessibilityLabel={`تحدي الهدايا، ${session.teams.red.score} مقابل ${session.teams.blue.score}`} style={[styles.card, styles.compactCard]}>
        <View style={styles.compactHeading}>
          <Text numberOfLines={1} style={styles.compactKicker}>تحدي الهدايا</Text>
          <Text style={styles.timer}>{ended ? (winnerLabel || 'انتهى') : `${remainingSec}ث`}</Text>
        </View>
        <View style={[styles.scores, styles.compactScores]}>
          <Text style={[styles.compactScore, styles.redScore]}>{session.teams.red.score.toLocaleString('ar-IQ')}</Text>
          <Text style={styles.vs}>VS</Text>
          <Text style={[styles.compactScore, styles.blueScore]}>{session.teams.blue.score.toLocaleString('ar-IQ')}</Text>
        </View>
        {!ended && !myTeam && onJoinTeam ? (
          <View style={[styles.actions, styles.compactActions]}>
            <Pressable accessibilityLabel="انضم للفريق الأحمر" disabled={isBusy} onPress={() => onJoinTeam('red')} style={[styles.compactAction, styles.redAction]}>
              <Text style={styles.compactActionText}>أحمر</Text>
            </Pressable>
            <Pressable accessibilityLabel="انضم للفريق الأزرق" disabled={isBusy} onPress={() => onJoinTeam('blue')} style={[styles.compactAction, styles.blueAction]}>
              <Text style={styles.compactActionText}>أزرق</Text>
            </Pressable>
          </View>
        ) : !ended && canManage && onEnd ? (
          <Pressable accessibilityLabel="إنهاء التحدي" disabled={isBusy} onPress={onEnd} style={styles.compactEndButton}>
            <Text style={styles.compactEndText}>إنهاء</Text>
          </Pressable>
        ) : (
          <Text numberOfLines={1} style={styles.compactJoined}>{ended ? (winnerLabel || 'انتهى') : 'تم الانضمام'}</Text>
        )}
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.kicker}>تحدي الهدايا</Text>
        <Text style={styles.timer}>
          {ended ? (winnerLabel || 'انتهى') : `${remainingSec}ث`}
        </Text>
      </View>
      <View style={styles.scores}>
        <View style={[styles.team, styles.red]}>
          <Text style={styles.teamLabel}>{session.teams.red.labelAr}</Text>
          <Text style={styles.score}>{session.teams.red.score.toLocaleString('ar-IQ')}</Text>
        </View>
        <Text style={styles.vs}>VS</Text>
        <View style={[styles.team, styles.blue]}>
          <Text style={styles.teamLabel}>{session.teams.blue.labelAr}</Text>
          <Text style={styles.score}>{session.teams.blue.score.toLocaleString('ar-IQ')}</Text>
        </View>
      </View>
      {!ended && !myTeam && onJoinTeam ? (
        <View style={styles.actions}>
          <Pressable disabled={isBusy} onPress={() => onJoinTeam('red')} style={[styles.action, styles.redAction]}>
            <Text style={styles.actionText}>انضم للأحمر</Text>
          </Pressable>
          <Pressable disabled={isBusy} onPress={() => onJoinTeam('blue')} style={[styles.action, styles.blueAction]}>
            <Text style={styles.actionText}>انضم للأزرق</Text>
          </Pressable>
        </View>
      ) : null}
      {!ended && myTeam ? (
        <Text style={styles.joined}>أنت في فريق {myTeam === 'red' ? 'الأحمر' : 'الأزرق'}</Text>
      ) : null}
      {!ended && canManage && onEnd ? (
        <Pressable disabled={isBusy} onPress={onEnd} style={styles.endButton}>
          <Text style={styles.endText}>إنهاء التحدي</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(12,6,8,0.92)',
    borderColor: 'rgba(241,205,121,0.35)',
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    minWidth: 220,
    padding: spacing.md,
  },
  compactCard: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: 8,
    height: 60,
    minWidth: 0,
    paddingHorizontal: 10,
    paddingVertical: 6,
    width: '100%',
  },
  compactHeading: { alignItems: 'flex-end', flex: 1, minWidth: 0 },
  compactKicker: { color: colors.goldSoft, fontSize: 10, fontWeight: typography.weights.black, textAlign: 'right' },
  compactScores: { flex: 1.25, gap: 5 },
  compactScore: { borderRadius: radius.full, color: colors.text, fontSize: 12, fontWeight: typography.weights.black, minWidth: 42, paddingHorizontal: 7, paddingVertical: 5, textAlign: 'center' },
  redScore: { backgroundColor: 'rgba(140,30,40,0.62)' },
  blueScore: { backgroundColor: 'rgba(30,60,120,0.62)' },
  compactActions: { flex: 1, gap: 4, marginTop: 0 },
  compactAction: { borderRadius: radius.full, flex: 1, paddingHorizontal: 6, paddingVertical: 6 },
  compactActionText: { color: '#FFF', fontSize: 9, fontWeight: typography.weights.black, textAlign: 'center' },
  compactEndButton: { borderColor: 'rgba(238,140,148,0.5)', borderRadius: radius.full, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  compactEndText: { color: '#EE8C94', fontSize: 9, fontWeight: typography.weights.bold },
  compactJoined: { color: '#C9B08A', fontSize: 9, maxWidth: 62 },
  header: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
  },
  kicker: {
    color: colors.goldSoft,
    fontSize: 12,
    fontWeight: typography.weights.bold,
  },
  timer: {
    color: '#F7D67C',
    fontSize: 13,
    fontWeight: typography.weights.black,
  },
  scores: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: 8,
    justifyContent: 'space-between',
  },
  team: {
    alignItems: 'center',
    borderRadius: radius.md,
    flex: 1,
    paddingVertical: 8,
  },
  red: { backgroundColor: 'rgba(140,30,40,0.55)' },
  blue: { backgroundColor: 'rgba(30,60,120,0.55)' },
  teamLabel: {
    color: '#E8D5B5',
    fontSize: 11,
  },
  score: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: typography.weights.black,
    marginTop: 2,
  },
  vs: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: typography.weights.bold,
  },
  actions: {
    flexDirection: 'row-reverse',
    gap: 8,
  },
  action: {
    borderRadius: radius.full,
    flex: 1,
    paddingVertical: 8,
  },
  redAction: { backgroundColor: '#8C1E28' },
  blueAction: { backgroundColor: '#1E3C78' },
  actionText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: typography.weights.bold,
    textAlign: 'center',
  },
  joined: {
    color: '#C9B08A',
    fontSize: 11,
    textAlign: 'center',
  },
  endButton: {
    alignSelf: 'center',
    borderColor: 'rgba(238,140,148,0.5)',
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  endText: {
    color: '#EE8C94',
    fontSize: 12,
    fontWeight: typography.weights.bold,
  },
});
