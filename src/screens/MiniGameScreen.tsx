import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  GestureResponderEvent,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { LuxuryButton } from '../components/LuxuryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { BattleshipOwnBoard, BattleshipTargetBoard } from '../battleship/BattleshipBoard';
import { miniGameModes } from '../data/miniGameModes';
import { colors, radius, spacing, typography } from '../theme';
import { MiniGameModeId, MiniGameTarget } from '../types/miniGame';
import { RootStackParamList } from '../types/navigation';
import {
  SoundKey,
  labels,
  soundSources,
} from '../battleship/constants';
import { createShipVisual } from '../battleship/shipSprites';
import {
  BOARD_SIZE,
  MAX_ATTEMPTS,
  canPlaceTarget,
  countHits,
  createBoardCells,
  createEmptyTargets,
  createHiddenTargets,
  findTargetAtCell,
  getFleetCellCount,
  getPlacementCells,
  isFleetPlaced,
  placeTargetAtCell,
  randomizeTargets,
  removeTargetPlacement,
  rotatePlacedTarget,
  parseCellId,
} from '../utils/miniGameEngine';

type MiniGameScreenProps = NativeStackScreenProps<RootStackParamList, 'MiniGame'>;
type GamePhase =
  | 'pre-match'
  | 'setup-player-1'
  | 'handoff-to-player-2'
  | 'setup-player-2'
  | 'battle'
  | 'turn-handoff';
type LastShot = {
  result: 'hit' | 'miss';
  text: string;
};
type ShotAnimation = {
  cellId: string;
  result: 'hit' | 'miss';
};
type DragPoint = {
  x: number;
  y: number;
};
export function MiniGameScreen({ navigation, route }: MiniGameScreenProps) {
  const initialMode = route.params?.initialMode ?? 'naval';
  const initialModeConfig =
    miniGameModes.find((item) => item.id === initialMode) ?? miniGameModes[0];
  const isInitialNaval = initialModeConfig.id === 'naval';
  const [modeId, setModeId] = useState<MiniGameModeId>(initialModeConfig.id);
  const mode = miniGameModes.find((item) => item.id === modeId) ?? miniGameModes[0];
  const [phase, setPhase] = useState<GamePhase>(isInitialNaval ? 'pre-match' : 'battle');
  const [selectedTargetId, setSelectedTargetId] = useState<string | undefined>(
    isInitialNaval ? initialModeConfig.targets[0]?.id : undefined,
  );
  const [previewCellId, setPreviewCellId] = useState<string | undefined>();
  const [dragPoint, setDragPoint] = useState<DragPoint | undefined>();
  const [soundMuted, setSoundMuted] = useState(false);
  const [attemptsEnabled, setAttemptsEnabled] = useState(true);
  const [playerOneTargets, setPlayerOneTargets] = useState<MiniGameTarget[]>(() =>
    isInitialNaval ? createEmptyTargets(initialModeConfig) : createHiddenTargets(initialModeConfig),
  );
  const [playerTwoTargets, setPlayerTwoTargets] = useState<MiniGameTarget[]>(() =>
    isInitialNaval ? createEmptyTargets(initialModeConfig) : createHiddenTargets(initialModeConfig),
  );
  const [playerOneGuesses, setPlayerOneGuesses] = useState<Set<string>>(() => new Set());
  const [playerTwoGuesses, setPlayerTwoGuesses] = useState<Set<string>>(() => new Set());
  const [currentPlayer, setCurrentPlayer] = useState<1 | 2>(1);
  const [pendingTurnPass, setPendingTurnPass] = useState(false);
  const [lastShot, setLastShot] = useState<LastShot | undefined>();
  const [shotAnimation, setShotAnimation] = useState<ShotAnimation | undefined>();
  const [explodingShipIds, setExplodingShipIds] = useState<Set<string>>(() => new Set());
  const [darkenedShipIds, setDarkenedShipIds] = useState<Set<string>>(() => new Set());
  const shotAnimationValue = useRef(new Animated.Value(0)).current;
  const explosionTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const shotTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const victoryFeedbackKey = useRef<string | undefined>(undefined);
  const { width } = useWindowDimensions();
  const tapPlayer = useAudioPlayer(soundSources.tap);
  const invalidPlayer = useAudioPlayer(soundSources.invalid);
  const missPlayer = useAudioPlayer(soundSources.miss);
  const hitPlayer = useAudioPlayer(soundSources.hit);
  const sunkPlayer = useAudioPlayer(soundSources.sunk);
  const victoryPlayer = useAudioPlayer(soundSources.victory);

  useEffect(
    () => () => {
      explosionTimers.current.forEach((timer) => clearTimeout(timer));
      shotTimers.current.forEach((timer) => clearTimeout(timer));
    },
    [],
  );

  useEffect(() => {
    if (!shotAnimation) {
      return;
    }

    shotAnimationValue.setValue(0);
    Animated.sequence([
      Animated.timing(shotAnimationValue, {
        duration: 260,
        toValue: 0.7,
        useNativeDriver: true,
      }),
      Animated.timing(shotAnimationValue, {
        duration: 220,
        toValue: 1,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setShotAnimation(undefined);
    });
  }, [shotAnimation, shotAnimationValue]);

  const soundPlayers = {
    hit: hitPlayer,
    invalid: invalidPlayer,
    miss: missPlayer,
    sunk: sunkPlayer,
    tap: tapPlayer,
    victory: victoryPlayer,
  };

  const playSound = (soundKey: SoundKey) => {
    if (soundMuted) {
      return;
    }

    const player = soundPlayers[soundKey];

    try {
      void player
        .seekTo(0)
        .then(() => player.play())
        .catch(() => player.play());
    } catch {
      // Audio can be unavailable on some test/simulator targets; gameplay should continue.
    }
  };

  const impact = (style: Haptics.ImpactFeedbackStyle) => {
    void Haptics.impactAsync(style).catch(() => undefined);
  };

  const notify = (type: Haptics.NotificationFeedbackType) => {
    void Haptics.notificationAsync(type).catch(() => undefined);
  };

  const boardCells = useMemo(() => createBoardCells(), []);
  const isNaval = mode.id === 'naval';
  const isSetupPhase = phase === 'setup-player-1' || phase === 'setup-player-2';
  const setupPlayer = phase === 'setup-player-2' ? 2 : 1;
  const setupTargets = setupPlayer === 1 ? playerOneTargets : playerTwoTargets;
  const selectedTarget = setupTargets.find((target) => target.id === selectedTargetId);
  const setupFleetReady = isFleetPlaced(setupTargets);
  const activeTargets = currentPlayer === 1 ? playerTwoTargets : playerOneTargets;
  const activeGuesses = currentPlayer === 1 ? playerOneGuesses : playerTwoGuesses;
  const ownTargets = currentPlayer === 1 ? playerOneTargets : playerTwoTargets;
  const ownIncomingGuesses = currentPlayer === 1 ? playerTwoGuesses : playerOneGuesses;
  const playerOneHits = countHits(playerOneGuesses, playerTwoTargets);
  const playerTwoHits = countHits(playerTwoGuesses, playerOneTargets);
  const totalTargetCells = getFleetCellCount(playerOneTargets);
  const playerOneAttemptsLeft = attemptsEnabled ? MAX_ATTEMPTS - playerOneGuesses.size : Infinity;
  const playerTwoAttemptsLeft = attemptsEnabled ? MAX_ATTEMPTS - playerTwoGuesses.size : Infinity;
  const playerOneWon = playerOneHits === totalTargetCells;
  const playerTwoWon = playerTwoHits === totalTargetCells;
  const attemptsLeft = currentPlayer === 1 ? playerOneAttemptsLeft : playerTwoAttemptsLeft;
  const attemptsLeftText = attemptsEnabled ? String(attemptsLeft) : '\u221e';
  const hits = currentPlayer === 1 ? playerOneHits : playerTwoHits;
  const shotsTaken = activeGuesses.size;
  const winner = playerOneWon ? 1 : playerTwoWon ? 2 : undefined;
  const bothOutOfAttempts =
    attemptsEnabled && playerOneAttemptsLeft === 0 && playerTwoAttemptsLeft === 0;
  const isGameOver = phase === 'battle' && (Boolean(winner) || bothOutOfAttempts);
  const cellGap = spacing.xs;
  const availableBoardWidth = width - spacing.lg * 2 - spacing.md * 2;
  const cellSize = Math.min(
    (availableBoardWidth - cellGap * (BOARD_SIZE - 1)) / BOARD_SIZE,
    50,
  );
  const boardWidth = cellSize * BOARD_SIZE + cellGap * (BOARD_SIZE - 1);
  const miniCellSize = Math.min(
    (availableBoardWidth - cellGap * (BOARD_SIZE - 1)) / BOARD_SIZE,
    34,
  );
  const miniBoardWidth = miniCellSize * BOARD_SIZE + cellGap * (BOARD_SIZE - 1);
  const previewCells =
    selectedTarget && previewCellId
      ? getPlacementCells(previewCellId, selectedTarget.footprint)
      : [];
  const shotAnimationPosition = shotAnimation ? parseCellId(shotAnimation.cellId) : undefined;
  const shotTranslateY = shotAnimationValue.interpolate({
    inputRange: [0, 0.7, 1],
    outputRange: [-cellSize * 1.25, 0, 0],
  });
  const shotScale = shotAnimationValue.interpolate({
    inputRange: [0, 0.7, 1],
    outputRange: [0.5, 1, 1.35],
  });
  const shotOpacity = shotAnimationValue.interpolate({
    inputRange: [0, 0.7, 1],
    outputRange: [0, 1, 0],
  });
  const previewIsValid =
    Boolean(selectedTarget && previewCellId) &&
    canPlaceTarget(
      selectedTarget!.id,
      previewCellId!,
      selectedTarget!.footprint,
      setupTargets,
    );
  const selectedGhostWidth = selectedTarget
    ? selectedTarget.footprint.columns * cellSize +
      (selectedTarget.footprint.columns - 1) * cellGap
    : 0;
  const selectedGhostHeight = selectedTarget
    ? selectedTarget.footprint.rows * cellSize + (selectedTarget.footprint.rows - 1) * cellGap
    : 0;
  const selectedGhostVisual =
    selectedTarget && selectedGhostWidth && selectedGhostHeight
      ? createShipVisual(selectedTarget, selectedGhostWidth, selectedGhostHeight)
      : undefined;

  const createShipFrame = (
    target: MiniGameTarget,
    effectKey?: string,
    frameCellSize = cellSize,
    frameCellGap = cellGap,
  ) => {
    if (!target.cells.length) {
      return undefined;
    }

    const positions = target.cells.map(parseCellId);
    const startRow = Math.min(...positions.map((position) => position.row));
    const startColumn = Math.min(...positions.map((position) => position.column));
    const frameHeight =
      target.footprint.rows * frameCellSize + (target.footprint.rows - 1) * frameCellGap;
    const frameWidth =
      target.footprint.columns * frameCellSize +
      (target.footprint.columns - 1) * frameCellGap;
    const visual = createShipVisual(target, frameWidth, frameHeight);

    if (!visual) {
      return undefined;
    }

    return {
      id: target.id,
      image: visual.image,
      isDarkened: Boolean(effectKey && darkenedShipIds.has(effectKey)),
      isExploding: Boolean(effectKey && explodingShipIds.has(effectKey)),
      imageStyle: visual.imageStyle,
      style: {
        height: frameHeight,
        left: startColumn * (frameCellSize + frameCellGap),
        opacity: selectedTargetId === target.id && isSetupPhase ? 0.5 : 1,
        top: startRow * (frameCellSize + frameCellGap),
        width: frameWidth,
      },
    };
  };

  const defendingPlayer = currentPlayer === 1 ? 2 : 1;
  const ownPlayer = currentPlayer;
  const boardShipFrames = (isSetupPhase ? setupTargets : activeTargets)
    .filter((target) =>
      isSetupPhase
        ? target.isPlaced
        : isNaval && target.cells.every((cell) => activeGuesses.has(cell)),
    )
    .map((target) =>
      createShipFrame(target, isSetupPhase ? undefined : `${defendingPlayer}-${target.id}`),
    )
    .filter((ship): ship is NonNullable<ReturnType<typeof createShipFrame>> => Boolean(ship));
  const ownShipFrames = ownTargets
    .map((target) => createShipFrame(target, `${ownPlayer}-${target.id}`, miniCellSize, cellGap))
    .filter((ship): ship is NonNullable<ReturnType<typeof createShipFrame>> => Boolean(ship));

  const setCurrentSetupTargets = (updater: (targets: MiniGameTarget[]) => MiniGameTarget[]) => {
    if (setupPlayer === 1) {
      setPlayerOneTargets((targets) => updater(targets));
    } else {
      setPlayerTwoTargets((targets) => updater(targets));
    }
  };

  const selectNextUnplacedTarget = (targets: MiniGameTarget[]) => {
    const nextTarget = targets.find((target) => !target.isPlaced);
    setSelectedTargetId(nextTarget?.id);
  };

  const clearSunkEffects = () => {
    explosionTimers.current.forEach((timer) => clearTimeout(timer));
    explosionTimers.current = [];
    setExplodingShipIds(new Set());
    setDarkenedShipIds(new Set());
  };

  const clearShotAnimation = () => {
    shotTimers.current.forEach((timer) => clearTimeout(timer));
    shotTimers.current = [];
    setShotAnimation(undefined);
    shotAnimationValue.setValue(0);
  };

  const triggerSunkEffect = (effectKey: string) => {
    playSound('sunk');
    notify(Haptics.NotificationFeedbackType.Warning);

    setExplodingShipIds((currentIds) => {
      if (currentIds.has(effectKey)) {
        return currentIds;
      }

      return new Set(currentIds).add(effectKey);
    });

    const timer = setTimeout(() => {
      setExplodingShipIds((currentIds) => {
        const nextIds = new Set(currentIds);
        nextIds.delete(effectKey);
        return nextIds;
      });
      setDarkenedShipIds((currentIds) => new Set(currentIds).add(effectKey));
    }, 1200);

    explosionTimers.current.push(timer);
  };

  const startMatch = () => {
    playSound('tap');
    impact(Haptics.ImpactFeedbackStyle.Medium);
    resetGame(modeId, false);
  };

  const resetGame = (nextModeId = modeId, showPreMatch = false) => {
    const nextMode = miniGameModes.find((item) => item.id === nextModeId) ?? miniGameModes[0];
    const nextIsNaval = nextMode.id === 'naval';

    clearShotAnimation();
    clearSunkEffects();
    setModeId(nextMode.id);
    setPhase(nextIsNaval ? (showPreMatch ? 'pre-match' : 'setup-player-1') : 'battle');
    setSelectedTargetId(nextIsNaval ? nextMode.targets[0]?.id : undefined);
    setPreviewCellId(undefined);
    setDragPoint(undefined);
    setPlayerOneTargets(nextIsNaval ? createEmptyTargets(nextMode) : createHiddenTargets(nextMode));
    setPlayerTwoTargets(nextIsNaval ? createEmptyTargets(nextMode) : createHiddenTargets(nextMode));
    setPlayerOneGuesses(new Set());
    setPlayerTwoGuesses(new Set());
    setCurrentPlayer(1);
    setPendingTurnPass(false);
    setLastShot(undefined);
  };

  const getCellIdFromBoardEvent = (event: GestureResponderEvent) => {
    const column = Math.floor(event.nativeEvent.locationX / (cellSize + cellGap));
    const row = Math.floor(event.nativeEvent.locationY / (cellSize + cellGap));
    const columnOffset = event.nativeEvent.locationX - column * (cellSize + cellGap);
    const rowOffset = event.nativeEvent.locationY - row * (cellSize + cellGap);

    if (
      row < 0 ||
      column < 0 ||
      row >= BOARD_SIZE ||
      column >= BOARD_SIZE ||
      rowOffset > cellSize ||
      columnOffset > cellSize
    ) {
      return undefined;
    }

    return `${row}-${column}`;
  };

  const pickUpTarget = (targetId: string, anchorCellId?: string) => {
    playSound('tap');
    impact(Haptics.ImpactFeedbackStyle.Light);
    setSelectedTargetId(targetId);
    setPreviewCellId(anchorCellId);
    setDragPoint(undefined);
    setCurrentSetupTargets((targets) => removeTargetPlacement(targets, targetId));
  };

  const handleSetupCellPress = (cellId: string) => {
    const placedTarget = setupTargets.find((target) => target.cells.includes(cellId));

    if (placedTarget) {
      pickUpTarget(placedTarget.id, placedTarget.cells[0]);
      return;
    }

    if (!selectedTarget) {
      return;
    }

    setPreviewCellId(cellId);

    if (!canPlaceTarget(selectedTarget.id, cellId, selectedTarget.footprint, setupTargets)) {
      playSound('invalid');
      notify(Haptics.NotificationFeedbackType.Error);
      return;
    }

    const nextTargets = placeTargetAtCell(
      setupTargets,
      selectedTarget.id,
      cellId,
      selectedTarget.footprint,
    );
    setCurrentSetupTargets(() => nextTargets);
    selectNextUnplacedTarget(nextTargets);
    setPreviewCellId(undefined);
    setDragPoint(undefined);
    playSound('tap');
    impact(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleDragToCell = (event: GestureResponderEvent) => {
    const cellId = getCellIdFromBoardEvent(event);

    setDragPoint({
      x: event.nativeEvent.locationX,
      y: event.nativeEvent.locationY,
    });

    if (cellId) {
      setPreviewCellId(cellId);
    }
  };

  const handleDragRelease = (event: GestureResponderEvent) => {
    const cellId = getCellIdFromBoardEvent(event) ?? previewCellId;

    if (!selectedTarget || !cellId) {
      setDragPoint(undefined);
      return;
    }

    if (!canPlaceTarget(selectedTarget.id, cellId, selectedTarget.footprint, setupTargets)) {
      setPreviewCellId(cellId);
      setDragPoint(undefined);
      playSound('invalid');
      notify(Haptics.NotificationFeedbackType.Error);
      return;
    }

    const nextTargets = placeTargetAtCell(
      setupTargets,
      selectedTarget.id,
      cellId,
      selectedTarget.footprint,
    );
    setCurrentSetupTargets(() => nextTargets);
    selectNextUnplacedTarget(nextTargets);
    setPreviewCellId(undefined);
    setDragPoint(undefined);
    playSound('tap');
    impact(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleRotateSelected = () => {
    if (!selectedTargetId) {
      return;
    }

    setCurrentSetupTargets((targets) => rotatePlacedTarget(targets, selectedTargetId));
    setDragPoint(undefined);
    playSound('tap');
    impact(Haptics.ImpactFeedbackStyle.Medium);
  };

  const handleRandomizeSetup = () => {
    const nextTargets = randomizeTargets(setupTargets);
    setCurrentSetupTargets(() => nextTargets);
    setSelectedTargetId(undefined);
    setPreviewCellId(undefined);
    setDragPoint(undefined);
    playSound('tap');
    impact(Haptics.ImpactFeedbackStyle.Medium);
  };

  const handleClearSetup = () => {
    const clearedTargets = createEmptyTargets(mode);
    setCurrentSetupTargets(() => clearedTargets);
    setSelectedTargetId(clearedTargets[0]?.id);
    setPreviewCellId(undefined);
    setDragPoint(undefined);
    playSound('tap');
    impact(Haptics.ImpactFeedbackStyle.Light);
  };

  const confirmSetupFleet = () => {
    if (!setupFleetReady) {
      playSound('invalid');
      notify(Haptics.NotificationFeedbackType.Error);
      return;
    }

    playSound('tap');
    notify(Haptics.NotificationFeedbackType.Success);
    setSelectedTargetId(undefined);
    setPreviewCellId(undefined);
    setDragPoint(undefined);

    if (phase === 'setup-player-1') {
      setPhase('handoff-to-player-2');
      return;
    }

    setPlayerOneGuesses(new Set());
    setPlayerTwoGuesses(new Set());
    setCurrentPlayer(1);
    setPendingTurnPass(false);
    setLastShot(undefined);
    clearSunkEffects();
    setPhase('battle');
  };

  const startPlayerTwoSetup = () => {
    playSound('tap');
    impact(Haptics.ImpactFeedbackStyle.Light);
    setSelectedTargetId(playerTwoTargets.find((target) => !target.isPlaced)?.id);
    setDragPoint(undefined);
    setPhase('setup-player-2');
  };

  const handleCellPress = (cellId: string) => {
    if (isSetupPhase) {
      handleSetupCellPress(cellId);
      return;
    }

    if (
      phase !== 'battle' ||
      isGameOver ||
      pendingTurnPass ||
      Boolean(shotAnimation) ||
      activeGuesses.has(cellId)
    ) {
      return;
    }

    const nextGuesses = new Set(activeGuesses).add(cellId);
    const target = findTargetAtCell(cellId, activeTargets);
    const isHit = Boolean(target);
    const nextHits = countHits(nextGuesses, activeTargets);
    const nextAttemptsLeft = attemptsEnabled ? MAX_ATTEMPTS - nextGuesses.size : Infinity;
    const nextPlayerWon = nextHits === totalTargetCells;
    const sunkTarget = target?.cells.every((cell) => nextGuesses.has(cell));

    playSound('tap');
    impact(Haptics.ImpactFeedbackStyle.Light);
    setShotAnimation({ cellId, result: isHit ? 'hit' : 'miss' });

    const timer = setTimeout(() => {
      if (currentPlayer === 1) {
        setPlayerOneGuesses(nextGuesses);
      } else {
        setPlayerTwoGuesses(nextGuesses);
      }

      setLastShot({
        result: isHit ? 'hit' : 'miss',
        text: isHit ? labels.hit : labels.miss,
      });

      if (isHit) {
        playSound('hit');
        impact(Haptics.ImpactFeedbackStyle.Heavy);
      } else {
        playSound('miss');
        impact(Haptics.ImpactFeedbackStyle.Light);
      }

      if (target && sunkTarget) {
        triggerSunkEffect(`${defendingPlayer}-${target.id}`);
      }

      if (!isHit && !nextPlayerWon && nextAttemptsLeft > 0) {
        setPendingTurnPass(true);
      }
    }, 500);

    shotTimers.current.push(timer);
  };

  const passTurn = () => {
    playSound('tap');
    impact(Haptics.ImpactFeedbackStyle.Light);
    setPhase('turn-handoff');
  };

  const continueTurnHandoff = () => {
    playSound('tap');
    impact(Haptics.ImpactFeedbackStyle.Light);
    setCurrentPlayer(currentPlayer === 1 ? 2 : 1);
    setPendingTurnPass(false);
    setLastShot(undefined);
    setPhase('battle');
  };

  const statusText = isSetupPhase
    ? `${labels.setupFleet} - ${labels.player} ${setupPlayer}`
    : phase === 'turn-handoff'
      ? `${labels.preparePlayer} ${labels.player} ${currentPlayer === 1 ? 2 : 1}`
      : shotAnimation
        ? labels.shotFlying
      : winner
      ? `${labels.winner} ${labels.player} ${winner}`
      : bothOutOfAttempts
        ? labels.roundOver
        : pendingTurnPass
        ? labels.passTurnStatus
          : `${labels.turn} ${labels.player} ${currentPlayer}`;

  useEffect(() => {
    if (!isGameOver) {
      victoryFeedbackKey.current = undefined;
      return;
    }

    const feedbackKey = `${winner ?? 'draw'}-${playerOneGuesses.size}-${playerTwoGuesses.size}`;

    if (victoryFeedbackKey.current === feedbackKey) {
      return;
    }

    victoryFeedbackKey.current = feedbackKey;
    playSound('victory');
    notify(
      winner
        ? Haptics.NotificationFeedbackType.Success
        : Haptics.NotificationFeedbackType.Warning,
    );
  });

  if (phase === 'handoff-to-player-2' || phase === 'turn-handoff') {
    const handoffPlayer = phase === 'handoff-to-player-2' ? 2 : currentPlayer === 1 ? 2 : 1;

    return (
      <ScreenContainer>
        <View style={styles.handoffPanel}>
          <Text style={styles.handoffKicker}>
            {labels.player} {handoffPlayer}
          </Text>
          <Text style={styles.handoffTitle}>{labels.passTitle}</Text>
          <Text style={styles.handoffText}>{labels.passReady}</Text>
          <LuxuryButton
            onPress={phase === 'handoff-to-player-2' ? startPlayerTwoSetup : continueTurnHandoff}
            title={labels.passReady}
          />
        </View>
      </ScreenContainer>
    );
  }

  if (phase === 'pre-match') {
    return (
      <ScreenContainer>
        <View style={styles.victoryPanel}>
          <Text style={styles.handoffKicker}>{labels.localGame}</Text>
          <Text style={styles.victoryTitle}>{mode.title}</Text>
          <Text style={styles.victoryText}>{mode.subtitle}</Text>

          <Pressable
            onPress={() => {
              setAttemptsEnabled((enabled) => !enabled);
              playSound('tap');
              impact(Haptics.ImpactFeedbackStyle.Light);
            }}
            style={[styles.ruleOption, attemptsEnabled && styles.ruleOptionActive]}
          >
            <Text style={styles.ruleOptionTitle}>
              {attemptsEnabled ? labels.attemptsOn : labels.attemptsOff}
            </Text>
            <Text style={styles.ruleOptionMeta}>
              {attemptsEnabled ? `${MAX_ATTEMPTS}` : '\u221e'}
            </Text>
          </Pressable>

          <LuxuryButton onPress={startMatch} title={labels.startMatch} />
        </View>
      </ScreenContainer>
    );
  }

  if (phase === 'battle' && isGameOver) {
    return (
      <ScreenContainer>
        <View style={styles.victoryPanel}>
          <Text style={styles.handoffKicker}>{mode.title}</Text>
          <Text style={styles.victoryTitle}>
            {winner ? `${labels.victory}: ${labels.player} ${winner}` : labels.draw}
          </Text>
          <Text style={styles.victoryText}>
            {winner ? `${labels.winner} ${labels.player} ${winner}` : labels.noWinner}
          </Text>

          <View style={styles.victoryStats}>
            <View style={styles.victoryStat}>
              <Text style={styles.statValue}>
                {playerOneHits}/{totalTargetCells}
              </Text>
              <Text style={styles.statLabel}>
                {labels.player} 1 - {labels.hits}
              </Text>
            </View>
            <View style={styles.victoryStat}>
              <Text style={styles.statValue}>
                {playerTwoHits}/{totalTargetCells}
              </Text>
              <Text style={styles.statLabel}>
                {labels.player} 2 - {labels.hits}
              </Text>
            </View>
          </View>

          <View style={styles.victoryStats}>
            <View style={styles.victoryStat}>
              <Text style={styles.statValue}>{playerOneGuesses.size}</Text>
              <Text style={styles.statLabel}>
                {labels.player} 1 - {labels.shots}
              </Text>
            </View>
            <View style={styles.victoryStat}>
              <Text style={styles.statValue}>{playerTwoGuesses.size}</Text>
              <Text style={styles.statLabel}>
                {labels.player} 2 - {labels.shots}
              </Text>
            </View>
          </View>

          <LuxuryButton onPress={() => resetGame()} title={labels.newRound} />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backText}>{labels.back}</Text>
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.kicker}>{labels.localGame}</Text>
          <Text style={styles.title}>{mode.title}</Text>
          <Text style={styles.subtitle}>
            {mode.subtitle} {labels.subtitleSuffix}
          </Text>
        </View>
      </View>

      <View style={styles.modeSwitch}>
        {miniGameModes.map((item) => {
          const active = item.id === modeId;

          return (
            <Pressable
              key={item.id}
              onPress={() => resetGame(item.id, true)}
              style={[styles.modeButton, active && { borderColor: item.accentColor }]}
            >
              <Text style={[styles.modeText, active && styles.modeTextActive]}>{item.title}</Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        onPress={() => {
          const nextMuted = !soundMuted;
          setSoundMuted(nextMuted);
          impact(Haptics.ImpactFeedbackStyle.Light);

          if (!nextMuted) {
            playSound('tap');
          }
        }}
        style={styles.soundToggle}
      >
        <Text style={styles.soundToggleText}>
          {soundMuted ? labels.soundOff : labels.soundOn}
        </Text>
      </Pressable>

      <LinearGradient
        colors={['rgba(50,139,194,0.2)', 'rgba(9,29,53,0.78)', 'rgba(8,5,15,0.96)']}
        style={styles.boardCard}
      >
        <View style={styles.boardHeader}>
          <View style={styles.turnBadge}>
            <Text style={styles.turnBadgeText}>{statusText}</Text>
          </View>
          <Text style={styles.boardLabel}>
            {phase === 'battle' ? labels.enemyWaters : mode.boardLabel}
          </Text>
        </View>

        {isSetupPhase ? (
          <View style={styles.setupActions}>
            <Pressable
              disabled={!selectedTargetId}
              onPress={handleRotateSelected}
              style={[styles.toolButton, !selectedTargetId && styles.toolButtonDisabled]}
            >
              <Text style={styles.toolButtonText}>{labels.rotate}</Text>
            </Pressable>
            <Pressable onPress={handleRandomizeSetup} style={styles.toolButton}>
              <Text style={styles.toolButtonText}>{labels.randomize}</Text>
            </Pressable>
            <Pressable onPress={handleClearSetup} style={styles.toolButton}>
              <Text style={styles.toolButtonText}>{labels.clear}</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.statsRow}>
            <View style={styles.statTile}>
              <Text style={styles.statValue}>
                {hits}/{totalTargetCells}
              </Text>
              <Text style={styles.statLabel}>{labels.hits}</Text>
            </View>
            <View style={styles.statTile}>
              <Text style={styles.statValue}>{attemptsLeftText}</Text>
              <Text style={styles.statLabel}>{labels.remaining}</Text>
            </View>
            <View style={styles.statTile}>
              <Text style={styles.statValue}>{shotsTaken}</Text>
              <Text style={styles.statLabel}>{labels.shots}</Text>
            </View>
          </View>
        )}

        <View
          style={[
            styles.resultBanner,
            lastShot?.result === 'hit' && styles.resultBannerHit,
            lastShot?.result === 'miss' && styles.resultBannerMiss,
          ]}
        >
          <Text style={[styles.resultText, lastShot?.result === 'hit' && styles.resultTextHit]}>
            {lastShot?.text ?? statusText}
          </Text>
        </View>

        <BattleshipTargetBoard
          activeGuesses={activeGuesses}
          activeTargets={activeTargets}
          boardCells={boardCells}
          boardShipFrames={boardShipFrames}
          boardWidth={boardWidth}
          cellGap={cellGap}
          cellSize={cellSize}
          dragPoint={dragPoint}
          isCellDisabled={(cellId) =>
            phase === 'battle' &&
            (pendingTurnPass || isGameOver || Boolean(shotAnimation) || activeGuesses.has(cellId))
          }
          isSetupPhase={isSetupPhase}
          modeAccentColor={mode.accentColor}
          onCellPress={handleCellPress}
          onDragMove={handleDragToCell}
          onDragRelease={handleDragRelease}
          previewCells={previewCells}
          previewIsValid={previewIsValid}
          selectedGhostHeight={selectedGhostHeight}
          selectedGhostVisual={selectedGhostVisual}
          selectedGhostWidth={selectedGhostWidth}
          setupTargets={setupTargets}
          shouldStartDragResponder={Boolean(isSetupPhase && selectedTarget)}
          shotAnimation={shotAnimation}
          shotAnimationPosition={shotAnimationPosition}
          shotOpacity={shotOpacity}
          shotScale={shotScale}
          shotTranslateY={shotTranslateY}
        />

        {phase === 'battle' ? (
          <BattleshipOwnBoard
            boardCells={boardCells}
            boardWidth={miniBoardWidth}
            cellGap={cellGap}
            cellSize={miniCellSize}
            incomingGuesses={ownIncomingGuesses}
            metaText={
              attemptsEnabled ? `${ownIncomingGuesses.size}/${MAX_ATTEMPTS}` : ownIncomingGuesses.size
            }
            ownShipFrames={ownShipFrames}
            targets={ownTargets}
          />
        ) : null}
      </LinearGradient>

      {isSetupPhase ? (
        <View style={styles.targetsPanel}>
          <View style={styles.targetsHeader}>
            <Text style={styles.targetPanelMeta}>
              {setupTargets.filter((target) => target.isPlaced).length}/{setupTargets.length}
            </Text>
            <Text style={styles.targetPanelTitle}>{labels.setupFleet}</Text>
          </View>
          {setupTargets.map((target) => (
            <Pressable
              key={target.id}
              onPress={() => pickUpTarget(target.id, target.cells[0])}
              style={[
                styles.targetRow,
                selectedTargetId === target.id && { borderColor: mode.accentColor },
              ]}
            >
              <View style={styles.targetProgress}>
                {Array.from({ length: target.footprint.columns * target.footprint.rows }).map(
                  (_, index) => (
                    <View
                      key={`${target.id}-${index}`}
                      style={[
                        styles.targetDot,
                        target.isPlaced && { backgroundColor: mode.accentColor },
                      ]}
                    />
                  ),
                )}
              </View>
              <View style={styles.targetCopy}>
                <Text style={styles.targetName}>{target.name}</Text>
                <Text style={[styles.targetState, target.isPlaced && styles.targetComplete]}>
                  {target.isPlaced ? labels.placed : labels.unplaced}
                </Text>
              </View>
            </Pressable>
          ))}
          <LuxuryButton
            disabled={!setupFleetReady}
            onPress={confirmSetupFleet}
            title={labels.confirmFleet}
          />
        </View>
      ) : (
        <View style={styles.targetsPanel}>
          <View style={styles.targetsHeader}>
            <Text style={styles.targetPanelMeta}>
              {hits}/{totalTargetCells}
            </Text>
            <Text style={styles.targetPanelTitle}>{labels.targetFleet}</Text>
          </View>
          {activeTargets.map((target) => {
            const revealed = target.cells.filter((cell) => activeGuesses.has(cell)).length;
            const complete = revealed === target.cells.length;

            return (
              <View key={target.id} style={styles.targetRow}>
                <View style={styles.targetProgress}>
                  {target.cells.map((cell, index) => (
                    <View
                      key={cell}
                      style={[
                        styles.targetDot,
                        index < revealed && { backgroundColor: mode.accentColor },
                        complete && styles.targetDotComplete,
                      ]}
                    />
                  ))}
                </View>
                <View style={styles.targetCopy}>
                  <Text style={styles.targetName}>{target.name}</Text>
                  <Text style={[styles.targetState, complete && styles.targetComplete]}>
                    {complete
                      ? labels.sunk
                      : `${revealed}/${target.cells.length} ${labels.waiting}`}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {phase === 'battle' ? (
        pendingTurnPass ? (
          <LuxuryButton onPress={passTurn} title={labels.passTurn} />
        ) : (
          <LuxuryButton onPress={() => resetGame()} title={labels.newRound} />
        )
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  backButton: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backText: {
    color: colors.goldSoft,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    writingDirection: 'rtl',
  },
  headerCopy: {
    flex: 1,
  },
  kicker: {
    color: colors.gold,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: typography.weights.black,
    lineHeight: 36,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: typography.sizes.body,
    lineHeight: 22,
    marginTop: spacing.xs,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  modeSwitch: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  modeButton: {
    backgroundColor: 'rgba(255,255,255,0.065)',
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  modeText: {
    color: colors.textMuted,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  modeTextActive: {
    color: colors.text,
  },
  soundToggle: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  soundToggleText: {
    color: colors.goldSoft,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  handoffPanel: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderColor: colors.borderGold,
    borderRadius: radius.xl,
    borderWidth: 1,
    gap: spacing.md,
    marginTop: spacing.xxxl,
    padding: spacing.xl,
  },
  handoffKicker: {
    color: colors.gold,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  handoffTitle: {
    color: colors.text,
    fontSize: typography.sizes.headline,
    fontWeight: typography.weights.black,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  handoffText: {
    color: colors.textMuted,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  victoryPanel: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderColor: colors.borderGold,
    borderRadius: radius.xl,
    borderWidth: 1,
    gap: spacing.md,
    marginTop: spacing.xl,
    padding: spacing.xl,
  },
  victoryTitle: {
    color: colors.goldSoft,
    fontSize: typography.sizes.headline,
    fontWeight: typography.weights.black,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  victoryText: {
    color: colors.text,
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.bold,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  victoryStats: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  victoryStat: {
    backgroundColor: 'rgba(0,0,0,0.16)',
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    padding: spacing.md,
  },
  ruleOption: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.16)',
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  ruleOptionActive: {
    borderColor: colors.borderGold,
  },
  ruleOptionTitle: {
    color: colors.text,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  ruleOptionMeta: {
    color: colors.goldSoft,
    fontSize: typography.sizes.title,
    fontWeight: typography.weights.black,
  },
  boardCard: {
    alignItems: 'center',
    borderColor: 'rgba(117, 191, 255, 0.26)',
    borderRadius: radius.xl,
    borderWidth: 1,
    marginBottom: spacing.lg,
    overflow: 'hidden',
    padding: spacing.md,
  },
  boardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    width: '100%',
  },
  turnBadge: {
    backgroundColor: 'rgba(255,255,255,0.075)',
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    maxWidth: '58%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  turnBadgeText: {
    color: colors.goldSoft,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  boardLabel: {
    color: colors.text,
    flexShrink: 1,
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  setupActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
    width: '100%',
  },
  toolButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    paddingVertical: spacing.sm,
  },
  toolButtonDisabled: {
    opacity: 0.45,
  },
  toolButtonText: {
    color: colors.text,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    writingDirection: 'rtl',
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
    width: '100%',
  },
  statTile: {
    backgroundColor: 'rgba(3, 12, 23, 0.46)',
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  statValue: {
    color: colors.text,
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.black,
    textAlign: 'center',
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    marginTop: 2,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  resultBanner: {
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderColor: 'rgba(255,255,255,0.11)',
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    marginBottom: spacing.md,
    minHeight: 42,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    width: '100%',
  },
  resultBannerHit: {
    backgroundColor: 'rgba(75,163,255,0.15)',
    borderColor: 'rgba(75,163,255,0.34)',
  },
  resultBannerMiss: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: 'rgba(255,255,255,0.09)',
  },
  resultText: {
    color: colors.textMuted,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  resultTextHit: {
    color: colors.text,
  },
  targetsPanel: {
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    marginBottom: spacing.lg,
    padding: spacing.md,
  },
  targetsHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  targetPanelTitle: {
    color: colors.text,
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  targetPanelMeta: {
    color: colors.goldSoft,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
  },
  targetRow: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.12)',
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.sm,
  },
  targetProgress: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    maxWidth: 116,
  },
  targetDot: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderColor: 'rgba(255,255,255,0.13)',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 10,
    width: 10,
  },
  targetDotComplete: {
    backgroundColor: colors.emerald,
    borderColor: 'rgba(255,255,255,0.36)',
  },
  targetCopy: {
    flex: 1,
    marginLeft: spacing.md,
  },
  targetName: {
    color: colors.text,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  targetState: {
    color: colors.textMuted,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    marginTop: 2,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  targetComplete: {
    color: colors.emerald,
  },
});
