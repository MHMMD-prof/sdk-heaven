import { File } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  canUseCustomSubmissions,
  CUSTOM_V1_CATEGORIES,
  resolveCustomUploadDraft,
  type CustomCosmeticCategory,
  type CustomEligibilitySnapshot,
  type CustomSubmissionSummary,
  validateCustomAttestation,
} from '../cosmetics/customSubmissions';
import { uploadCustomCosmeticBytes } from '../cosmetics/customSubmissionUpload';
import { useCosmeticsFeatureFlags } from '../cosmetics/featureFlags';
import {
  requestAttestCosmeticCustomSubmission,
  requestCreateCosmeticCustomUpload,
  requestEquipCosmeticCustomAsset,
  requestFinalizeCosmeticCustomUpload,
  requestListCosmeticCustomSubmissions,
  requestUnequipCosmeticCustomAsset,
} from '../social/requestSocialCommand';
import { colors, radius, spacing, typography } from '../theme';
import { doc, getDoc } from 'firebase/firestore';
import { firebaseAuth, firebaseDb } from '../auth/firebase';

export function CustomCosmeticsPanel() {
  const flags = useCosmeticsFeatureFlags();
  const [eligibility, setEligibility] = useState<CustomEligibilitySnapshot>();
  const [submissions, setSubmissions] = useState<CustomSubmissionSummary[]>([]);
  const [category, setCategory] = useState<CustomCosmeticCategory>('profile-skin');
  const [attestation, setAttestation] = useState('I own this artwork and authorize review.');
  const [fallbackAssetId, setFallbackAssetId] = useState('');
  const [fallbackAssetVersionId, setFallbackAssetVersionId] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const allowed = canUseCustomSubmissions(flags, eligibility, category);

  const load = useCallback(async () => {
    setError('');
    try {
      const uid = firebaseAuth.currentUser?.uid;
      if (!uid || !flags.customSubmissions) {
        setEligibility(undefined);
        setSubmissions([]);
        return;
      }
      const eligibilitySnap = await getDoc(doc(firebaseDb, 'cosmeticCustomEligibility', uid));
      const data = eligibilitySnap.exists() ? eligibilitySnap.data() : undefined;
      const categories = Array.isArray(data?.categories)
        ? data.categories.filter((value): value is CustomCosmeticCategory => (
          typeof value === 'string' && (CUSTOM_V1_CATEGORIES as readonly string[]).includes(value)
        ))
        : [];
      setEligibility({
        active: data?.active === true && data?.uid === uid && categories.length > 0,
        categories,
      });
      if (categories.length && !categories.includes(category)) {
        setCategory(categories[0]);
      }
      if (!(data?.active === true && flags.customSubmissions && categories.length > 0)) {
        setSubmissions([]);
        return;
      }
      const listed = await requestListCosmeticCustomSubmissions(25);
      if (listed.ok) setSubmissions(listed.result.submissions);
      else setError(listed.error.messageAr);
    } catch {
      setError('تعذر تحميل الأصول المخصّصة.');
    }
  }, [category, flags.customSubmissions]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!flags.customSubmissions) return null;
  if (!eligibility?.active) {
    return (
      <View style={styles.root}>
        <Text style={styles.title}>أصول مخصّصة معتمدة</Text>
        <Text style={styles.copy}>الرفع مغلق. يلزم تفعيل العلم والأهلية والفئات من الإدارة.</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }

  const categoryOptions = eligibility.categories.length
    ? eligibility.categories
    : [];

  async function pickAndUpload() {
    if (!allowed) {
      setError('الرفع غير متاح لهذا الحساب أو الفئة.');
      return;
    }
    if (!validateCustomAttestation(attestation)) {
      setError('أدخل إقرار ملكية صالحاً قبل الإرسال.');
      return;
    }
    setBusy('upload');
    setError('');
    try {
      const picked = category === 'entry-effect'
        ? await pickEntryEffectLottie()
        : await pickStaticImage();
      if (!picked) return;
      const draft = resolveCustomUploadDraft({
        category,
        contentType: picked.contentType,
        fallbackAssetId: fallbackAssetId || undefined,
        fallbackAssetVersionId: fallbackAssetVersionId || undefined,
        sizeBytes: picked.sizeBytes,
        uri: picked.uri,
      });
      if (!draft.ok) throw new Error(draft.reason);
      const created = await requestCreateCosmeticCustomUpload({
        category: draft.value.category,
        contentType: draft.value.contentType,
        ...(draft.value.fallbackAssetId ? {
          fallbackAssetId: draft.value.fallbackAssetId,
          fallbackAssetVersionId: draft.value.fallbackAssetVersionId,
        } : {}),
        format: draft.value.format,
        sizeBytes: draft.value.sizeBytes,
      });
      if (!created.ok) throw new Error(created.error.code);
      await uploadCustomCosmeticBytes(created.result, draft.value.uri);
      const finalized = await requestFinalizeCosmeticCustomUpload(created.result.submissionId);
      if (!finalized.ok) throw new Error(finalized.error.code);
      const attested = await requestAttestCosmeticCustomSubmission(created.result.submissionId, attestation.trim());
      if (!attested.ok) throw new Error(attested.error.code);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'UPLOAD_FAILED');
    } finally {
      setBusy('');
    }
  }

  async function equip(submission: CustomSubmissionSummary) {
    if (!flags.customRendering || !submission.approvedAssetId) return;
    setBusy(submission.submissionId);
    setError('');
    try {
      const response = await requestEquipCosmeticCustomAsset(submission.approvedAssetId);
      if (!response.ok) setError(response.error.messageAr);
    } catch {
      setError('تعذر تجهيز الأصل المخصّص.');
    } finally {
      setBusy('');
    }
  }

  async function unequip(selected: CustomCosmeticCategory) {
    if (!flags.customRendering) return;
    setBusy(`unequip-${selected}`);
    setError('');
    try {
      const response = await requestUnequipCosmeticCustomAsset(selected);
      if (!response.ok) setError(response.error.messageAr);
    } catch {
      setError('تعذر إلغاء تجهيز الأصل المخصّص.');
    } finally {
      setBusy('');
    }
  }

  return (
    <View style={styles.root}>
      <Text style={styles.title}>أصول مخصّصة معتمدة</Text>
      <Text style={styles.copy}>
        {allowed
          ? 'الرفع متاح للفئات المسموحة فقط، ويبقى قيد المراجعة حتى موافقة الإدارة.'
          : 'الرفع مغلق. يلزم تفعيل العلم والأهلية من الإدارة.'}
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {allowed ? (
        <>
          <View style={styles.row}>
            {categoryOptions.map((value) => (
              <Pressable
                key={value}
                onPress={() => setCategory(value)}
                style={[styles.chip, category === value ? styles.chipActive : null]}
              >
                <Text style={styles.chipLabel}>{value}</Text>
              </Pressable>
            ))}
          </View>
          {category === 'entry-effect' ? (
            <>
              <Text style={styles.copy}>
                اختر ملف Lottie JSON معتمد (بدون MP4). يلزم أصل ثابت معتمد كاحتياطي.
              </Text>
              <TextInput
                onChangeText={setFallbackAssetId}
                placeholder="fallback asset id"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                value={fallbackAssetId}
              />
              <TextInput
                onChangeText={setFallbackAssetVersionId}
                placeholder="fallback version id"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                value={fallbackAssetVersionId}
              />
            </>
          ) : null}
          <TextInput
            multiline
            onChangeText={setAttestation}
            placeholder="Copyright attestation"
            placeholderTextColor={colors.textMuted}
            style={[styles.input, styles.attestation]}
            value={attestation}
          />
          <Pressable disabled={Boolean(busy)} onPress={() => void pickAndUpload()} style={styles.button}>
            {busy === 'upload' ? (
              <ActivityIndicator color={colors.gold} />
            ) : (
              <Text style={styles.buttonLabel}>
                {category === 'entry-effect' ? 'اختيار Lottie JSON وإرسال للمراجعة' : 'رفع وإرسال للمراجعة'}
              </Text>
            )}
          </Pressable>
        </>
      ) : null}
      {submissions.map((submission) => (
        <View key={submission.submissionId} style={styles.card}>
          <Text style={styles.cardTitle}>{submission.category} · {submission.status}</Text>
          <Text style={styles.copy}>{submission.submissionId}</Text>
          {submission.status === 'approved' && flags.customRendering && submission.approvedAssetId ? (
            <View style={styles.row}>
              <Pressable disabled={Boolean(busy)} onPress={() => void equip(submission)} style={styles.button}>
                <Text style={styles.buttonLabel}>تجهيز</Text>
              </Pressable>
              <Pressable
                disabled={Boolean(busy)}
                onPress={() => void unequip(submission.category as CustomCosmeticCategory)}
                style={styles.buttonSecondary}
              >
                <Text style={styles.buttonLabel}>إلغاء التجهيز</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

async function pickStaticImage() {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('PERMISSION_DENIED');
  const picked = await ImagePicker.launchImageLibraryAsync({
    allowsEditing: false,
    mediaTypes: ['images'],
    quality: 1,
  });
  if (picked.canceled || !picked.assets[0]) return undefined;
  const asset = picked.assets[0];
  const contentType = asset.mimeType === 'image/jpeg' || asset.mimeType === 'image/png'
    ? asset.mimeType
    : '';
  if (!contentType) throw new Error('UNSUPPORTED_FORMAT');
  return {
    contentType,
    sizeBytes: Number(asset.fileSize || new File(asset.uri).size || 0),
    uri: asset.uri,
  };
}

async function pickEntryEffectLottie() {
  const picked = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: false,
    type: ['application/json', 'text/plain', 'application/octet-stream'],
  });
  if (picked.canceled || !picked.assets[0]) return undefined;
  const asset = picked.assets[0];
  const contentType = resolveLottieContentType(asset.mimeType, asset.name);
  if (!contentType) throw new Error('UNSUPPORTED_FORMAT');
  if (/\.mp4$/i.test(asset.name || '') || String(asset.mimeType || '').startsWith('video/')) {
    throw new Error('CUSTOM_MP4_DISABLED');
  }
  const sizeBytes = Number(asset.size || new File(asset.uri).size || 0);
  return { contentType, sizeBytes, uri: asset.uri };
}

function resolveLottieContentType(mimeType: string | undefined, name: string | undefined) {
  const mime = String(mimeType || '').trim().toLowerCase();
  if (mime === 'application/json') return 'application/json';
  if (
    /\.json$/i.test(name || '')
    && (mime === '' || mime === 'text/plain' || mime === 'application/octet-stream')
  ) {
    return 'application/json';
  }
  return '';
}

const styles = StyleSheet.create({
  attestation: { minHeight: 72 },
  button: {
    alignItems: 'center',
    backgroundColor: 'rgba(214,168,79,0.18)',
    borderColor: 'rgba(214,168,79,0.45)',
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  buttonLabel: { color: colors.goldSoft, fontWeight: typography.weights.bold },
  buttonSecondary: {
    alignItems: 'center',
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  cardTitle: { color: colors.goldSoft, fontWeight: typography.weights.bold },
  chip: {
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  chipActive: { backgroundColor: 'rgba(214,168,79,0.2)', borderColor: colors.gold },
  chipLabel: { color: colors.text, fontSize: 12 },
  copy: { color: colors.textMuted, lineHeight: 20 },
  error: { color: '#ffb4b4' },
  input: {
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  root: { gap: spacing.sm, paddingVertical: spacing.md },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  title: { color: colors.goldSoft, fontSize: 18, fontWeight: typography.weights.black },
});
