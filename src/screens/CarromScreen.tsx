import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { CarromBoardOverlays } from '../components/CarromBoardOverlays';
import {
  CARROM_BOARD_VISIBLE_HEIGHT_RATIO,
  CarromSkiaBoard,
  CarromSkiaBoardHandle,
} from '../components/CarromSkiaBoard';
import {
  CarromControlDock,
  CarromHeader,
  CarromPlayerRail,
  CarromSettingsRail,
  CarromShotHistoryPanel,
} from '../components/CarromHudControls';
import { ReadyCountdownPanel, TableSelection } from '../components/CarromMatchFlow';
import { ScreenContainer } from '../components/ScreenContainer';
import { useCarromAudio } from '../hooks/useCarromAudio';
import { useCarromEffects } from '../hooks/useCarromEffects';
import { useCarromGameplay } from '../hooks/useCarromGameplay';
import { useLocalCarromMatch } from '../hooks/useLocalCarromMatch';
import { CarromDisc, CarromGameState, CarromPlayer } from '../types/carrom';
import { RootStackParamList } from '../types/navigation';
import {
  ShotHistoryItem,
  createShotHistoryItem,
  createPocketSparkles,
  getEventTone,
  getRemainingCoinCounts,
  prependShotHistoryItem,
  shouldShowEventBanner,
} from '../utils/carromPresentation';
import { CARROM_WORLD_SIZE } from '../utils/carromEngine';

const boardImage = require('../../assets/carrom/board-royal-majlis-v3.png');
const SHOW_CARROM_DEBUG_OVERLAY = false;
const MATCH_COUNTDOWN_SECONDS = 3;
const SHOW_CARROM_PERF_OVERLAY = false;

type CarromScreenProps = NativeStackScreenProps<RootStackParamList, 'Carrom'>;

export function CarromScreen({ navigation }: CarromScreenProps) {
  const { height, width } = useWindowDimensions();
  const isCompactPhone = height < 720 || width < 380;
  const contentWidth = Math.min(width, 680);
  const boardSize = Math.min(
    contentWidth,
    height * (isCompactPhone ? 0.59 : 0.55),
    620,
  );
  const scale = boardSize / CARROM_WORLD_SIZE;
  const visibleBoardHeight = boardSize * CARROM_BOARD_VISIBLE_HEIGHT_RATIO;
  const boardRef = useRef<CarromSkiaBoardHandle>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [aimAssistEnabled, setAimAssistEnabled] = useState(true);
  const [effectsEnabled, setEffectsEnabled] = useState(true);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [shotHistory, setShotHistory] = useState<ShotHistoryItem[]>([]);
  const { playFoul, playHit, playPocket, playWin } = useCarromAudio(soundEnabled);
  const {
    clearPendingShot,
    confirmReady,
    countdown,
    handleResetPress: handleMatchResetPress,
    leaveTable,
    matchError,
    matchPhase,
    matchSessionRef,
    opponentReady,
    playerReady,
    prepareRound: prepareMatchRound,
    resolvePendingShot,
    selectedTable,
    selectTable,
    submitShot,
  } = useLocalCarromMatch({ countdownSeconds: MATCH_COUNTDOWN_SECONDS });
  const lastShotPlayerRef = useRef<CarromPlayer>(1);
  const pocketedShotDiscsRef = useRef<CarromDisc[]>([]);
  const pocketedShotIdsRef = useRef<Set<string>>(new Set());
  const clearCollectedPocketedDiscs = useCallback(() => {
    pocketedShotDiscsRef.current = [];
    pocketedShotIdsRef.current.clear();
  }, []);
  const handleShotStarted = useCallback((player: CarromPlayer) => {
    clearCollectedPocketedDiscs();
    lastShotPlayerRef.current = player;
  }, [clearCollectedPocketedDiscs]);
  const {
    baselineY,
    game,
    isMoving,
    panHandlers,
    perfDurationMs,
    perfFps,
    perfFrames,
    perfMaxSteps,
    perfPhase,
    perfSteps,
    perfWorstFrameMs,
    reset: resetGameplay,
  } = useCarromGameplay({
    boardRef,
    clearPendingShot,
    matchHealthy: !matchError,
    matchSessionRef,
    onShotStarted: handleShotStarted,
    playHit,
    scale,
    showPerfOverlay: SHOW_CARROM_PERF_OVERLAY,
    submitShot,
  });
  const {
    pocketSparkles,
    showPocketSparkles,
    showTurnBanner,
    turnBanner,
    winProgress,
  } = useCarromEffects({ effectsEnabled, gameStatus: game.status });
  const previousStatusRef = useRef<CarromGameState['status']>(game.status);
  const collectPocketedDiscs = useCallback((pocketedDiscs: CarromDisc[]) => {
    const pocketedShotIds = pocketedShotIdsRef.current;
    const pocketedShotDiscs = pocketedShotDiscsRef.current;

    for (let index = 0; index < pocketedDiscs.length; index += 1) {
      const disc = pocketedDiscs[index]!;

      if (pocketedShotIds.has(disc.id)) {
        continue;
      }

      pocketedShotIds.add(disc.id);
      pocketedShotDiscs.push(disc);
    }
  }, []);

  useEffect(() => {
    const previousStatus = previousStatusRef.current;

    if (game.status === 'moving' && game.pocketedThisTurn.length > 0) {
      collectPocketedDiscs(game.pocketedThisTurn);
    }

    if (previousStatus === 'moving' && game.status !== 'moving') {
      const pocketedShotDiscs = pocketedShotDiscsRef.current;

      if (pocketedShotDiscs.length > 0) {
        playPocket();

        if (effectsEnabled) {
          showPocketSparkles(createPocketSparkles(pocketedShotDiscs));
        }
      }

      resolvePendingShot(game);

      setShotHistory((current) =>
        prependShotHistoryItem(
          current,
          createShotHistoryItem(game, lastShotPlayerRef.current, pocketedShotDiscs),
        ),
      );
      clearCollectedPocketedDiscs();

      if (game.status === 'gameOver') {
        playWin();
      } else if (game.message.includes('خطأ')) {
        playFoul();
      } else {
        showTurnBanner(game.currentPlayer);
      }
    }

    previousStatusRef.current = game.status;
  }, [
    game.currentPlayer,
    game.message,
    game.pocketedThisTurn,
    game.status,
    clearCollectedPocketedDiscs,
    collectPocketedDiscs,
    effectsEnabled,
    playFoul,
    playPocket,
    playWin,
    resolvePendingShot,
    showPocketSparkles,
    showTurnBanner,
  ]);

  const reset = () => {
    const next = resetGameplay();

    clearCollectedPocketedDiscs();
    lastShotPlayerRef.current = next.currentPlayer;
    previousStatusRef.current = next.status;
    setShotHistory([]);
    setHistoryExpanded(false);
  };

  const prepareRound = () => {
    clearCollectedPocketedDiscs();
    prepareMatchRound(reset);
  };

  const handleResetPress = () => {
    handleMatchResetPress(reset);
  };

  const eventTone = getEventTone(game.message, game.status);
  const showEventBanner = !isMoving && shouldShowEventBanner(game);
  const remaining = useMemo(() => getRemainingCoinCounts(game), [game.discs, game.playerCoins]);
  const blackPlayer: CarromPlayer = game.playerCoins[1] === 'black' ? 1 : 2;
  const whitePlayer: CarromPlayer = blackPlayer === 1 ? 2 : 1;

  return (
    <ScreenContainer
      decorativeGlows={false}
      horizontalPadding={0}
      scroll={false}
      topPadding={0}
      variant="ruby"
    >
      <View style={styles.page}>
      <CarromHeader
        onBack={() => navigation.goBack()}
        onReset={handleResetPress}
        title="كاروم ملكي"
      />

      {matchPhase === 'tableSelect' ? (
        <TableSelection
          compact={isCompactPhone}
          onBack={() => navigation.goBack()}
          onSelect={(table) => selectTable(table, reset)}
        />
      ) : (
        <>
          {matchPhase !== 'live' && matchPhase !== 'settled' && selectedTable ? (
            <ReadyCountdownPanel
              countdown={countdown}
              opponentReady={opponentReady}
              onLeave={() => leaveTable(reset)}
              onReady={confirmReady}
              phase={matchPhase}
              playerReady={playerReady}
              table={selectedTable}
            />
          ) : null}

          {matchPhase === 'live' || matchPhase === 'settled' ? (
            <>
      <CarromPlayerRail
        compact={isCompactPhone}
        currentPlayer={game.currentPlayer}
        playerCoins={game.playerCoins}
        remaining={remaining}
        scores={game.scores}
      />

      <CarromSettingsRail
        aimAssistEnabled={aimAssistEnabled}
        compact={isCompactPhone}
        effectsEnabled={effectsEnabled}
        onToggleAimAssist={() => setAimAssistEnabled((enabled) => !enabled)}
        onToggleEffects={() => setEffectsEnabled((enabled) => !enabled)}
        onToggleSound={() => setSoundEnabled((enabled) => !enabled)}
        soundEnabled={soundEnabled}
      />

      <View style={[styles.matchArea, { height: visibleBoardHeight }]}>
        <CarromSkiaBoard
          ref={boardRef}
          aimAssistEnabled={aimAssistEnabled}
          baselineY={baselineY}
          boardImage={boardImage}
          boardSize={boardSize}
          discs={game.discs}
          effectsEnabled={effectsEnabled}
          isMoving={isMoving}
          scale={scale}
          showDebugOverlay={SHOW_CARROM_DEBUG_OVERLAY}
          touchHandlers={panHandlers}
        >
          <CarromBoardOverlays
            compact={isCompactPhone}
            effectsEnabled={effectsEnabled}
            eventTone={eventTone}
            game={game}
            isMoving={isMoving}
            onBackToGames={() => navigation.goBack()}
            onNewRound={prepareRound}
            perfFps={perfFps}
            perfDurationMs={perfDurationMs}
            perfFrames={perfFrames}
            perfMaxSteps={perfMaxSteps}
            perfPhase={perfPhase}
            perfSteps={perfSteps}
            perfWorstFrameMs={perfWorstFrameMs}
            pocketSparkles={pocketSparkles}
            scale={scale}
            showEventBanner={showEventBanner}
            showPerfOverlay={SHOW_CARROM_PERF_OVERLAY}
            turnBanner={turnBanner}
            winProgress={winProgress}
            winActionsEnabled={matchPhase === 'settled'}
          />
        </CarromSkiaBoard>
      </View>

      <CarromControlDock
        blackRemaining={remaining[blackPlayer]}
        compact={isCompactPhone}
        queenPocketed={game.queen.pocketed}
        whiteRemaining={remaining[whitePlayer]}
      />

      <CarromShotHistoryPanel
        compact={isCompactPhone}
        expanded={historyExpanded}
        items={shotHistory}
        notice={matchError ?? undefined}
        onToggle={() => setHistoryExpanded((expanded) => !expanded)}
      />
            </>
          ) : null}
        </>
      )}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  page: {
    alignSelf: 'center',
    flex: 1,
    maxWidth: 680,
    width: '100%',
  },
  matchArea: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },

});
