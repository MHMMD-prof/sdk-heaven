import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SymbolView } from 'expo-symbols';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ScreenContainer } from '../components/ScreenContainer';
import { useGrowthFeatureFlags } from '../growth/featureFlags';
import { requestFamilyMutation, requestMyFamily } from '../social/requestSocialCommand';
import type { FamilyMember, MyFamilyResult } from '../social/types';
import { colors, radius, spacing, typography } from '../theme';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Families'>;

const emptyFamily: MyFamilyResult = {
  family: null,
  incoming: [],
  members: [],
  role: null,
};

export function FamiliesScreen({ navigation }: Props) {
  const growthFlags = useGrowthFeatureFlags();
  const [overview, setOverview] = useState<MyFamilyResult>(emptyFamily);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [nameAr, setNameAr] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [inviteUid, setInviteUid] = useState('');

  const load = useCallback(async () => {
    if (!growthFlags.families) {
      setLoading(false);
      setOverview(emptyFamily);
      return;
    }
    setLoading(true);
    setErrorMessage('');
    const response = await requestMyFamily();
    if (response.ok) setOverview(response.result);
    else setErrorMessage(response.error.messageAr);
    setLoading(false);
  }, [growthFlags.families]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const run = async (
    action: Parameters<typeof requestFamilyMutation>[0],
    payload?: Record<string, unknown>,
  ) => {
    setBusy(true);
    const response = await requestFamilyMutation(action, payload);
    setBusy(false);
    if (!response.ok) {
      Alert.alert('تعذر تنفيذ الطلب', response.error.messageAr);
      return;
    }
    await load();
  };

  if (!growthFlags.families) {
    return (
      <ScreenContainer>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backButton}>
            <SymbolView name={{ ios: 'chevron.forward', android: 'arrow_forward', web: 'arrow_forward' }} size={18} tintColor={colors.text} />
          </Pressable>
          <Text style={styles.title}>العائلات</Text>
        </View>
        <Text style={styles.empty}>ميزة العائلات غير مفعّلة حالياً.</Text>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backButton}>
          <SymbolView name={{ ios: 'chevron.forward', android: 'arrow_forward', web: 'arrow_forward' }} size={18} tintColor={colors.text} />
        </Pressable>
        <Text style={styles.title}>العائلات</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.gold} style={{ marginTop: spacing.xl }} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

          {overview.family ? (
            <View style={styles.card}>
              <Text style={[styles.familyName, { color: overview.family.badgeColor }]}>
                {overview.family.nameAr}
              </Text>
              <Text style={styles.meta}>الدور: {roleLabel(overview.role)}</Text>
              <Text style={styles.meta}>الأعضاء: {overview.family.memberCount}</Text>
              <Text selectable style={styles.meta}>رمز الانضمام: {overview.family.inviteCode}</Text>
              {overview.family.homeRoomId ? (
                <Pressable
                  onPress={() => navigation.navigate('VoiceRoom', { roomId: overview.family!.homeRoomId! })}
                  style={styles.secondaryButton}
                >
                  <Text style={styles.secondaryButtonText}>غرفة العائلة</Text>
                </Pressable>
              ) : null}

              {(overview.role === 'owner' || overview.role === 'elder') ? (
                <View style={styles.formBlock}>
                  <TextInput
                    placeholder="معرّف المستخدم للدعوة"
                    placeholderTextColor={colors.textMuted}
                    style={styles.input}
                    value={inviteUid}
                    onChangeText={setInviteUid}
                    autoCapitalize="none"
                  />
                  <Pressable
                    disabled={busy || !inviteUid.trim()}
                    onPress={() => void run('invite-to-family', { targetUid: inviteUid.trim() })}
                    style={styles.primaryButton}
                  >
                    <Text style={styles.primaryButtonText}>دعوة عضو</Text>
                  </Pressable>
                </View>
              ) : null}

              <View style={styles.members}>
                {overview.members.map((member) => (
                  <MemberRow
                    key={member.uid}
                    member={member}
                    canKick={
                      (overview.role === 'owner' || overview.role === 'elder')
                      && member.role !== 'owner'
                      && !(overview.role === 'elder' && member.role === 'elder')
                    }
                    busy={busy}
                    onKick={() => {
                      Alert.alert('طرد عضو', `طرد ${member.displayName}؟`, [
                        { style: 'cancel', text: 'تراجع' },
                        {
                          style: 'destructive',
                          text: 'طرد',
                          onPress: () => void run('kick-family-member', { targetUid: member.uid }),
                        },
                      ]);
                    }}
                  />
                ))}
              </View>

              {overview.role === 'owner' ? (
                <Pressable
                  disabled={busy}
                  onPress={() => {
                    Alert.alert('حل العائلة', 'سيتم إزالة جميع الأعضاء. هل تريد المتابعة؟', [
                      { style: 'cancel', text: 'تراجع' },
                      {
                        style: 'destructive',
                        text: 'حل العائلة',
                        onPress: () => void run('dissolve-family'),
                      },
                    ]);
                  }}
                  style={styles.dangerButton}
                >
                  <Text style={styles.dangerButtonText}>حل العائلة</Text>
                </Pressable>
              ) : (
                <Pressable
                  disabled={busy}
                  onPress={() => void run('leave-family')}
                  style={styles.dangerButton}
                >
                  <Text style={styles.dangerButtonText}>مغادرة العائلة</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>إنشاء عائلة</Text>
              <TextInput
                placeholder="اسم العائلة"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                value={nameAr}
                onChangeText={setNameAr}
              />
              <Pressable
                disabled={busy || nameAr.trim().length < 2}
                onPress={() => void run('create-family', { nameAr: nameAr.trim() })}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>إنشاء</Text>
              </Pressable>

              <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>الانضمام برمز</Text>
              <TextInput
                autoCapitalize="characters"
                placeholder="رمز الدعوة"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                value={inviteCode}
                onChangeText={setInviteCode}
              />
              <Pressable
                disabled={busy || inviteCode.trim().length < 6}
                onPress={() => void run('join-family', { inviteCode: inviteCode.trim() })}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryButtonText}>انضمام</Text>
              </Pressable>
            </View>
          )}

          {overview.incoming.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>دعوات واردة</Text>
              {overview.incoming.map((row) => (
                <View key={`${row.family.familyId}:${row.profile.uid}`} style={styles.inviteRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inviteTitle}>{row.family.nameAr}</Text>
                    <Text style={styles.meta}>من {row.profile.displayName}</Text>
                  </View>
                  <Pressable
                    disabled={busy}
                    onPress={() => void run('accept-family-invite', { familyId: row.family.familyId })}
                    style={styles.smallButton}
                  >
                    <Text style={styles.smallButtonText}>قبول</Text>
                  </Pressable>
                  <Pressable
                    disabled={busy}
                    onPress={() => void run('decline-family-invite', { familyId: row.family.familyId })}
                    style={styles.smallGhost}
                  >
                    <Text style={styles.smallGhostText}>رفض</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

function MemberRow({
  member,
  canKick,
  busy,
  onKick,
}: {
  member: FamilyMember;
  canKick: boolean;
  busy: boolean;
  onKick: () => void;
}) {
  return (
    <View style={styles.memberRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.memberName}>{member.displayName || member.uid}</Text>
        <Text style={styles.meta}>{roleLabel(member.role)}</Text>
      </View>
      {canKick ? (
        <Pressable disabled={busy} onPress={onKick} style={styles.smallGhost}>
          <Text style={styles.smallGhostText}>طرد</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function roleLabel(role: MyFamilyResult['role']) {
  if (role === 'owner') return 'قائد';
  if (role === 'elder') return 'كبير';
  if (role === 'member') return 'عضو';
  return '—';
}

const styles = StyleSheet.create({
  backButton: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  content: {
    gap: spacing.md,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.md,
  },
  dangerButton: {
    alignItems: 'center',
    borderColor: '#B85C5C',
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
  },
  dangerButtonText: {
    color: '#E8A0A0',
    fontWeight: typography.weights.bold,
  },
  empty: {
    color: colors.textMuted,
    marginTop: spacing.xl,
    textAlign: 'center',
  },
  error: {
    color: '#E8A0A0',
    textAlign: 'right',
  },
  familyName: {
    fontSize: 22,
    fontWeight: typography.weights.black,
    textAlign: 'right',
  },
  formBlock: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  input: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    textAlign: 'right',
  },
  inviteRow: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  inviteTitle: {
    color: colors.text,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
  },
  memberName: {
    color: colors.text,
    fontWeight: typography.weights.semibold,
    textAlign: 'right',
  },
  memberRow: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  members: {
    marginTop: spacing.sm,
  },
  meta: {
    color: colors.textMuted,
    textAlign: 'right',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.gold,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
  },
  primaryButtonText: {
    color: '#101418',
    fontWeight: typography.weights.bold,
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingVertical: spacing.sm,
  },
  secondaryButtonText: {
    color: colors.text,
    fontWeight: typography.weights.bold,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
  },
  smallButton: {
    backgroundColor: colors.gold,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  smallButtonText: {
    color: '#101418',
    fontWeight: typography.weights.bold,
  },
  smallGhost: {
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  smallGhostText: {
    color: colors.textMuted,
  },
  title: {
    color: colors.text,
    flex: 1,
    fontSize: 22,
    fontWeight: typography.weights.black,
    textAlign: 'right',
  },
});
