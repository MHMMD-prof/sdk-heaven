import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '../../components/GlassCard';
import { LuxuryButton } from '../../components/LuxuryButton';
import { LuxuryInput } from '../../components/LuxuryInput';
import { colors, spacing, typography } from '../../theme';
import { DrawingGuessActions, DrawingGuessViewModel } from '../controller/drawingGuessControllerTypes';
import { triggerDrawingGuessHaptic } from './drawingGuessHaptics';

type DrawingGuessLobbyPanelProps = {
  viewModel: DrawingGuessViewModel;
  actions: DrawingGuessActions;
};

export function DrawingGuessLobbyPanel({ actions, viewModel }: DrawingGuessLobbyPanelProps) {
  const [roomCodeInput, setRoomCodeInput] = useState(viewModel.roomCode);

  return (
    <GlassCard style={styles.card}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>{viewModel.isShowcaseMode ? 'Local party game' : viewModel.onlineStatusLabel}</Text>
        <Text style={styles.title}>{viewModel.isShowcaseMode ? 'Ready to draw?' : viewModel.roomCode}</Text>
        <Text style={styles.body}>{getLobbyBodyCopy(viewModel)}</Text>
        <View style={styles.readyPill}>
          <Text style={styles.readyText}>{viewModel.connectedPlayerCount} players ready</Text>
        </View>
      </View>

      <View style={styles.lineup}>
        {viewModel.players.map((player) => (
          <View key={player.id} style={[styles.playerRow, player.id === viewModel.localPlayerId && styles.localPlayerRow]}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{player.avatarLabel}</Text>
            </View>
            <View style={styles.playerCopy}>
              <Text style={styles.playerName}>
                {player.displayName}
                {player.id === viewModel.localPlayerId ? ' (you)' : ''}
              </Text>
              <Text style={styles.playerMeta}>
                {[player.isHost ? 'Host' : undefined, player.isConnected ? 'Ready' : 'Away']
                  .filter(Boolean)
                  .join(' / ')}
              </Text>
            </View>
            {player.isHost ? <Text style={styles.hostPill}>Host</Text> : null}
          </View>
        ))}
      </View>

      {viewModel.isShowcaseMode ? <Text style={styles.roomMeta}>Room {viewModel.roomCode}</Text> : null}

      {viewModel.showOnlineControls ? (
        <LuxuryInput
          autoCapitalize="characters"
          label="Room code"
          onChangeText={setRoomCodeInput}
          value={roomCodeInput}
        />
      ) : null}

      <View style={styles.actions}>
        <LuxuryButton
          accessibilityHint="Begin the local drawing match."
          onPress={() => {
            void triggerDrawingGuessHaptic(viewModel.canStart ? 'success' : 'warning');
            actions.startMatch();
          }}
          disabled={!viewModel.canStart}
          title="Start match"
        />
        {!viewModel.canStart && !viewModel.isShowcaseMode ? (
          <Text style={styles.disabledHelp}>Waiting for enough ready players.</Text>
        ) : null}
        <Pressable
          accessibilityHint="Reset this local game and return to setup."
          accessibilityLabel="New local match"
          accessibilityRole="button"
          onPress={() => {
            void triggerDrawingGuessHaptic('selection');
            actions.createLocalRoom();
          }}
          style={styles.secondaryAction}
        >
          <Text style={styles.secondaryActionText}>New local match</Text>
        </Pressable>
        {viewModel.showOnlineControls ? (
          <>
            <LuxuryButton onPress={() => actions.joinLocalRoom(roomCodeInput)} title="Join local room" />
            <LuxuryButton onPress={actions.createOnlineRoom} title="Create online room" />
            <LuxuryButton onPress={() => actions.joinOnlineRoom(roomCodeInput)} title="Join online room" />
          </>
        ) : null}
      </View>
    </GlassCard>
  );
}

function getLobbyBodyCopy(viewModel: DrawingGuessViewModel) {
  if (viewModel.lastTransportError) {
    return 'Fix the connection issue above, then create or join the room again.';
  }

  if (viewModel.isOnlineRoom && !viewModel.canStart) {
    return 'Waiting for at least two connected players before the host can start.';
  }

  if (viewModel.isOnlineRoom) {
    return 'Online room uses LiveKit data packets for preview strokes, committed strokes, guesses, and snapshots.';
  }

  return 'Draw the secret prompt, race the guesses, and climb the final scoreboard.';
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.lg,
    marginBottom: spacing.md,
  },
  hero: {
    backgroundColor: 'rgba(232,190,97,0.10)',
    borderColor: colors.borderGold,
    borderRadius: 18,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.lg,
  },
  eyebrow: {
    color: colors.gold,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
  },
  title: {
    color: colors.text,
    flexShrink: 1,
    fontSize: typography.sizes.headline,
    fontWeight: typography.weights.black,
    textAlign: 'right',
  },
  body: {
    color: colors.textMuted,
    flexShrink: 1,
    fontSize: typography.sizes.body,
    lineHeight: 22,
    textAlign: 'right',
  },
  readyPill: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(43,203,136,0.14)',
    borderColor: 'rgba(43,203,136,0.38)',
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: '100%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  readyText: {
    color: colors.emerald,
    flexShrink: 1,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
  },
  lineup: {
    gap: spacing.sm,
  },
  playerRow: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  localPlayerRow: {
    borderColor: colors.borderGold,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  avatarText: {
    color: colors.goldSoft,
    fontWeight: typography.weights.black,
  },
  playerCopy: {
    flex: 1,
    minWidth: 0,
  },
  playerName: {
    color: colors.text,
    flexShrink: 1,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
  },
  playerMeta: {
    color: colors.textSubtle,
    flexShrink: 1,
    fontSize: typography.sizes.caption,
    marginTop: 2,
    textAlign: 'right',
  },
  hostPill: {
    backgroundColor: 'rgba(232,190,97,0.14)',
    borderColor: colors.borderGold,
    borderRadius: 999,
    borderWidth: 1,
    color: colors.gold,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
    maxWidth: 86,
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  roomMeta: {
    color: colors.textSubtle,
    fontSize: typography.sizes.caption,
    textAlign: 'center',
  },
  actions: {
    gap: spacing.sm,
  },
  secondaryAction: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 48,
    justifyContent: 'center',
  },
  secondaryActionText: {
    color: colors.text,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
  },
  disabledHelp: {
    color: colors.textSubtle,
    fontSize: typography.sizes.caption,
    textAlign: 'center',
  },
});
