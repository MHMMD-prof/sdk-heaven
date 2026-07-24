import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../../theme';
import { RepresentativeBadge } from '../RepresentativeBadge';
import { RoomSeatViewModel } from '../../voice/roomMainScreenModel';

type VoiceRoomStageProps = {
  modeLabel: string;
  onSeatPress: (seat: RoomSeatViewModel) => void;
  pendingSeatId?: string;
  seats: RoomSeatViewModel[];
};

export function VoiceRoomStage({ modeLabel, onSeatPress, pendingSeatId, seats }: VoiceRoomStageProps) {
  return (
    <View style={styles.root}>
      <View style={styles.heading}>
        <View style={styles.modePill}>
          <View style={styles.liveDot} />
          <Text style={styles.modeLabel}>{modeLabel}</Text>
        </View>
        <Text style={styles.headingTitle}>منصة الميكروفونات</Text>
      </View>
      <View style={styles.grid}>
        {seats.map((seat) => (
          <Seat
            key={seat.id}
            onPress={() => onSeatPress(seat)}
            pending={pendingSeatId === seat.id}
            seat={seat}
          />
        ))}
      </View>
    </View>
  );
}

function Seat({
  onPress,
  pending,
  seat,
}: {
  onPress: () => void;
  pending: boolean;
  seat: RoomSeatViewModel;
}) {
  const canPress = seat.action !== null && !pending;
  const isOccupied = !!seat.participant;
  const muted = seat.participant?.isMuted;

  return (
    <Pressable
      accessibilityLabel={seat.accessibilityLabel}
      accessibilityRole={canPress ? 'button' : 'text'}
      accessibilityState={{ disabled: !canPress, busy: pending }}
      disabled={!canPress}
      onPress={onPress}
      style={styles.seatCell}
    >
      <LinearGradient
        colors={
          seat.isSpeaking
            ? ['#F7DC91', '#3DD89A', '#0B4D3A']
            : isOccupied
              ? ['#F1D17A', '#8B5B22', '#20120A']
              : ['rgba(246,217,145,0.58)', 'rgba(69,44,20,0.36)', 'rgba(5,4,9,0.96)']
        }
        style={[
          styles.avatarFrame,
          seat.state === 'locked' && styles.lockedFrame,
          seat.state === 'reconnecting' && styles.reconnectingFrame,
          seat.state === 'retiring' && styles.retiringFrame,
        ]}
      >
        <View style={[styles.avatarInner, seat.isSpeaking && styles.speakingInner]}>
          {seat.participant ? (
            <Text style={styles.avatarText}>{seat.participant.avatarLabel}</Text>
          ) : (
            <SymbolView
              name={
                seat.state === 'locked'
                  ? { ios: 'lock.fill', android: 'lock', web: 'lock' }
                  : seat.state === 'reconnecting'
                    ? { ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }
                    : { ios: 'plus', android: 'add', web: 'add' }
              }
              size={seat.state === 'locked' ? 17 : 21}
              tintColor={seat.state === 'locked' ? colors.textSubtle : colors.goldSoft}
            />
          )}
        </View>
        {muted ? (
          <View style={styles.muteBadge}>
            <SymbolView
              name={{ ios: 'mic.slash.fill', android: 'mic_off', web: 'mic_off' }}
              size={10}
              tintColor="#FFFFFF"
            />
          </View>
        ) : null}
        {seat.isOwner || seat.isModerator ? (
          <View style={[styles.roleBadge, seat.isModerator && styles.moderatorBadge]}>
            <SymbolView
              name={
                seat.isOwner
                  ? { ios: 'crown.fill', android: 'workspace_premium', web: 'workspace_premium' }
                  : { ios: 'shield.fill', android: 'shield', web: 'shield' }
              }
              size={9}
              tintColor={seat.isOwner ? '#2A1604' : '#FFFFFF'}
            />
          </View>
        ) : null}
        <RepresentativeBadge
          active={seat.participant?.representativeBadgeActive}
          style={styles.representativeBadge}
        />
      </LinearGradient>
      <Text numberOfLines={1} style={[styles.name, seat.isSpeaking && styles.speakingName]}>
        {seat.participant?.displayName || (pending ? 'جارٍ التنفيذ…' : `مقعد ${seat.seatNumber}`)}
      </Text>
      <Text style={styles.seatNumber}>#{seat.seatNumber}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flexShrink: 1,
    paddingTop: spacing.sm,
  },
  heading: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  headingTitle: {
    color: colors.text,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
    writingDirection: 'rtl',
  },
  modePill: {
    alignItems: 'center',
    backgroundColor: 'rgba(3,2,7,0.64)',
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  liveDot: {
    backgroundColor: colors.emerald,
    borderRadius: radius.full,
    height: 6,
    width: 6,
  },
  modeLabel: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: typography.weights.bold,
    writingDirection: 'rtl',
  },
  grid: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
  },
  seatCell: {
    alignItems: 'center',
    marginBottom: 6,
    minHeight: 68,
    width: '20%',
  },
  avatarFrame: {
    alignItems: 'center',
    borderRadius: radius.full,
    height: 48,
    justifyContent: 'center',
    padding: 2,
    width: 48,
  },
  avatarInner: {
    alignItems: 'center',
    backgroundColor: '#120B19',
    borderRadius: radius.full,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  speakingInner: {
    backgroundColor: '#09261E',
  },
  lockedFrame: {
    opacity: 0.56,
  },
  reconnectingFrame: {
    borderColor: colors.goldSoft,
    borderStyle: 'dashed',
    borderWidth: 1,
  },
  retiringFrame: {
    opacity: 0.72,
  },
  avatarText: {
    color: colors.goldSoft,
    fontSize: 17,
    fontWeight: typography.weights.black,
  },
  roleBadge: {
    alignItems: 'center',
    backgroundColor: colors.gold,
    borderColor: '#2A1604',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 17,
    justifyContent: 'center',
    left: -2,
    position: 'absolute',
    top: -3,
    width: 17,
  },
  moderatorBadge: {
    backgroundColor: colors.purpleBright,
    borderColor: '#C9B0FF',
  },
  muteBadge: {
    alignItems: 'center',
    backgroundColor: colors.ruby,
    borderColor: '#FFFFFF',
    borderRadius: radius.full,
    borderWidth: 1,
    bottom: -2,
    height: 17,
    justifyContent: 'center',
    position: 'absolute',
    right: -2,
    width: 17,
  },
  representativeBadge: {
    bottom: -2,
    left: -2,
    position: 'absolute',
  },
  name: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: typography.weights.bold,
    marginTop: 3,
    maxWidth: '92%',
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  speakingName: {
    color: colors.emerald,
  },
  seatNumber: {
    color: colors.textSubtle,
    fontSize: 8,
    marginTop: -1,
    writingDirection: 'ltr',
  },
});
