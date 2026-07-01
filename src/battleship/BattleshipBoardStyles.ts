import { StyleSheet } from 'react-native';

import { colors, radius, spacing, typography } from '../theme';

export const boardStyles = StyleSheet.create({
  board: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    position: 'relative',
  },
  boardRow: {
    flexDirection: 'row',
  },
  cell: {
    alignItems: 'center',
    backgroundColor: 'rgba(33, 104, 145, 0.22)',
    borderColor: 'rgba(160, 215, 255, 0.18)',
    borderRadius: radius.sm,
    borderWidth: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  cellLocked: {
    opacity: 0.84,
  },
  cellMiss: {
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderColor: 'rgba(255,255,255,0.08)',
  },
  cellPlaced: {
    backgroundColor: 'rgba(232,190,97,0.12)',
    borderColor: 'rgba(232,190,97,0.24)',
  },
  cellPreviewInvalid: {
    backgroundColor: 'rgba(184,41,75,0.28)',
    borderColor: colors.ruby,
  },
  cellPreviewValid: {
    backgroundColor: 'rgba(43,203,136,0.2)',
    borderColor: colors.emerald,
  },
  cellRevealedShip: {
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  columnLabels: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  coordinateFrame: {
    alignSelf: 'center',
  },
  coordinateLabel: {
    color: colors.goldSoft,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
    lineHeight: 16,
    textAlign: 'center',
  },
  coordinateLabelSmall: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: typography.weights.bold,
    lineHeight: 14,
    textAlign: 'center',
  },
  dragGhost: {
    borderRadius: radius.sm,
    borderWidth: 2,
    overflow: 'hidden',
    position: 'absolute',
    shadowColor: colors.shadow,
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.34,
    shadowRadius: 10,
    zIndex: 7,
  },
  dragGhostInvalid: {
    borderColor: colors.ruby,
    opacity: 0.56,
  },
  dragGhostValid: {
    borderColor: colors.emerald,
    opacity: 0.82,
  },
  hitMarker: {
    alignItems: 'center',
    backgroundColor: 'rgba(184,41,75,0.22)',
    borderColor: 'rgba(255,255,255,0.48)',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  hitMarkerCore: {
    backgroundColor: colors.ruby,
    borderRadius: radius.full,
    height: 12,
    width: 12,
  },
  miniBoard: {
    alignSelf: 'flex-end',
  },
  miniCell: {
    borderRadius: radius.sm,
  },
  miniMissText: {
    color: colors.textSubtle,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
  },
  missText: {
    color: colors.textSubtle,
    fontSize: 20,
    fontWeight: typography.weights.black,
  },
  ownBoardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    width: '100%',
  },
  ownBoardMeta: {
    color: colors.goldSoft,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
  },
  ownBoardPanel: {
    alignItems: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.14)',
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: radius.lg,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.md,
    width: '100%',
  },
  ownBoardTitle: {
    color: colors.text,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  ownHitMarker: {
    backgroundColor: colors.ruby,
    borderColor: 'rgba(255,255,255,0.62)',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 14,
    position: 'absolute',
    width: 14,
    zIndex: 4,
  },
  rowLabels: {
    gap: spacing.xs,
    marginRight: spacing.sm,
    width: 16,
  },
  rowLabelsSmall: {
    gap: spacing.xs,
    marginRight: spacing.xs,
    width: 14,
  },
  shipImage: {
    position: 'absolute',
  },
  shotCore: {
    backgroundColor: colors.goldSoft,
    borderRadius: radius.full,
    height: 14,
    shadowColor: colors.gold,
    shadowOffset: { height: 0, width: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 10,
    width: 14,
  },
  shotImpact: {
    alignItems: 'center',
    borderRadius: radius.full,
    height: 50,
    justifyContent: 'center',
    position: 'absolute',
    width: 50,
    zIndex: 6,
  },
  shotImpactHit: {
    backgroundColor: 'rgba(184,41,75,0.24)',
    borderColor: 'rgba(255,255,255,0.64)',
    borderWidth: 1,
  },
  shotImpactMiss: {
    backgroundColor: 'rgba(160,215,255,0.2)',
    borderColor: 'rgba(255,255,255,0.38)',
    borderWidth: 1,
  },
  waterSheen: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    height: 1,
    left: 7,
    position: 'absolute',
    right: 7,
    top: '38%',
  },
});
