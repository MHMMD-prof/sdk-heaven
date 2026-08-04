import { NativeStackScreenProps } from '@react-navigation/native-stack';
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
import { BattleshipPreMatchPanel } from '../battleship/BattleshipPreMatchPanel';
import { BattleshipVictoryPanel } from '../battleship/BattleshipVictoryPanel';
import { useBattleshipScreenModel } from '../battleship/useBattleshipScreenModel';
import { RootStackParamList } from '../types/navigation';
import { useLeaveRoomGameOnExit } from '../voice/useLeaveRoomGameOnExit';

type MiniGameScreenProps = NativeStackScreenProps<RootStackParamList, 'MiniGame'>;
export function MiniGameScreen({ navigation, route }: MiniGameScreenProps) {
  useLeaveRoomGameOnExit(route.params ?? {});
  const initialMode = route.params?.initialMode ?? 'naval';
  const { width } = useWindowDimensions();
  const screenModel = useBattleshipScreenModel({
    initialMode,
    onBack: () => navigation.goBack(),
    screenWidth: width,
  });

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
