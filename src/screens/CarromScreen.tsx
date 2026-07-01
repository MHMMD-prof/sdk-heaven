import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { CarromBoardOverlays } from '../components/CarromBoardOverlays';
import { CarromSkiaBoard, CarromSkiaBoardHandle } from '../components/CarromSkiaBoard';
import {
  CarromControlDock,
  CarromHeader,
  CarromPlayerRail,
  CarromSettingsRail,
  CarromShotHistoryPanel,
  CarromStrikerSlider,
  CarromStrikerSliderHandle,
} from '../components/CarromHudControls';
import { ReadyCountdownPanel, TableSelection } from '../components/CarromMatchFlow';
import { ScreenContainer } from '../components/ScreenContainer';
import { useCarromAudio } from '../hooks/useCarromAudio';
import { useCarromEffects } from '../hooks/useCarromEffects';
import { useCarromGameplay } from '../hooks/useCarromGameplay';
import { useLocalCarromMatch } from '../hooks/useLocalCarromMatch';
import { radius, spacing } from '../theme';
import { CarromGameState, CarromPlayer } from '../types/carrom';
import { RootStackParamList } from '../types/navigation';
import {
  ShotHistoryItem,
  createShotHistoryItem,
  getEventTone,
  getPowerTone,
  getQueenLabel,
  getStatusSubtitle,
  getStatusText,
  shouldShowEventBanner,
} from '../utils/carromPresentation';
import { CARROM_WORLD_SIZE } from '../utils/carromEngine';

const boardImage = require('../../assets/carrom/board-good.png');
const SHOW_CARROM_DEBUG_OVERLAY = false;
const MATCH_COUNTDOWN_SECONDS = 3;
const SHOW_CARROM_PERF_OVERLAY = false;

type CarromScreenProps = NativeStackScreenProps<RootStackParamList, 'Carrom'>;

export function CarromScreen({ navigation }: CarromScreenProps) {
  const { height, width } = useWindowDimensions();
  const isCompactPhone = height < 720 || width < 380;
  const boardSize = Math.min(
    width - spacing.sm * 2,
    height * (isCompactPhone ? 0.56 : 0.68),
    isCompactPhone ? 560 : 650,
  );
  const scale = boardSize / CARROM_WORLD_SIZE;
  const boardRef = useRef<CarromSkiaBoardHandle>(null);
  const sliderRef = useRef<CarromStrikerSliderHandle>(null);
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
  const handleShotStarted = useCallback((player: CarromPlayer) => {
    lastShotPlayerRef.current = player;
  }, []);
  const {
    aimAngle,
    aimDots,
    aimLength,
    aimReach,
    baselineY,
    game,
    isMoving,
    panHandlers,
    perfFps,
    perfSteps,
    perfWorstFrameMs,
    powerPercent,
    reset: resetGameplay,
    shotGuide,
    sliderPanHandlers,
    sliderProgress,
    sliderWidth,
    striker,
  } = useCarromGameplay({
    boardRef,
    boardSize,
    clearPendingShot,
    isCompactPhone,
    matchHealthy: !matchError,
    matchSessionRef,
    onShotStarted: handleShotStarted,
    playHit,
    scale,
    screenWidth: width,
    showPerfOverlay: SHOW_CARROM_PERF_OVERLAY,
    sliderRef,
    submitShot,
  });
  const {
    pocketSparkles,
    queenPulse,
    resetEffects,
    showPocketSparkles,
    showTurnBanner,
    turnBanner,
    winProgress,
  } = useCarromEffects({ effectsEnabled, gameStatus: game.status });
  const previousStatusRef = useRef<CarromGameState['status']>(game.status);
  const pocketedSoundIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    const newPocketedDiscs = game.pocketedThisTurn.filter(
      (disc) => !pocketedSoundIdsRef.current.has(disc.id),
    );

    if (newPocketedDiscs.length > 0) {
      game.pocketedThisTurn.forEach((disc) => pocketedSoundIdsRef.current.add(disc.id));
      playPocket();
      showPocketSparkles(
        newPocketedDiscs.map((disc) => ({
          id: disc.id,
          tone: disc.kind === 'queen' ? 'queen' : disc.kind === 'striker' ? 'striker' : 'coin',
          x: disc.x,
          y: disc.y,
        })),
      );
    }

    if (previousStatus === 'moving' && game.status !== 'moving') {
      pocketedSoundIdsRef.current.clear();
      resolvePendingShot(game);

      setShotHistory((current) =>
        [
          createShotHistoryItem(game, lastShotPlayerRef.current),
          ...current,
        ].slice(0, 8),
      );

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
    playFoul,
    playPocket,
    playWin,
    resolvePendingShot,
    showPocketSparkles,
    showTurnBanner,
  ]);

  const reset = () => {
    const next = resetGameplay();

    pocketedSoundIdsRef.current.clear();
    lastShotPlayerRef.current = next.currentPlayer;
    previousStatusRef.current = next.status;
    setShotHistory([]);
    setHistoryExpanded(false);
  };

  const prepareRound = () => {
    prepareMatchRound(reset);
  };

  const handleResetPress = () => {
    handleMatchResetPress(reset);
  };

  const statusText = getStatusText(game);
  const eventTone = getEventTone(game.message, game.status);
  const showEventBanner = !isMoving && shouldShowEventBanner(game);
  const remaining = {
    1: game.discs.filter((disc) => disc.kind === game.playerCoins[1] && !disc.pocketed).length,
    2: game.discs.filter((disc) => disc.kind === game.playerCoins[2] && !disc.pocketed).length,
  };

  const powerTone = getPowerTone(powerPercent);

  return (
    <ScreenContainer
      horizontalPadding={isCompactPhone ? spacing.xs : spacing.sm}
      scroll={false}
      topPadding={isCompactPhone ? 0 : spacing.xs}
    >
      <CarromHeader
        compact={isCompactPhone}
        kicker="نموذج لعب محلي"
        onBack={() => navigation.goBack()}
        onReset={handleResetPress}
        title="كاروم رويال"
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
        moving={game.status === 'moving'}
        playerCoins={game.playerCoins}
        queenLabel={getQueenLabel(game)}
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

      <View style={styles.matchArea}>
        <View
          style={[
            styles.boardGlow,
            {
              height: boardSize + (isCompactPhone ? 10 : 16),
              width: boardSize + (isCompactPhone ? 10 : 16),
            },
          ]}
        />
        <CarromSkiaBoard
          ref={boardRef}
          aimAngle={aimAngle}
          aimAssistEnabled={aimAssistEnabled}
          aimDots={aimDots}
          aimLength={aimLength}
          aimReach={aimReach}
          baselineY={baselineY}
          boardImage={boardImage}
          boardSize={boardSize}
          discs={game.discs}
          effectsEnabled={effectsEnabled}
          isMoving={isMoving}
          powerPercent={powerPercent}
          powerTone={powerTone}
          scale={scale}
          shotGuide={shotGuide}
          showDebugOverlay={SHOW_CARROM_DEBUG_OVERLAY}
          striker={striker}
          touchHandlers={panHandlers}
        >
          <CarromBoardOverlays
            aimAngle={aimAngle}
            aimAssistEnabled={aimAssistEnabled}
            aimDots={aimDots}
            aimLength={aimLength}
            aimReach={aimReach}
            baselineY={baselineY}
            boardSize={boardSize}
            compact={isCompactPhone}
            effectsEnabled={effectsEnabled}
            eventTone={eventTone}
            game={game}
            isMoving={isMoving}
            onBackToGames={() => navigation.goBack()}
            onNewRound={prepareRound}
            perfFps={perfFps}
            perfSteps={perfSteps}
            perfWorstFrameMs={perfWorstFrameMs}
            pocketSparkles={pocketSparkles}
            powerPercent={powerPercent}
            powerTone={powerTone}
            scale={scale}
            shotGuide={shotGuide}
            showEventBanner={showEventBanner}
            showPerfOverlay={SHOW_CARROM_PERF_OVERLAY}
            striker={striker}
            turnBanner={turnBanner}
            winProgress={winProgress}
            winActionsEnabled={matchPhase === 'settled'}
          />
        </CarromSkiaBoard>
      </View>

      {game.status === 'placing' ? (
        <CarromStrikerSlider
          ref={sliderRef}
          panHandlers={sliderPanHandlers}
          progress={sliderProgress}
          width={sliderWidth}
        />
      ) : null}

      <CarromControlDock
        compact={isCompactPhone}
        statusSubtitle={matchError ?? getStatusSubtitle(game)}
        statusText={statusText}
      />

      <CarromShotHistoryPanel
        compact={isCompactPhone}
        expanded={historyExpanded}
        items={shotHistory}
        onToggle={() => setHistoryExpanded((expanded) => !expanded)}
      />
            </>
          ) : null}
        </>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  matchArea: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    minHeight: 0,
  },
  boardGlow: {
    backgroundColor: 'rgba(25, 173, 154, 0.13)',
    borderRadius: radius.xl,
    position: 'absolute',
    shadowColor: '#00D5C7',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 28,
  },

});
