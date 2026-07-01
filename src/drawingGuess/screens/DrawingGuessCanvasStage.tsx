import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '../../components/GlassCard';
import { LuxuryButton } from '../../components/LuxuryButton';
import { colors, radius, spacing, typography } from '../../theme';
import { DrawingGuessActions, DrawingGuessViewModel } from '../controller/drawingGuessControllerTypes';
import { DrawingCanvas } from '../rendering/DrawingCanvas';

type DrawingGuessCanvasStageProps = {
  viewModel: DrawingGuessViewModel;
  actions: DrawingGuessActions;
};

export function DrawingGuessCanvasStage({ actions, viewModel }: DrawingGuessCanvasStageProps) {
  const drawerName =
    viewModel.players.find((player) => player.isDrawer)?.displayName ?? 'Drawer';
  const timerUrgencyStyle =
    viewModel.timerUrgency === 'danger'
      ? styles.timerDanger
      : viewModel.timerUrgency === 'warning'
        ? styles.timerWarning
        : undefined;
  const progressUrgencyStyle =
    viewModel.timerUrgency === 'danger'
      ? styles.progressDanger
      : viewModel.timerUrgency === 'warning'
        ? styles.progressWarning
        : undefined;

  return (
    <GlassCard style={styles.card}>
      <View style={styles.statusBar}>
        <View style={[styles.badge, styles.timerBadge]}>
          <Text style={styles.badgeLabel}>Time</Text>
          <Text style={[styles.timer, timerUrgencyStyle]}>{viewModel.timerLabel}</Text>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                progressUrgencyStyle,
                { width: `${Math.round(viewModel.roundProgress * 100)}%` },
              ]}
            />
          </View>
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeLabel}>{viewModel.isDrawer ? 'Your prompt' : 'Drawer'}</Text>
          <Text style={styles.badgeValue}>
            {viewModel.isDrawer ? viewModel.promptTextForDrawer ?? '' : drawerName}
          </Text>
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeLabel}>Round</Text>
          <Text style={styles.badgeValue}>
            {viewModel.isDrawer ? 'Draw it' : 'Guess it'}
          </Text>
        </View>
      </View>

      {viewModel.localRoundStatusLabel ? (
        <View style={styles.statusNotice}>
          <Text style={styles.statusNoticeText}>{viewModel.localRoundStatusLabel}</Text>
        </View>
      ) : null}

      <View style={styles.paperFrame}>
        <View style={styles.paperHeader}>
          <Text style={styles.paperTitle}>
            {viewModel.isDrawer ? 'Sketch board' : 'Guess the drawing'}
          </Text>
          <View style={styles.currentToolPill}>
            <View
              style={[
                styles.currentToolDot,
                {
                  backgroundColor:
                    viewModel.selectedTool === 'eraser' ? '#F7F2E8' : viewModel.brushColor,
                  width: Math.max(12, viewModel.brushWidth + 8),
                  height: Math.max(12, viewModel.brushWidth + 8),
                },
              ]}
            />
            <Text style={styles.currentToolText}>
              {viewModel.selectedTool === 'eraser' ? 'Eraser' : 'Brush'}
            </Text>
          </View>
        </View>
        <View style={styles.canvas}>
          <DrawingCanvas
            authorId={viewModel.localPlayerId}
            brushColor={viewModel.brushColor}
            brushWidth={viewModel.brushWidth}
            canvasRevision={viewModel.canvasRevision}
            canDraw={viewModel.canDraw}
            eraserWidth={viewModel.eraserWidth}
            onCancelStroke={actions.cancelActiveStroke}
            onCommitStrokePoints={actions.commitStrokePoints}
            onPreviewStrokePoints={actions.previewStrokePoints}
            previewStrokes={viewModel.previewStrokes}
            selectedTool={viewModel.selectedTool}
            strokes={viewModel.strokes}
          />
        </View>
      </View>

      {viewModel.canDraw ? (
        <View style={styles.toolbar}>
          <View style={styles.toolRow}>
            <Pressable
              accessibilityRole="button"
              onPress={() => actions.setTool('brush')}
              style={[
                styles.toolButton,
                viewModel.selectedTool === 'brush' && styles.activeToolButton,
              ]}
            >
              <View style={[styles.toolIcon, { backgroundColor: viewModel.brushColor }]} />
              <Text style={styles.toolText}>Brush</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => actions.setTool('eraser')}
              style={[
                styles.toolButton,
                viewModel.selectedTool === 'eraser' && styles.activeToolButton,
              ]}
            >
              <View style={[styles.toolIcon, styles.eraserIcon]} />
              <Text style={styles.toolText}>Eraser</Text>
            </Pressable>
          </View>
          <View style={styles.swatchRow}>
            {viewModel.availableBrushColors.map((brushColor) => (
              <Pressable
                accessibilityRole="button"
                key={brushColor}
                onPress={() => actions.setBrushColor(brushColor)}
                style={[
                  styles.swatch,
                  { backgroundColor: brushColor },
                  brushColor === '#FFFFFF' && styles.lightSwatch,
                  viewModel.brushColor === brushColor && styles.activeSwatch,
                ]}
              />
            ))}
          </View>
          <View style={styles.sizeRow}>
            {viewModel.availableBrushWidths.map((brushWidth) => (
              <Pressable
                accessibilityRole="button"
                key={brushWidth}
                onPress={() => actions.setBrushWidth(brushWidth)}
                style={[
                  styles.widthButton,
                  viewModel.brushWidth === brushWidth && styles.activeToolButton,
                ]}
              >
                <View
                  style={[
                    styles.sizeDot,
                    {
                      height: brushWidth,
                      width: brushWidth,
                      backgroundColor: viewModel.brushColor,
                    },
                  ]}
                />
              </Pressable>
            ))}
          </View>
          <View style={styles.actionRow}>
            <Pressable accessibilityRole="button" onPress={actions.undoLatestStroke} style={styles.secondaryAction}>
              <Text style={styles.secondaryActionText}>Undo</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={actions.clearCanvas} style={styles.dangerAction}>
              <Text style={styles.dangerActionText}>Clear</Text>
            </Pressable>
          </View>
          {viewModel.canEndRound ? (
            <LuxuryButton onPress={actions.endRound} title="Reveal results" />
          ) : null}
        </View>
      ) : (
        <View style={styles.waitingPanel}>
          <Text style={styles.helper}>Waiting for the drawer to sketch the prompt.</Text>
          {viewModel.canEndRound ? (
            <LuxuryButton onPress={actions.endRound} title="Reveal results" />
          ) : null}
        </View>
      )}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.lg,
    marginBottom: spacing.md,
  },
  statusBar: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  badge: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexGrow: 1,
    minHeight: 54,
    minWidth: 92,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  timerBadge: {
    borderColor: colors.borderGold,
  },
  badgeLabel: {
    color: colors.textSubtle,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
  },
  badgeValue: {
    color: colors.text,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.black,
    marginTop: 2,
    textAlign: 'right',
  },
  timer: {
    color: colors.gold,
    fontSize: typography.sizes.title,
    fontWeight: typography.weights.black,
    textAlign: 'right',
  },
  timerWarning: {
    color: '#FACC15',
  },
  timerDanger: {
    color: '#FCA5A5',
  },
  progressTrack: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: radius.full,
    height: 5,
    marginTop: spacing.xs,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: colors.gold,
    borderRadius: radius.full,
    height: 5,
  },
  progressWarning: {
    backgroundColor: '#FACC15',
  },
  progressDanger: {
    backgroundColor: '#FCA5A5',
  },
  statusNotice: {
    backgroundColor: 'rgba(43,203,136,0.10)',
    borderColor: 'rgba(43,203,136,0.34)',
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.sm,
  },
  statusNoticeText: {
    color: colors.emerald,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
    textAlign: 'center',
  },
  paperFrame: {
    backgroundColor: '#F4EBDD',
    borderColor: colors.gold,
    borderRadius: radius.lg,
    borderWidth: 2,
    padding: spacing.sm,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.32,
    shadowRadius: 22,
    elevation: 8,
  },
  paperHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  paperTitle: {
    color: '#3D2E1F',
    flex: 1,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.black,
    textAlign: 'right',
  },
  currentToolPill: {
    alignItems: 'center',
    backgroundColor: 'rgba(61,46,31,0.09)',
    borderColor: 'rgba(61,46,31,0.18)',
    borderRadius: radius.full,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  currentToolDot: {
    borderColor: 'rgba(61,46,31,0.32)',
    borderRadius: radius.full,
    borderWidth: 1,
  },
  currentToolText: {
    color: '#3D2E1F',
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
  },
  title: {
    color: colors.text,
    flex: 1,
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.black,
    textAlign: 'right',
  },
  canvas: {
    aspectRatio: 1.08,
    backgroundColor: '#F7F2E8',
    borderColor: 'rgba(61,46,31,0.26)',
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  toolbar: {
    gap: spacing.md,
  },
  toolRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  toolButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    minHeight: 42,
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  activeToolButton: {
    borderColor: colors.gold,
    backgroundColor: 'rgba(215,165,74,0.16)',
  },
  toolIcon: {
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    height: 16,
    width: 16,
  },
  eraserIcon: {
    backgroundColor: '#F7F2E8',
    borderColor: colors.goldSoft,
  },
  toolText: {
    color: colors.text,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
  },
  swatchRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  swatch: {
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    height: 32,
    width: 32,
  },
  lightSwatch: {
    borderColor: colors.goldSoft,
  },
  activeSwatch: {
    borderColor: colors.goldSoft,
    borderWidth: 3,
  },
  sizeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  widthButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    minHeight: 38,
    justifyContent: 'center',
  },
  sizeDot: {
    borderRadius: radius.full,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  secondaryAction: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  secondaryActionText: {
    color: colors.text,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
  },
  dangerAction: {
    alignItems: 'center',
    backgroundColor: 'rgba(184,41,75,0.13)',
    borderColor: 'rgba(184,41,75,0.46)',
    borderRadius: radius.full,
    borderWidth: 1,
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  dangerActionText: {
    color: '#FCA5A5',
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
  },
  helper: {
    color: colors.textMuted,
    fontSize: typography.sizes.caption,
    textAlign: 'center',
  },
  waitingPanel: {
    gap: spacing.sm,
  },
});
