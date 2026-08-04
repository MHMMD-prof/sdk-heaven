import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { MeProfilePage } from '../components/MeProfilePage';
import { usePublicProfile } from '../social/usePublicProfile';
import { useSocialFeatureFlags } from '../social/useSocialFeatureFlags';
import { requestRepresentativeStatus } from '../social/requestSocialCommand';
import { PayrollProgress, requestPayrollProgress } from '../payroll/requestPayrollProgress';
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
  const [payrollProgress, setPayrollProgress] = useState<PayrollProgress | null>(null);
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

  useFocusEffect(useCallback(() => {
    if (!user?.uid) {
      setPayrollProgress(null);
      return undefined;
    }
    let active = true;
    void requestPayrollProgress()
      .then((progress) => { if (active) setPayrollProgress(progress); })
      .catch(() => { if (active) setPayrollProgress(null); });
    return () => { active = false; };
  }, [economyRevision, user?.uid]));

  const retryAll = useCallback(() => {
    retry();
    setEconomyRevision((value) => value + 1);
  }, [retry]);

  const canOpenRepresentativeTransfer = (
    flags.wallet
    && flags.representativeTransfers
    && (isRepresentative || profile?.representativeBadgeActive === true)
  );

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
      onOpenRepresentativeTransfer={canOpenRepresentativeTransfer
        ? () => navigation.navigate('RepresentativeTransfer')
        : undefined}
      onOpenDiscovery={flags.usersDiscovery ? () => navigation.navigate('UsersDiscovery') : undefined}
      onOpenSettings={() => navigation.navigate('AccountSettings')}
      onRetry={retryAll}
      profile={profile}
      payrollProgress={payrollProgress}
      status={status}
    />
  );
}
