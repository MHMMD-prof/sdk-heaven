import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect } from 'react';

import type { RootStackParamList } from '../types/navigation';
import { registerCurrentDevice, subscribeNotificationResponses } from './pushNotifications';

const handledResponses = new Set<string>();

export function usePushNotificationCoordinator({
  enabled,
  navigation,
  uid,
}: {
  enabled: boolean;
  navigation: NativeStackNavigationProp<RootStackParamList, 'Main'>;
  uid?: string;
}) {
  useEffect(() => {
    if (!enabled || !uid) return undefined;
    void registerCurrentDevice(false);
    return subscribeNotificationResponses((data, identifier) => {
      const signature = identifier;
      if (handledResponses.has(signature)) return;
      handledResponses.add(signature);
      if (handledResponses.size > 50) handledResponses.delete(handledResponses.values().next().value || '');

      const actorUid = typeof data.actorUid === 'string' ? data.actorUid : '';
      if (data.route === 'UserProfile' && actorUid) navigation.navigate('UserProfile', { uid: actorUid });
      else if (data.route === 'Friends') navigation.navigate('Friends');
      else if (data.route === 'Couples') navigation.navigate('Couples');
      else if (data.route === 'Gifts') navigation.navigate('Gifts', {});
      else if (data.route === 'Store') navigation.navigate('Store');
      else if (data.route === 'RepresentativeTransfer') navigation.navigate('RepresentativeTransfer');
    });
  }, [enabled, navigation, uid]);
}
