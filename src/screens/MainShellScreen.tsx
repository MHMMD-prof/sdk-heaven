import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { BottomNavigationBar } from '../components/BottomNavigationBar';
import { usePushNotificationCoordinator } from '../notifications/usePushNotificationCoordinator';
import { useSocialFeatureFlags } from '../social/useSocialFeatureFlags';
import { MainTabKey, RootStackParamList } from '../types/navigation';

type MainShellScreenProps = NativeStackScreenProps<RootStackParamList, 'Main'>;

export function MainShellScreen({ navigation }: MainShellScreenProps) {
  const { user } = useAuth();
  const flags = useSocialFeatureFlags();
  const [activeTab, setActiveTab] = useState<MainTabKey>('home');
  usePushNotificationCoordinator({ enabled: flags.pushNotifications, navigation, uid: user?.uid });
  const bottomNavigation = useMemo(
    () => <BottomNavigationBar activeTab={activeTab} onTabPress={setActiveTab} />,
    [activeTab],
  );

  if (activeTab === 'games') {
    const { GamesScreen } = require('./GamesScreen') as typeof import('./GamesScreen');

    return <GamesScreen bottomNavigation={bottomNavigation} navigation={navigation} />;
  }

  if (activeTab === 'groups') {
    const { GroupsScreen } = require('./GroupsScreen') as typeof import('./GroupsScreen');

    return <GroupsScreen bottomNavigation={bottomNavigation} navigation={navigation} />;
  }

  if (activeTab === 'me') {
    const { MeProfileScreen } = require('./MeProfileScreen') as typeof import('./MeProfileScreen');

    return (
      <MeProfileScreen
        bottomNavigation={bottomNavigation}
        navigation={navigation}
      />
    );
  }

  const { HomeScreen } = require('./HomeScreen') as typeof import('./HomeScreen');

  return (
    <HomeScreen
      bottomNavigation={bottomNavigation}
      onOpenProfile={() => setActiveTab('me')}
      onOpenVoiceRoom={(roomId) => navigation.navigate('VoiceRoom', { roomId })}
    />
  );
}
