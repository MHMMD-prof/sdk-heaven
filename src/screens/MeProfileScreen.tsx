import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { MeProfilePage } from '../components/MeProfilePage';
import { usePublicProfile } from '../social/usePublicProfile';
import { useSocialFeatureFlags } from '../social/useSocialFeatureFlags';
import { requestRepresentativeStatus } from '../social/requestSocialCommand';
import type { StoreCurrencyAmounts } from '../social/types';
import type { RootStackParamList } from '../types/navigation';

type MeProfileScreenProps = {
  bottomNavigation?: ReactNode;
  navigation: Pick<
    NativeStackNavigationProp<RootStackParamList, 'MeProfile'>,
    'navigate'
  >;
};

export function MeProfileScreen({ bottomNavigation, navigation }: MeProfileScreenProps) {
  const { profile: privateProfile, user } = useAuth();
  const flags = useSocialFeatureFlags();
  const [isRepresentative, setIsRepresentative] = useState(false);
  const [balances, setBalances] = useState<StoreCurrencyAmounts>();
  const [economyRevision, setEconomyRevision] = useState(0);
  const { errorMessage, profile, retry, status } = usePublicProfile(user?.uid, {
    bootstrapIfMissing: true,
  });

  useFocusEffect(useCallback(() => {
    if (!flags.wallet || !user?.uid) {
      setBalances(undefined);
      setIsRepresentative(false);
      return undefined;
    }

    let active = true;
    void requestRepresentativeStatus().then((response) => {
      if (!active) return;
      setIsRepresentative(response.ok && response.result.feature.available && response.result.privilege.active);
      setBalances(response.ok ? response.result.wallet.balances : undefined);
    });

    return () => { active = false; };
  }, [economyRevision, flags.representativeTransfers, flags.wallet, user?.uid]));

  const retryAll = useCallback(() => {
    retry();
    setEconomyRevision((value) => value + 1);
  }, [retry]);

  return (
    <MeProfilePage
      balances={balances}
      bottomNavigation={bottomNavigation}
      fallbackAvatarLabel={privateProfile?.avatarLabel}
      fallbackDisplayName={privateProfile?.displayName}
      loadError={errorMessage}
      onOpenFriends={flags.friends ? () => navigation.navigate('Friends') : undefined}
      onOpenCouples={flags.couples ? () => navigation.navigate('Couples') : undefined}
      onOpenNotifications={flags.pushNotifications ? () => navigation.navigate('NotificationSettings') : undefined}
      onOpenGifts={flags.gifts ? () => navigation.navigate('Gifts', {}) : undefined}
      onOpenWallet={flags.wallet ? () => navigation.navigate('WalletStore') : undefined}
      onOpenStore={() => navigation.navigate('Store')}
      onOpenMyItems={() => navigation.navigate('MyItems')}
      onOpenRepresentativeTransfer={isRepresentative ? () => navigation.navigate('RepresentativeTransfer') : undefined}
      onOpenDiscovery={flags.usersDiscovery ? () => navigation.navigate('UsersDiscovery') : undefined}
      onOpenSettings={() => navigation.navigate('AccountSettings')}
      onRetry={retryAll}
      profile={profile}
      status={status}
    />
  );
}
