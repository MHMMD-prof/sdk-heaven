import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { useAuth } from '../auth/AuthProvider';
import { BottomNavigationBar } from '../components/BottomNavigationBar';
import { DailyLoginHomeCard, DailyLoginRewardSheet } from '../dailyLogin/DailyLoginRewardsUi';
import { useDailyLoginRewards } from '../dailyLogin/useDailyLoginRewards';
import { EventsHomeStrip } from '../opsEvents/EventsHomeStrip';
import { usePushNotificationCoordinator } from '../notifications/usePushNotificationCoordinator';
import { useDirectChats } from '../personalChat/DirectChatProvider';
import { parseDirectChatLink } from '../personalChat/directChatLinks';
import { useSocialFeatureFlags } from '../social/useSocialFeatureFlags';
import { MainTabKey, RootStackParamList } from '../types/navigation';

type MainShellScreenProps = NativeStackScreenProps<RootStackParamList, 'Main'>;

export function MainShellScreen({ navigation }: MainShellScreenProps) {
  const { user } = useAuth();
  const flags = useSocialFeatureFlags();
  const directChats = useDirectChats();
  const [activeTab, setActiveTab] = useState<MainTabKey>('home');
  const dailyLogin = useDailyLoginRewards(user?.uid);
  usePushNotificationCoordinator({ enabled: flags.pushNotifications, navigation, uid: user?.uid });
  const bottomNavigation = useMemo(
    () => <BottomNavigationBar activeTab={activeTab} onTabPress={setActiveTab} unreadCount={directChats.totalUnreadCount} />,
    [activeTab, directChats.totalUnreadCount],
  );
  const lastDeepLink = useRef('');
  useEffect(() => {
    const open = (url: string | null) => {
      const targetUid = parseDirectChatLink(url);
      if (!targetUid || url === lastDeepLink.current) return;
      lastDeepLink.current = url || '';
      navigation.navigate('DirectChat', { source: 'deep-link', targetUid });
    };
    void Linking.getInitialURL().then(open);
    const subscription = Linking.addEventListener('url', ({ url }) => open(url));
    return () => subscription.remove();
  }, [navigation]);

  const { HomeScreen } = require('./HomeScreen') as typeof import('./HomeScreen');
  const { RoomsScreen } = require('./RoomsScreen') as typeof import('./RoomsScreen');
  const { ChatsScreen } = require('./ChatsScreen') as typeof import('./ChatsScreen');
  const { GamesScreen } = require('./GamesScreen') as typeof import('./GamesScreen');
  const { MeProfileScreen } = require('./MeProfileScreen') as typeof import('./MeProfileScreen');
  return (
    <>
      <View style={styles.shell}>
        <View style={[styles.tab, activeTab !== 'home' && styles.hiddenTab]}>
          <HomeScreen
            bottomNavigation={bottomNavigation}
            dailyLoginEntry={<DailyLoginHomeCard controller={dailyLogin} />}
            eventsEntry={<EventsHomeStrip uid={user?.uid} />}
            onOpenProfile={() => setActiveTab('me')}
            onOpenVoiceRoom={(roomId) => navigation.navigate('VoiceRoom', { roomId })}
          />
        </View>
        <View style={[styles.tab, activeTab !== 'rooms' && styles.hiddenTab]}>
          <RoomsScreen
            bottomNavigation={bottomNavigation}
            onOpenProfile={() => setActiveTab('me')}
            onOpenVoiceRoom={(roomId) => navigation.navigate('VoiceRoom', { roomId })}
          />
        </View>
        <View style={[styles.tab, activeTab !== 'chats' && styles.hiddenTab]}>
          <ChatsScreen bottomNavigation={bottomNavigation} navigation={navigation} />
        </View>
        <View style={[styles.tab, activeTab !== 'games' && styles.hiddenTab]}>
          <GamesScreen
            bottomNavigation={bottomNavigation}
            navigation={navigation}
            onBrowseRooms={() => setActiveTab('rooms')}
          />
        </View>
        <View style={[styles.tab, activeTab !== 'me' && styles.hiddenTab]}>
          <MeProfileScreen bottomNavigation={bottomNavigation} navigation={navigation} />
        </View>
      </View>
      <DailyLoginRewardSheet controller={dailyLogin} />
    </>
  );
}

const styles = StyleSheet.create({
  hiddenTab: { display: 'none' },
  shell: { flex: 1 },
  tab: { flex: 1 },
});
