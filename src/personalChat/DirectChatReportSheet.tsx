import { useEffect, useState } from 'react';
import { ActivityIndicator, I18nManager, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, radius, spacing, typography } from '../theme';
import { recordPersonalChatBreadcrumb } from '../observability/personalChatTelemetry';
import { DIRECT_CHAT_REPORT_CATEGORIES, type DirectChatReportCategory } from './directChatContract';
import { useReducedMotion } from './useReducedMotion';

const DETAILS_MAX_LENGTH = 500;
const t = (arabic: string, english: string) => I18nManager.isRTL ? arabic : english;
const TEXT_ALIGN = I18nManager.isRTL ? 'right' as const : 'left' as const;
const WRITING_DIRECTION = I18nManager.isRTL ? 'rtl' as const : 'ltr' as const;

const CATEGORY_LABELS: Record<DirectChatReportCategory, { ar: string; en: string }> = {
  harassment: { ar: 'مضايقة أو تنمر', en: 'Harassment or bullying' },
  hate: { ar: 'خطاب كراهية', en: 'Hate speech' },
  'sexual-content': { ar: 'محتوى جنسي', en: 'Sexual content' },
  threat: { ar: 'تهديد أو عنف', en: 'Threat or violence' },
  underage: { ar: 'حساب دون السن', en: 'Underage account' },
  spam: { ar: 'رسائل مزعجة', en: 'Spam' },
  scam: { ar: 'نصب أو احتيال', en: 'Scam or fraud' },
  'personal-information': { ar: 'نشر معلومات شخصية', en: 'Sharing personal information' },
  impersonation: { ar: 'انتحال شخصية', en: 'Impersonation' },
  other: { ar: 'سبب آخر', en: 'Something else' },
};

export function DirectChatReportSheet({
  messageCount,
  onClose,
  onSubmit,
  open,
}: {
  messageCount: number;
  onClose: () => void;
  onSubmit: (category: DirectChatReportCategory, details: string) => Promise<void>;
  open: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const [category, setCategory] = useState<DirectChatReportCategory>();
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      recordPersonalChatBreadcrumb('report-sheet-opened', { outcome: 'success' });
      return;
    }
    setCategory(undefined);
    setDetails('');
    setError('');
    setSubmitting(false);
  }, [open]);

  const submit = async () => {
    if (!category || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await onSubmit(category, details.trim());
      recordPersonalChatBreadcrumb('report-submitted', { outcome: 'success' });
    } catch (cause) {
      recordPersonalChatBreadcrumb('report-submit-failed', { error_code: 'REPORT_SUBMIT', outcome: 'failure' });
      setError(cause instanceof Error ? cause.message : t('تعذر إرسال البلاغ.', 'Could not send the report.'));
      setSubmitting(false);
    }
  };

  return (
    <Modal animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={onClose} transparent visible={open}>
      <View style={styles.backdrop}>
        <Pressable
          accessibilityLabel={t('إغلاق الإبلاغ', 'Close report')}
          accessibilityRole="button"
          onPress={onClose}
          style={styles.backdropFill}
        />
        <View accessibilityViewIsModal style={styles.sheet}>
          <Text maxFontSizeMultiplier={2} style={styles.title}>{t('الإبلاغ عن محتوى', 'Report content')}</Text>
          <Text maxFontSizeMultiplier={2} style={styles.body}>
            {t(
              `سيتم إرسال ${messageCount} رسالة محددة مع سياق محدود إلى فريق السلامة. لا يمكن لفريق السلامة تصفح محادثتك.`,
              `${messageCount} selected message(s) plus limited context will be sent to the safety team. Staff cannot browse your conversation.`,
            )}
          </Text>

          <ScrollView keyboardShouldPersistTaps="handled" style={styles.list}>
            {DIRECT_CHAT_REPORT_CATEGORIES.map((value) => (
              <Pressable
                accessibilityLabel={t(CATEGORY_LABELS[value].ar, CATEGORY_LABELS[value].en)}
                accessibilityRole="radio"
                accessibilityState={{ checked: category === value }}
                key={value}
                onPress={() => setCategory(value)}
                style={[styles.option, category === value && styles.optionSelected]}
              >
                <Text maxFontSizeMultiplier={2} style={[styles.optionText, category === value && styles.optionTextSelected]}>
                  {t(CATEGORY_LABELS[value].ar, CATEGORY_LABELS[value].en)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <TextInput
            accessibilityLabel={t('تفاصيل إضافية', 'Extra details')}
            editable={!submitting}
            maxFontSizeMultiplier={2}
            maxLength={DETAILS_MAX_LENGTH}
            multiline
            onChangeText={setDetails}
            placeholder={t('تفاصيل إضافية (اختياري)', 'Extra details (optional)')}
            placeholderTextColor={colors.textMuted}
            style={styles.details}
            value={details}
          />

          {error ? <Text maxFontSizeMultiplier={2} style={styles.error}>{error}</Text> : null}

          <View style={styles.actions}>
            <Pressable
              accessibilityLabel={t('إلغاء', 'Cancel')}
              accessibilityRole="button"
              disabled={submitting}
              onPress={onClose}
              style={[styles.action, submitting && styles.disabled]}
            >
              <Text maxFontSizeMultiplier={2} style={styles.actionText}>{t('إلغاء', 'Cancel')}</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={t('إرسال البلاغ', 'Send report')}
              accessibilityRole="button"
              accessibilityState={{ disabled: !category || submitting }}
              disabled={!category || submitting}
              onPress={() => void submit()}
              style={[styles.action, styles.primary, (!category || submitting) && styles.disabled]}
            >
              {submitting
                ? <ActivityIndicator color="#2A0B0E" size="small" />
                : <Text maxFontSizeMultiplier={2} style={[styles.actionText, styles.primaryText]}>{t('إرسال البلاغ', 'Send report')}</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  action: { alignItems: 'center', borderColor: colors.borderGold, borderRadius: radius.full, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 46, paddingHorizontal: spacing.md },
  actionText: { color: colors.goldSoft, fontSize: 14, fontWeight: typography.weights.bold },
  actions: { flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.md },
  backdrop: { backgroundColor: 'rgba(0,0,0,.72)', flex: 1, justifyContent: 'flex-end' },
  backdropFill: { flex: 1 },
  body: { color: colors.textMuted, fontSize: 12, paddingBottom: spacing.md, textAlign: TEXT_ALIGN, writingDirection: WRITING_DIRECTION },
  details: { borderColor: colors.borderGold, borderRadius: radius.md, borderWidth: 1, color: colors.text, marginTop: spacing.md, maxHeight: 96, minHeight: 46, padding: spacing.sm, textAlign: TEXT_ALIGN, writingDirection: WRITING_DIRECTION },
  disabled: { opacity: 0.4 },
  error: { color: '#FF9DA7', fontSize: 12, paddingTop: spacing.sm, textAlign: TEXT_ALIGN },
  list: { maxHeight: 260 },
  option: { backgroundColor: '#1A0A0C', borderColor: colors.borderGold, borderRadius: radius.md, borderWidth: 1, marginBottom: spacing.xs, minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  optionSelected: { backgroundColor: '#3A1015', borderColor: colors.gold },
  optionText: { color: colors.text, fontSize: 14, textAlign: TEXT_ALIGN, writingDirection: WRITING_DIRECTION },
  optionTextSelected: { color: colors.goldSoft, fontWeight: typography.weights.bold },
  primary: { backgroundColor: colors.gold, borderColor: colors.gold },
  primaryText: { color: '#2A0B0E' },
  sheet: { backgroundColor: '#120707', borderColor: colors.borderGold, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, maxHeight: '92%', padding: spacing.lg },
  title: { color: colors.goldSoft, fontSize: 18, fontWeight: typography.weights.black, paddingBottom: spacing.xs, textAlign: TEXT_ALIGN, writingDirection: WRITING_DIRECTION },
});
