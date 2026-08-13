import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback } from 'react';
import {
  useWindowDimensions,
} from 'react-native';

import { LuxuryButton } from '../components/LuxuryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { BattleshipBoardCard } from '../battleship/BattleshipBoardCard';
import { BattleshipConfirmDialog } from '../battleship/BattleshipConfirmDialog';
import { BattleshipFleetPanel } from '../battleship/BattleshipFleetPanel';
import { BattleshipHandoffPanel } from '../battleship/BattleshipHandoffPanel';
import { BattleshipHeader } from '../battleship/BattleshipHeader';
import { BattleshipOnlineLobbyPanel } from '../battleship/BattleshipOnlineLobbyPanel';
import { BattleshipPreMatchPanel } from '../battleship/BattleshipPreMatchPanel';
import { BattleshipVictoryPanel } from '../battleship/BattleshipVictoryPanel';
import { useBattleshipOnlineBattleView } from '../battleship/online/useBattleshipOnlineBattleView';
import { useBattleshipOnlineSession } from '../battleship/online/useBattleshipOnlineSession';
import { resolveBattleshipLaunch } from '../battleship/resolveBattleshipLaunch';
import { useBattleshipScreenModel } from '../battleship/useBattleshipScreenModel';
import { MiniGameTarget } from '../types/miniGame';
import { RootStackParamList } from '../types/navigation';
import { useLeaveRoomGameOnExit } from '../voice/useLeaveRoomGameOnExit';
import { useRoomGameSession } from '../voice/useRoomGameSession';

type MiniGameScreenProps = NativeStackScreenProps<RootStackParamList, 'MiniGame'>;
export function MiniGameScreen({ navigation, route }: MiniGameScreenProps) {
  useLeaveRoomGameOnExit(route.params ?? {});
  const launch = resolveBattleshipLaunch(route.params);
  const { width } = useWindowDimensions();
  const { session: roomGameSession } = useRoomGameSession(
    launch.isOnline ? launch.roomId : undefined,
    launch.isOnline,
  );
  const {
    fireShot,
    lobby: onlineLobby,
    sealLocalFleet,
    state: onlineState,
  } = useBattleshipOnlineSession({
    enabled: launch.isOnline,
    firestoreMaxPlayers: roomGameSession?.maxPlayers,
    firestorePlayerCount: roomGameSession?.playerCount,
    firestoreStatus: roomGameSession?.status,
    launch,
  });
  const handleOnlineFleetConfirmed = useCallback(
    (targets: MiniGameTarget[]) => {
      void sealLocalFleet(targets);
    },
    [sealLocalFleet],
  );
  const screenModel = useBattleshipScreenModel({
    initialMode: launch.initialMode,
    onBack: () => navigation.goBack(),
    onOnlineFleetConfirmed: launch.isOnline ? handleOnlineFleetConfirmed : undefined,
    persistenceEnabled: !launch.isOnline,
    screenWidth: width,
    skipPreMatch: launch.isOnline,
  });
  const onlineBattle = useBattleshipOnlineBattleView({
    fireShot,
    onBack: () => navigation.goBack(),
    screenWidth: width,
    state: onlineState,
  });

  if (launch.isOnline) {
    if (onlineState.phase === 'placement' && !onlineState.localReady) {
      return (
        <ScreenContainer scrollEnabled={screenModel.scrollEnabled}>
          <BattleshipHeader {...screenModel.headerProps} />
          <BattleshipBoardCard {...screenModel.boardCardProps} />
          <BattleshipFleetPanel {...screenModel.fleetPanelProps} />
          <BattleshipConfirmDialog {...screenModel.confirmDialogProps} />
        </ScreenContainer>
      );
    }

    if (onlineState.phase === 'battle') {
      if (!onlineState.opponentConnected && !onlineBattle.isGameOver) {
        return (
          <ScreenContainer>
            <BattleshipOnlineLobbyPanel
              body={onlineLobby.body}
              eyebrow={onlineLobby.eyebrow}
              leaveLabel={onlineLobby.leaveLabel}
              matchIdLabel={onlineLobby.matchIdLabel}
              onLeave={() => navigation.goBack()}
              playerCountLabel={onlineLobby.playerCountLabel}
              readyStatusLabel={onlineLobby.readyStatusLabel}
              roleLabel={onlineLobby.roleLabel}
              sessionStatusLabel={onlineLobby.sessionStatusLabel}
              title={onlineLobby.title}
              transportStatusLabel={onlineLobby.transportStatusLabel}
            />
          </ScreenContainer>
        );
      }

      if (onlineBattle.isGameOver) {
        return (
          <ScreenContainer>
            <BattleshipVictoryPanel {...onlineBattle.victoryProps} />
          </ScreenContainer>
        );
      }

      return (
        <ScreenContainer>
          <BattleshipHeader {...onlineBattle.headerProps} />
          <BattleshipBoardCard {...onlineBattle.boardCardProps} />
        </ScreenContainer>
      );
    }

    return (
      <ScreenContainer>
        <BattleshipOnlineLobbyPanel
          body={onlineLobby.body}
          eyebrow={onlineLobby.eyebrow}
          leaveLabel={onlineLobby.leaveLabel}
          matchIdLabel={onlineLobby.matchIdLabel}
          onLeave={() => navigation.goBack()}
          playerCountLabel={onlineLobby.playerCountLabel}
          readyStatusLabel={onlineLobby.readyStatusLabel}
          roleLabel={onlineLobby.roleLabel}
          sessionStatusLabel={onlineLobby.sessionStatusLabel}
          title={onlineLobby.title}
          transportStatusLabel={onlineLobby.transportStatusLabel}
        />
      </ScreenContainer>
    );
  }

  if (screenModel.phase === 'handoff-to-player-2' || screenModel.phase === 'turn-handoff') {
    return (
      <ScreenContainer>
        <BattleshipHandoffPanel
          key={`${screenModel.phase}-${screenModel.handoffProps.player}`}
          {...screenModel.handoffProps}
        />
        <BattleshipConfirmDialog {...screenModel.confirmDialogProps} />
      </ScreenContainer>
    );
  }

  if (screenModel.phase === 'pre-match') {
    return (
      <ScreenContainer>
        <BattleshipPreMatchPanel {...screenModel.preMatchProps} />
        <BattleshipConfirmDialog {...screenModel.confirmDialogProps} />
      </ScreenContainer>
    );
  }

  if (screenModel.isBattleGameOver) {
    return (
      <ScreenContainer>
        <BattleshipVictoryPanel {...screenModel.victoryProps} />
        <BattleshipConfirmDialog {...screenModel.confirmDialogProps} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer scrollEnabled={screenModel.scrollEnabled}>
      <BattleshipHeader {...screenModel.headerProps} />
      <BattleshipBoardCard {...screenModel.boardCardProps} />
      <BattleshipFleetPanel {...screenModel.fleetPanelProps} />
      {screenModel.footerAction ? <LuxuryButton {...screenModel.footerAction} /> : null}
      <BattleshipConfirmDialog {...screenModel.confirmDialogProps} />
    </ScreenContainer>
  );
}
