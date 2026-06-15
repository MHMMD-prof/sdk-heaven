import {
  Animated,
  GestureResponderEvent,
  Image,
  ImageSourcePropType,
  ImageStyle,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';

import { colors, radius, spacing, typography } from '../theme';
import { CellResult, MiniGameTarget } from '../types/miniGame';
import { findTargetAtCell, getCellResult, parseCellId } from '../utils/miniGameEngine';
import { columnLabels, labels, rowLabels } from './constants';
import { ShipSpriteFrame } from './ShipSpriteFrame';

type ShipFrame = {
  id: string;
  image: ImageSourcePropType;
  imageStyle: StyleProp<ImageStyle>;
  isDarkened: boolean;
  isExploding: boolean;
  style: StyleProp<ViewStyle>;
};

type DragPoint = {
  x: number;
  y: number;
};

type ShipVisual = {
  image: ImageSourcePropType;
  imageStyle: StyleProp<ImageStyle>;
};

type ShotAnimation = {
  result: 'hit' | 'miss';
};

type BoardPosition = {
  column: number;
  row: number;
};

type BattleshipTargetBoardProps = {
  activeGuesses: Set<string>;
  activeTargets: MiniGameTarget[];
  boardCells: string[];
  boardShipFrames: ShipFrame[];
  boardWidth: number;
  cellGap: number;
  cellSize: number;
  dragPoint?: DragPoint;
  isCellDisabled: (cellId: string) => boolean;
  isSetupPhase: boolean;
  modeAccentColor: string;
  onCellPress: (cellId: string) => void;
  onDragMove: (event: GestureResponderEvent) => void;
  onDragRelease: (event: GestureResponderEvent) => void;
  previewCells: string[];
  previewIsValid: boolean;
  selectedGhostHeight: number;
  selectedGhostVisual?: ShipVisual;
  selectedGhostWidth: number;
  shouldStartDragResponder: boolean;
  setupTargets: MiniGameTarget[];
  shotAnimation?: ShotAnimation;
  shotAnimationPosition?: BoardPosition;
  shotOpacity: Animated.AnimatedInterpolation<string | number>;
  shotScale: Animated.AnimatedInterpolation<string | number>;
  shotTranslateY: Animated.AnimatedInterpolation<string | number>;
};

export function BattleshipTargetBoard({
  activeGuesses,
  activeTargets,
  boardCells,
  boardShipFrames,
  boardWidth,
  cellGap,
  cellSize,
  dragPoint,
  isCellDisabled,
  isSetupPhase,
  modeAccentColor,
  onCellPress,
  onDragMove,
  onDragRelease,
  previewCells,
  previewIsValid,
  selectedGhostHeight,
  selectedGhostVisual,
  selectedGhostWidth,
  shouldStartDragResponder,
  setupTargets,
  shotAnimation,
  shotAnimationPosition,
  shotOpacity,
  shotScale,
  shotTranslateY,
}: BattleshipTargetBoardProps) {
  return (
    <View style={[styles.coordinateFrame, { width: boardWidth + 28 }]}>
      <View style={[styles.columnLabels, { marginLeft: 24, width: boardWidth }]}>
        {columnLabels.map((label) => (
          <Text key={label} style={[styles.coordinateLabel, { width: cellSize }]}>
            {label}
          </Text>
        ))}
      </View>
      <View style={styles.boardRow}>
        <View style={[styles.rowLabels, { height: boardWidth }]}>
          {rowLabels.map((label) => (
            <Text key={label} style={[styles.coordinateLabel, { height: cellSize }]}>
              {label}
            </Text>
          ))}
        </View>
        <View
          onMoveShouldSetResponder={() => shouldStartDragResponder}
          onResponderMove={onDragMove}
          onResponderRelease={onDragRelease}
          onStartShouldSetResponder={() => false}
          style={[styles.board, { height: boardWidth, width: boardWidth }]}
        >
          {boardCells.map((cellId) => {
            const result: CellResult = isSetupPhase
              ? 'hidden'
              : getCellResult(cellId, activeGuesses, activeTargets);
            const target = isSetupPhase
              ? setupTargets.find((item) => item.cells.includes(cellId))
              : findTargetAtCell(cellId, activeTargets);
            const isHit = result === 'hit';
            const isMiss = result === 'miss';
            const targetComplete =
              Boolean(target) && target!.cells.every((cell) => activeGuesses.has(cell));
            const isPreviewCell = previewCells.includes(cellId);
            const isPlacedCell = isSetupPhase && Boolean(target);

            return (
              <Pressable
                key={cellId}
                disabled={isCellDisabled(cellId)}
                onPress={() => onCellPress(cellId)}
                style={[
                  styles.cell,
                  {
                    height: cellSize,
                    width: cellSize,
                  },
                  isPlacedCell && styles.cellPlaced,
                  isPreviewCell && (previewIsValid ? styles.cellPreviewValid : styles.cellPreviewInvalid),
                  isHit && { backgroundColor: `${modeAccentColor}38`, borderColor: modeAccentColor },
                  targetComplete && styles.cellRevealedShip,
                  isMiss && styles.cellMiss,
                  isCellDisabled(cellId) && styles.cellLocked,
                ]}
              >
                {!isHit && !isMiss ? <View style={styles.waterSheen} /> : null}
                {isMiss ? <Text style={styles.missText}>{'\u00d7'}</Text> : null}
                {isHit && !targetComplete ? (
                  <View style={styles.hitMarker}>
                    <View style={styles.hitMarkerCore} />
                  </View>
                ) : null}
              </Pressable>
            );
          })}
          {boardShipFrames.map((ship) => (
            <ShipSpriteFrame
              key={ship.id}
              image={ship.image}
              imageStyle={ship.imageStyle}
              isDarkened={ship.isDarkened}
              isExploding={ship.isExploding}
              style={ship.style}
            />
          ))}
          {isSetupPhase && dragPoint && selectedGhostVisual ? (
            <View
              pointerEvents="none"
              style={[
                styles.dragGhost,
                previewIsValid ? styles.dragGhostValid : styles.dragGhostInvalid,
                {
                  height: selectedGhostHeight,
                  left: dragPoint.x - selectedGhostWidth / 2,
                  top: dragPoint.y - selectedGhostHeight / 2,
                  width: selectedGhostWidth,
                },
              ]}
            >
              <Image
                resizeMode="stretch"
                source={selectedGhostVisual.image}
                style={[styles.shipImage, selectedGhostVisual.imageStyle]}
              />
            </View>
          ) : null}
          {shotAnimation && shotAnimationPosition ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.shotImpact,
                shotAnimation.result === 'hit' ? styles.shotImpactHit : styles.shotImpactMiss,
                {
                  left: shotAnimationPosition.column * (cellSize + cellGap) + cellSize / 2 - 25,
                  opacity: shotOpacity,
                  top: shotAnimationPosition.row * (cellSize + cellGap) + cellSize / 2 - 25,
                  transform: [{ translateY: shotTranslateY }, { scale: shotScale }],
                },
              ]}
            >
              <View style={styles.shotCore} />
            </Animated.View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

type BattleshipOwnBoardProps = {
  boardCells: string[];
  boardWidth: number;
  cellGap: number;
  cellSize: number;
  incomingGuesses: Set<string>;
  metaText: string | number;
  ownShipFrames: ShipFrame[];
  targets: MiniGameTarget[];
};

export function BattleshipOwnBoard({
  boardCells,
  boardWidth,
  cellGap,
  cellSize,
  incomingGuesses,
  metaText,
  ownShipFrames,
  targets,
}: BattleshipOwnBoardProps) {
  return (
    <View style={styles.ownBoardPanel}>
      <View style={styles.ownBoardHeader}>
        <Text style={styles.ownBoardMeta}>{metaText}</Text>
        <Text style={styles.ownBoardTitle}>{labels.ownFleet}</Text>
      </View>
      <View style={[styles.coordinateFrame, { width: boardWidth + 24 }]}>
        <View style={[styles.columnLabels, { marginLeft: 20, width: boardWidth }]}>
          {columnLabels.map((label) => (
            <Text key={`own-col-${label}`} style={[styles.coordinateLabelSmall, { width: cellSize }]}>
              {label}
            </Text>
          ))}
        </View>
        <View style={styles.boardRow}>
          <View style={[styles.rowLabelsSmall, { height: boardWidth }]}>
            {rowLabels.map((label) => (
              <Text key={`own-row-${label}`} style={[styles.coordinateLabelSmall, { height: cellSize }]}>
                {label}
              </Text>
            ))}
          </View>
          <View style={[styles.board, styles.miniBoard, { height: boardWidth, width: boardWidth }]}>
            {boardCells.map((cellId) => {
              const result = getCellResult(cellId, incomingGuesses, targets);
              const isMiss = result === 'miss';

              return (
                <View
                  key={`own-${cellId}`}
                  style={[
                    styles.cell,
                    styles.miniCell,
                    {
                      height: cellSize,
                      width: cellSize,
                    },
                    isMiss && styles.cellMiss,
                  ]}
                >
                  {!isMiss ? <View style={styles.waterSheen} /> : null}
                  {isMiss ? <Text style={styles.miniMissText}>{'\u00d7'}</Text> : null}
                </View>
              );
            })}
            {ownShipFrames.map((ship) => (
              <ShipSpriteFrame
                key={`own-${ship.id}`}
                image={ship.image}
                imageStyle={ship.imageStyle}
                isDarkened={ship.isDarkened}
                isExploding={ship.isExploding}
                style={ship.style}
              />
            ))}
            {targets.flatMap((target) =>
              target.cells
                .filter((cell) => incomingGuesses.has(cell))
                .map((cell) => {
                  const position = parseCellId(cell);

                  return (
                    <View
                      key={`own-hit-${target.id}-${cell}`}
                      pointerEvents="none"
                      style={[
                        styles.ownHitMarker,
                        {
                          left: position.column * (cellSize + cellGap) + cellSize / 2 - 7,
                          top: position.row * (cellSize + cellGap) + cellSize / 2 - 7,
                        },
                      ]}
                    />
                  );
                }),
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
