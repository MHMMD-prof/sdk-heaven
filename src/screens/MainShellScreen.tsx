import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';

import { BottomNavigationBar } from '../components/BottomNavigationBar';
import { MainTabKey, RootStackParamList } from '../types/navigation';
import { GamesScreen } from './GamesScreen';
import { GroupsScreen } from './GroupsScreen';
import { HomeScreen } from './HomeScreen';

type MainShellScreenProps = NativeStackScreenProps<RootStackParamList, 'Main'>;

export function MainShellScreen({ navigation }: MainShellScreenProps) {
  const [activeTab, setActiveTab] = useState<MainTabKey>('home');
  const bottomNavigation = useMemo(
    () => <BottomNavigationBar activeTab={activeTab} onTabPress={setActiveTab} />,
    [activeTab],
  );

  if (activeTab === 'games') {
    return <GamesScreen bottomNavigation={bottomNavigation} navigation={navigation} />;
  }

  if (activeTab === 'groups') {
    return <GroupsScreen bottomNavigation={bottomNavigation} navigation={navigation} />;
  }

  return (
    <HomeScreen
      bottomNavigation={bottomNavigation}
      onOpenAccountSettings={() => navigation.navigate('AccountSettings')}
      onOpenGames={() => setActiveTab('games')}
      onOpenGroups={() => setActiveTab('groups')}
    />
  );
}
