import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  useWindowDimensions,
} from 'react-native';

import { LuxuryButton } from '../components/LuxuryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { BattleshipBoardCard } from '../battleship/BattleshipBoardCard';
import { BattleshipFleetPanel } from '../battleship/BattleshipFleetPanel';
import { BattleshipHandoffPanel } from '../battleship/BattleshipHandoffPanel';
import { BattleshipHeader } from '../battleship/BattleshipHeader';
import { BattleshipPreMatchPanel } from '../battleship/BattleshipPreMatchPanel';
import { BattleshipVictoryPanel } from '../battleship/BattleshipVictoryPanel';
import { useBattleshipScreenModel } from '../battleship/useBattleshipScreenModel';
import { RootStackParamList } from '../types/navigation';

type MiniGameScreenProps = NativeStackScreenProps<RootStackParamList, 'MiniGame'>;
export function MiniGameScreen({ navigation, route }: MiniGameScreenProps) {
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
        <BattleshipHandoffPanel {...screenModel.handoffProps} />
      </ScreenContainer>
    );
  }

  if (screenModel.phase === 'pre-match') {
    return (
      <ScreenContainer>
        <BattleshipPreMatchPanel {...screenModel.preMatchProps} />
      </ScreenContainer>
    );
  }

  if (screenModel.isBattleGameOver) {
    return (
      <ScreenContainer>
        <BattleshipVictoryPanel {...screenModel.victoryProps} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer scrollEnabled={screenModel.scrollEnabled}>
      <BattleshipHeader {...screenModel.headerProps} />
      <BattleshipBoardCard {...screenModel.boardCardProps} />
      <BattleshipFleetPanel {...screenModel.fleetPanelProps} />
      {screenModel.footerAction ? <LuxuryButton {...screenModel.footerAction} /> : null}
    </ScreenContainer>
  );
}
