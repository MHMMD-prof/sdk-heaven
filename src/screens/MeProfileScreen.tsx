import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { MeProfilePage } from '../components/MeProfilePage';
import { useGrowthFeatureFlags } from '../growth/featureFlags';
import { usePublicProfile } from '../social/usePublicProfile';
import { useSocialFeatureFlags } from '../social/useSocialFeatureFlags';
import { requestRepresentativeStatus, requestWalletStore } from '../social/requestSocialCommand';
import { PayrollProgress, requestPayrollProgress } from '../payroll/requestPayrollProgress';
import type { EconomyLoadState } from '../social/types';
import { beginEconomyLoad, resolveEconomyLoad } from '../social/economyState';
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
  const growthFlags = useGrowthFeatureFlags();
  const [isRepresentative, setIsRepresentative] = useState(false);
  const [representativeError, setRepresentativeError] = useState('');
  const [economy, setEconomy] = useState<EconomyLoadState>({ status: 'disabled' });
  const [refreshing, setRefreshing] = useState(false);
  const [economyRevision, setEconomyRevision] = useState(0);
  const [payrollProgress, setPayrollProgress] = useState<PayrollProgress | null>(null);
  const [payrollError, setPayrollError] = useState('');
  const [payrollLoading, setPayrollLoading] = useState(false);
  const { errorMessage, profile, retry, status } = usePublicProfile(user?.uid, {
    bootstrapIfMissing: true,
  });

  useFocusEffect(useCallback(() => {
    if (!flags.wallet || !user?.uid) {
      setEconomy({ status: 'disabled' });
      setIsRepresentative(false);
      setRepresentativeError('');
      return undefined;
    }

    let active = true;
    setEconomy((current) => beginEconomyLoad(current, true));
    void requestWalletStore().then((response) => {
      if (!active) return;
      setEconomy((current) => resolveEconomyLoad(current, response.ok
        ? { balances: response.result.wallet.balances }
        : { error: response.error.messageAr }));
    }).finally(() => { if (active) setRefreshing(false); });
    if (flags.representativeTransfers) {
      setRepresentativeError('');
      void requestRepresentativeStatus().then((response) => {
        if (active) {
          setIsRepresentative(response.ok && response.result.feature.available && response.result.privilege.active);
          if (!response.ok) setRepresentativeError(response.error.messageAr);
        }
      });
    } else {
      setIsRepresentative(false);
      setRepresentativeError('');
    }
    return () => { active = false; };
  }, [economyRevision, flags.representativeTransfers, flags.wallet, user?.uid]));

  useFocusEffect(useCallback(() => {
    if (!user?.uid) {
      setPayrollProgress(null);
      setPayrollError('');
      setPayrollLoading(false);
      return undefined;
    }
    let active = true;
    setPayrollLoading(true);
    setPayrollError('');
    void requestPayrollProgress()
      .then((progress) => { if (active) setPayrollProgress(progress); })
      .catch(() => { if (active) { setPayrollProgress(null); setPayrollError('تعذر تحميل بيانات الراتب.'); } })
      .finally(() => { if (active) setPayrollLoading(false); });
    return () => { active = false; };
  }, [economyRevision, user?.uid]));

  const retryAll = useCallback(() => {
    setRefreshing(true);
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
      avatarUploadsEnabled={flags.avatarUploads}
      bottomNavigation={bottomNavigation}
      fallbackAvatarLabel={privateProfile?.avatarLabel}
      fallbackDisplayName={privateProfile?.displayName}
      loadError={errorMessage}
      onOpenFriends={flags.friends ? () => navigation.navigate('Friends') : undefined}
      economy={economy}
      onOpenFollowers={flags.following ? () => navigation.navigate('Following', { tab: 'followers' }) : undefined}
      onOpenFollowing={flags.following ? () => navigation.navigate('Following', { tab: 'following' }) : undefined}
      onOpenBlockedUsers={(flags.following || flags.friends || flags.directMessages)
        ? () => navigation.navigate('BlockedUsers')
        : undefined}
      onOpenCouples={flags.couples ? () => navigation.navigate('Couples') : undefined}
      onOpenFamilies={growthFlags.families ? () => navigation.navigate('Families') : undefined}
      onOpenNotifications={flags.pushNotifications ? () => navigation.navigate('NotificationSettings') : undefined}
      onOpenGifts={flags.gifts ? () => navigation.navigate('Gifts', {}) : undefined}
      onOpenLeaderboards={growthFlags.leaderboards ? () => navigation.navigate('Leaderboards') : undefined}
      onOpenWallet={flags.wallet ? () => navigation.navigate('WalletStore') : undefined}
      onOpenStore={() => navigation.navigate('Store')}
      onOpenMyItems={() => navigation.navigate('MyItems')}
      onOpenRepresentativeTransfer={canOpenRepresentativeTransfer
        ? () => navigation.navigate('RepresentativeTransfer')
        : undefined}
      onOpenDiscovery={flags.usersDiscovery ? () => navigation.navigate('UsersDiscovery') : undefined}
      onOpenSettings={() => navigation.navigate('AccountSettings')}
      onRetry={retryAll}
      onRefresh={retryAll}
      profile={profile}
      payrollProgress={payrollProgress}
      payrollError={payrollError}
      payrollLoading={payrollLoading}
      representativeError={representativeError}
      status={status}
      refreshing={refreshing}
    />
  );
}
