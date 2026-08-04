import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { useAuth } from '../auth/AuthProvider';
import { PublicProfilePage } from '../components/PublicProfilePage';
import {
  requestCoupleMutation,
  requestCoupleStatus,
  requestFriendMutation,
  requestFriendshipStatus,
} from '../social/requestSocialCommand';
import type {
  CoupleMutationAction,
  CoupleRelationshipStatus,
  FriendMutationAction,
  FriendRelationshipStatus,
} from '../social/types';
import { usePublicProfile } from '../social/usePublicProfile';
import { useSocialFeatureFlags } from '../social/useSocialFeatureFlags';
import type { RootStackParamList } from '../types/navigation';

type UserProfileScreenProps = NativeStackScreenProps<RootStackParamList, 'UserProfile'>;

export function UserProfileScreen({ navigation, route }: UserProfileScreenProps) {
  const { user } = useAuth();
  const flags = useSocialFeatureFlags();
  const [friendBusy, setFriendBusy] = useState(false);
  const [friendStatus, setFriendStatus] = useState<FriendRelationshipStatus>('none');
  const [friendStatusLoading, setFriendStatusLoading] = useState(false);
  const [coupleBusy, setCoupleBusy] = useState(false);
  const [coupleStatus, setCoupleStatus] = useState<CoupleRelationshipStatus>('none');
  const [coupleUnavailable, setCoupleUnavailable] = useState(false);
  const [coupleStatusLoading, setCoupleStatusLoading] = useState(false);
  const { errorMessage, profile, retry, status } = usePublicProfile(route.params.uid);

  useEffect(() => {
    if (!flags.friends || !user?.uid || user.uid === route.params.uid) {
      return undefined;
    }

    let active = true;
    setFriendStatusLoading(true);
    void requestFriendshipStatus(route.params.uid).then((response) => {
      if (!active) return;
      if (response.ok) setFriendStatus(response.result.status);
      setFriendStatusLoading(false);
    });

    return () => {
      active = false;
    };
  }, [flags.friends, route.params.uid, user?.uid]);

  useEffect(() => {
    if (!flags.couples || !user?.uid || user.uid === route.params.uid) return undefined;
    let active = true;
    setCoupleStatusLoading(true);
    void requestCoupleStatus(route.params.uid).then((response) => {
      if (!active) return;
      if (response.ok) {
        setCoupleStatus(response.result.status);
        setCoupleUnavailable(response.result.unavailable);
      }
      setCoupleStatusLoading(false);
    });
    return () => { active = false; };
  }, [flags.couples, route.params.uid, user?.uid]);

  const executeFriendAction = async (action: FriendMutationAction) => {
    setFriendBusy(true);
    const response = await requestFriendMutation(action, route.params.uid);
    setFriendBusy(false);

    if (response.ok) {
      setFriendStatus(response.result.status);
    } else {
      Alert.alert('تعذر تنفيذ الطلب', response.error.messageAr);
    }
  };

  const onFriendPress = () => {
    if (friendStatus === 'friends') {
      Alert.alert('إزالة الصديق', 'هل تريد إزالة هذا المستخدم من قائمة أصدقائك؟', [
        { style: 'cancel', text: 'تراجع' },
        { style: 'destructive', text: 'إزالة', onPress: () => void executeFriendAction('remove-friend') },
      ]);
      return;
    }

    const action: FriendMutationAction = friendStatus === 'incoming'
      ? 'accept-friend-request'
      : friendStatus === 'outgoing'
        ? 'cancel-friend-request'
        : 'send-friend-request';
    void executeFriendAction(action);
  };

  const showFriendAction = flags.friends && Boolean(user?.uid) && user?.uid !== route.params.uid;

  const executeCoupleAction = async (action: CoupleMutationAction) => {
    setCoupleBusy(true);
    const response = await requestCoupleMutation(action, route.params.uid);
    setCoupleBusy(false);
    if (response.ok) {
      setCoupleStatus(response.result.status);
      setCoupleUnavailable(false);
    } else {
      Alert.alert('تعذر تنفيذ الطلب', response.error.messageAr);
    }
  };

  const onCouplePress = () => {
    if (coupleStatus === 'coupled') {
      Alert.alert('إنهاء الارتباط', 'هل تريد إنهاء ارتباطك بهذا المستخدم؟', [
        { style: 'cancel', text: 'تراجع' },
        { style: 'destructive', text: 'إنهاء الارتباط', onPress: () => void executeCoupleAction('dissolve-couple') },
      ]);
      return;
    }
    const action: CoupleMutationAction = coupleStatus === 'incoming'
      ? 'accept-couple-request'
      : coupleStatus === 'outgoing'
        ? 'cancel-couple-request'
        : 'send-couple-request';
    void executeCoupleAction(action);
  };

  const showCoupleAction = flags.couples && Boolean(user?.uid) && user?.uid !== route.params.uid;

  return (
    <PublicProfilePage
      chatAction={flags.directMessages && Boolean(user?.uid) && user?.uid !== route.params.uid ? {
        onPress: () => navigation.navigate('DirectChat', { source: 'profile', targetUid: route.params.uid }),
      } : undefined}
      coupleAction={showCoupleAction ? {
        disabled: coupleBusy || coupleStatusLoading || coupleUnavailable,
        label: coupleActionLabel(coupleStatus, coupleBusy || coupleStatusLoading, coupleUnavailable),
        onPress: onCouplePress,
      } : undefined}
      friendAction={showFriendAction ? {
        disabled: friendBusy || friendStatusLoading,
        label: friendActionLabel(friendStatus, friendBusy || friendStatusLoading),
        onPress: onFriendPress,
      } : undefined}
      giftAction={flags.gifts && Boolean(user?.uid) && user?.uid !== route.params.uid ? {
        onPress: () => navigation.navigate('Gifts', { targetUid: route.params.uid }),
      } : undefined}
      loadError={errorMessage}
      onBack={navigation.goBack}
      onRetry={retry}
      profile={profile}
      status={status}
    />
  );
}

function coupleActionLabel(status: CoupleRelationshipStatus, loading: boolean, unavailable: boolean) {
  if (loading) return 'جارٍ التحقق...';
  if (status === 'coupled') return 'إنهاء الارتباط';
  if (status === 'incoming') return 'قبول طلب الارتباط';
  if (status === 'outgoing') return 'إلغاء طلب الارتباط';
  if (unavailable) return 'غير متاح للارتباط';
  return 'إرسال طلب ارتباط';
}

function friendActionLabel(status: FriendRelationshipStatus, loading: boolean) {
  if (loading) return 'جارٍ التحقق...';
  if (status === 'friends') return 'إزالة من الأصدقاء';
  if (status === 'incoming') return 'قبول طلب الصداقة';
  if (status === 'outgoing') return 'إلغاء طلب الصداقة';
  return 'إضافة صديق';
}
