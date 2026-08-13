import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { ScreenContainer } from '../components/ScreenContainer';
import { registerCurrentDevice, unregisterCurrentDevice } from '../notifications/pushNotifications';
import { requestNotificationPreferencesUpdate, requestNotificationSettings } from '../social/requestSocialCommand';
import type { NotificationPreferences } from '../social/types';
import { colors, radius, spacing, typography } from '../theme';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'NotificationSettings'>;
const defaultPreferences: NotificationPreferences = {
  coupleRequests: true,
  directMessageRequests: true,
  directMessages: true,
  follows: true,
  friendRequests: true,
  gifts: true,
  readReceipts: true,
  showMessagePreview: true,
  showOnlineStatus: true,
  walletTransfers: true,
};

export function NotificationSettingsScreen({ navigation }: Props) {
  const [preferences, setPreferences] = useState(defaultPreferences);
  const [registeredDeviceCount, setRegisteredDeviceCount] = useState(0);
  const [currentDeviceRegistered, setCurrentDeviceRegistered] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setMessage('');
    const response = await requestNotificationSettings();
    if (response.ok) {
      setPreferences(response.result.preferences);
      setRegisteredDeviceCount(response.result.registeredDeviceCount);
      const currentDevice = await registerCurrentDevice(false);
      if (currentDevice.ok) {
        setCurrentDeviceRegistered(true);
        setRegisteredDeviceCount((count) => Math.max(1, count));
      }
    } else setMessage(response.error.messageAr);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const enableCurrentDevice = async () => {
    setBusy(true);
    setMessage('');
    const result = await registerCurrentDevice(true);
    setBusy(false);
    if (result.ok) {
      setRegisteredDeviceCount((count) => Math.max(1, count));
      setCurrentDeviceRegistered(true);
      setMessage('تم تفعيل الإشعارات على هذا الجهاز.');
    } else setMessage(result.messageAr);
  };

  const disableCurrentDevice = async () => {
    setBusy(true);
    setMessage('');
    const result = await unregisterCurrentDevice();
    setBusy(false);
    if (result.ok) {
      setRegisteredDeviceCount((count) => Math.max(0, count - 1));
      setCurrentDeviceRegistered(false);
      setMessage('تم إيقاف الإشعارات على هذا الجهاز.');
    } else setMessage(result.messageAr);
  };

  const updatePreference = async (key: keyof NotificationPreferences, value: boolean) => {
    const previous = preferences;
    const next = { ...preferences, [key]: value };
    setPreferences(next);
    setMessage('');
    const response = await requestNotificationPreferencesUpdate(next);
    if (!response.ok) {
      setPreferences(previous);
      setMessage(response.error.messageAr);
    }
  };

  return (
    <ScreenContainer decorativeGlows={false} variant="ruby">
      <View style={styles.page}>
        <View style={styles.header}>
          <Pressable accessibilityLabel="رجوع" onPress={navigation.goBack} style={styles.roundButton}>
            <SymbolView name={{ ios: 'chevron.right', android: 'arrow_forward', web: 'arrow_forward' }} size={22} tintColor={colors.goldSoft} />
          </Pressable>
          <View style={styles.heading}>
            <Text style={styles.eyebrow}>تنبيهاتك</Text>
            <Text style={styles.title}>إعدادات الإشعارات</Text>
          </View>
          <Pressable accessibilityLabel="تحديث" onPress={() => void load()} style={styles.roundButton}>
            <SymbolView name={{ ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }} size={21} tintColor={colors.goldSoft} />
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.stateCard}><ActivityIndicator color={colors.gold} size="large" /><Text style={styles.stateText}>جارٍ تحميل إعدادات الإشعارات...</Text></View>
        ) : (
          <>
            <View style={styles.deviceCard}>
              <View style={styles.deviceIcon}>
                <SymbolView name={{ ios: 'bell.badge.fill', android: 'notifications_active', web: 'notifications_active' }} size={30} tintColor={colors.goldSoft} />
              </View>
              <View style={styles.deviceCopy}>
                <Text style={styles.cardTitle}>إشعارات هذا الجهاز</Text>
                <Text style={styles.cardBody}>{registeredDeviceCount > 0 ? `${registeredDeviceCount} جهاز مسجل لاستقبال التنبيهات` : 'فعّل الإشعارات حتى لا تفوتك الطلبات والهدايا.'}</Text>
              </View>
              <Pressable disabled={busy} onPress={() => void (currentDeviceRegistered ? disableCurrentDevice() : enableCurrentDevice())} style={styles.deviceAction}>
                {busy ? <ActivityIndicator color="#2B090C" /> : <Text style={styles.deviceActionText}>{currentDeviceRegistered ? 'إيقاف' : 'تفعيل'}</Text>}
              </Pressable>
            </View>

            <View style={styles.preferencesCard}>
              <Text style={styles.sectionTitle}>أنواع التنبيهات</Text>
              <PreferenceRow label="طلبات الصداقة" description="الطلبات الجديدة وقبول طلباتك" value={preferences.friendRequests} onChange={(value) => void updatePreference('friendRequests', value)} />
              <View style={styles.divider} />
              <PreferenceRow label="المتابعون" description="تنبيه عند متابعة حسابك" value={preferences.follows} onChange={(value) => void updatePreference('follows', value)} />
              <View style={styles.divider} />
              <PreferenceRow label="طلبات الارتباط" description="طلبات الارتباط الجديدة وقبولها" value={preferences.coupleRequests} onChange={(value) => void updatePreference('coupleRequests', value)} />
              <View style={styles.divider} />
              <PreferenceRow label="الهدايا" description="تنبيه عند وصول هدية جديدة" value={preferences.gifts} onChange={(value) => void updatePreference('gifts', value)} />
              <View style={styles.divider} />
              <PreferenceRow label="شحن المحفظة" description="تنبيه عند إرسال أو استلام العملات والألماس عبر الوكيل" value={preferences.walletTransfers} onChange={(value) => void updatePreference('walletTransfers', value)} />
            </View>

            <View style={styles.preferencesCard}>
              <Text style={styles.sectionTitle}>الرسائل الخاصة</Text>
              <PreferenceRow label="الرسائل المباشرة" description="تنبيه عند وصول رسالة في محادثة مقبولة" value={preferences.directMessages} onChange={(value) => void updatePreference('directMessages', value)} />
              <View style={styles.divider} />
              <PreferenceRow label="طلبات الرسائل" description="تنبيه عند وصول طلب رسالة من غير صديق" value={preferences.directMessageRequests} onChange={(value) => void updatePreference('directMessageRequests', value)} />
              <View style={styles.divider} />
              <PreferenceRow label="معاينة الرسالة" description="إظهار اسم المرسل ونص مختصر في الإشعار للمحادثات المقبولة" value={preferences.showMessagePreview} onChange={(value) => void updatePreference('showMessagePreview', value)} />
            </View>

            <View style={styles.preferencesCard}>
              <Text style={styles.sectionTitle}>الخصوصية</Text>
              <PreferenceRow label="إشعارات القراءة" description="السماح للطرف الآخر برؤية أنك قرأت الرسالة" value={preferences.readReceipts} onChange={(value) => void updatePreference('readReceipts', value)} />
              <View style={styles.divider} />
              <PreferenceRow label="الحالة المتصلة" description="إظهار أنك متصل أثناء فتح المحادثة" value={preferences.showOnlineStatus} onChange={(value) => void updatePreference('showOnlineStatus', value)} />
            </View>

            <View style={styles.privacyNote}>
              <SymbolView name={{ ios: 'lock.shield.fill', android: 'verified_user', web: 'verified_user' }} size={21} tintColor={colors.gold} />
              <Text style={styles.privacyText}>رمز الجهاز محفوظ بشكل محمي ولا يمكن قراءته أو تغييره مباشرة من التطبيق. طلبات الرسائل لا تكشف الاسم أو المحتوى في الإشعار.</Text>
            </View>
          </>
        )}
        {message ? <Text style={styles.message}>{message}</Text> : null}
      </View>
    </ScreenContainer>
  );
}

function PreferenceRow({ description, label, onChange, value }: { description: string; label: string; onChange: (value: boolean) => void; value: boolean }) {
  return (
    <View style={styles.preferenceRow}>
      <View style={styles.preferenceCopy}>
        <Text style={styles.preferenceLabel}>{label}</Text>
        <Text style={styles.preferenceDescription}>{description}</Text>
      </View>
      <Switch ios_backgroundColor="#331016" onValueChange={onChange} thumbColor={value ? '#FFF0BE' : '#A58D8D'} trackColor={{ false: '#331016', true: '#8E1722' }} value={value} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { alignSelf: 'center', gap: spacing.lg, maxWidth: 720, width: '100%' },
  header: { alignItems: 'center', flexDirection: 'row-reverse', justifyContent: 'space-between', minHeight: 58 },
  roundButton: { alignItems: 'center', backgroundColor: '#17090A', borderColor: 'rgba(232,190,97,0.42)', borderRadius: radius.full, borderWidth: 1, height: 46, justifyContent: 'center', width: 46 },
  heading: { alignItems: 'center' },
  eyebrow: { color: colors.gold, fontSize: 11, fontWeight: typography.weights.bold, writingDirection: 'rtl' },
  title: { color: colors.text, fontSize: 22, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  stateCard: { alignItems: 'center', backgroundColor: '#100607', borderColor: 'rgba(232,190,97,0.28)', borderRadius: radius.xl, borderWidth: 1, gap: spacing.md, minHeight: 240, justifyContent: 'center', padding: spacing.xl },
  stateText: { color: colors.textMuted, textAlign: 'center', writingDirection: 'rtl' },
  deviceCard: { alignItems: 'center', backgroundColor: '#160708', borderColor: 'rgba(232,190,97,0.38)', borderRadius: radius.xl, borderWidth: 1, flexDirection: 'row-reverse', gap: spacing.md, padding: spacing.lg },
  deviceIcon: { alignItems: 'center', backgroundColor: '#72121A', borderRadius: radius.full, height: 58, justifyContent: 'center', width: 58 },
  deviceCopy: { alignItems: 'flex-end', flex: 1, gap: 4 },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  cardBody: { color: colors.textMuted, fontSize: 12, textAlign: 'right', writingDirection: 'rtl' },
  deviceAction: { alignItems: 'center', backgroundColor: colors.gold, borderRadius: radius.full, justifyContent: 'center', minHeight: 42, minWidth: 68, paddingHorizontal: spacing.md },
  deviceActionText: { color: '#2B090C', fontWeight: typography.weights.black, writingDirection: 'rtl' },
  preferencesCard: { backgroundColor: '#100607', borderColor: 'rgba(232,190,97,0.25)', borderRadius: radius.xl, borderWidth: 1, padding: spacing.lg },
  sectionTitle: { color: colors.goldSoft, fontSize: 17, fontWeight: typography.weights.black, marginBottom: spacing.sm, textAlign: 'right', writingDirection: 'rtl' },
  preferenceRow: { alignItems: 'center', flexDirection: 'row-reverse', gap: spacing.md, minHeight: 74 },
  preferenceCopy: { alignItems: 'flex-end', flex: 1, gap: 3 },
  preferenceLabel: { color: colors.text, fontSize: 15, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  preferenceDescription: { color: colors.textMuted, fontSize: 12, textAlign: 'right', writingDirection: 'rtl' },
  divider: { backgroundColor: 'rgba(232,190,97,0.14)', height: 1 },
  privacyNote: { alignItems: 'center', backgroundColor: 'rgba(123,20,30,0.16)', borderRadius: radius.lg, flexDirection: 'row-reverse', gap: spacing.sm, padding: spacing.md },
  privacyText: { color: colors.textMuted, flex: 1, fontSize: 12, lineHeight: 20, textAlign: 'right', writingDirection: 'rtl' },
  message: { color: colors.goldSoft, fontSize: 13, fontWeight: typography.weights.bold, textAlign: 'center', writingDirection: 'rtl' },
});
