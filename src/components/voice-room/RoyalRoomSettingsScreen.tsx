import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, spacing, typography } from '../../theme';
import type { RoomSettingsPatch } from '../../voice/requestRoomCommand';
import type {
  RoomChatMode,
  RoomEffectsPolicy,
  RoomHistoryVisibility,
  RoomKeywordFilterMode,
} from '../../voice/roomV2Contract';
import {
  RoomChatSettings,
  RoomCopySettings,
  RoomSettingsSection,
  roomChatSettings,
  roomCopySettings,
  roomSettingsEqual,
} from '../../voice/roomSettingsModel';
import { RoomThemePicker } from './RoomThemePicker';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function RoomSettingsSheet({
  currentThemeId,
  errorMessage,
  initialSettings,
  mediaEnabled,
  mediaErrorMessage,
  mediaPending,
  mediaStatus,
  onClose,
  onOpenMicrophones,
  onSaveSection,
  onSelectRoomImage,
  purchasesEnabled,
  roomId,
  roomTitle,
  saving,
  seatTargetCount,
  themesEnabled,
  visible,
}: {
  currentThemeId: string;
  errorMessage?: string;
  initialSettings: Required<RoomSettingsPatch>;
  mediaEnabled: boolean;
  mediaErrorMessage?: string;
  mediaPending: boolean;
  mediaStatus: 'none' | 'pending' | 'approved' | 'rejected' | 'removed';
  onClose: () => void;
  onOpenMicrophones: () => void;
  onSaveSection: (settings: RoomSettingsPatch) => Promise<void>;
  onSelectRoomImage: () => Promise<void>;
  purchasesEnabled: boolean;
  roomId: string;
  roomTitle: string;
  saving: boolean;
  seatTargetCount: 5 | 10 | 15 | 20;
  themesEnabled: boolean;
  visible: boolean;
}) {
  const insets = useSafeAreaInsets();
  const wasVisible = useRef(false);
  const lastSyncedSettings = useRef(initialSettings);
  const [activeSection, setActiveSection] = useState<RoomSettingsSection>('room');
  const [roomDraft, setRoomDraft] = useState<RoomCopySettings>(() => roomCopySettings(initialSettings));
  const [roomBaseline, setRoomBaseline] = useState<RoomCopySettings>(() => roomCopySettings(initialSettings));
  const [chatDraft, setChatDraft] = useState<RoomChatSettings>(() => roomChatSettings(initialSettings));
  const [chatBaseline, setChatBaseline] = useState<RoomChatSettings>(() => roomChatSettings(initialSettings));
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [localError, setLocalError] = useState('');

  const roomDirty = !roomSettingsEqual(roomDraft, roomBaseline);
  const chatDirty = !roomSettingsEqual(chatDraft, chatBaseline);
  const hasUnsavedChanges = roomDirty || chatDirty;

  useEffect(() => {
    if (visible && !wasVisible.current) {
      const nextRoom = roomCopySettings(initialSettings);
      const nextChat = roomChatSettings(initialSettings);
      setRoomDraft(nextRoom);
      setRoomBaseline(nextRoom);
      setChatDraft(nextChat);
      setChatBaseline(nextChat);
      setActiveSection('room');
      setSaveState('idle');
      setLocalError('');
      lastSyncedSettings.current = initialSettings;
    }
    wasVisible.current = visible;
  }, [initialSettings, visible]);

  useEffect(() => {
    if (!visible || lastSyncedSettings.current === initialSettings) return;
    lastSyncedSettings.current = initialSettings;
    if (!roomDirty) {
      const next = roomCopySettings(initialSettings);
      setRoomDraft(next);
      setRoomBaseline(next);
    }
    if (!chatDirty) {
      const next = roomChatSettings(initialSettings);
      setChatDraft(next);
      setChatBaseline(next);
    }
  }, [chatDirty, initialSettings, roomDirty, visible]);

  const requestClose = () => {
    if (!hasUnsavedChanges) {
      onClose();
      return;
    }
    Alert.alert(
      'تجاهل التغييرات؟',
      'لديك تغييرات لم تُحفظ بعد.',
      [
        { text: 'متابعة التعديل', style: 'cancel' },
        { text: 'تجاهل', style: 'destructive', onPress: onClose },
      ],
    );
  };

  const openMicrophones = () => {
    if (!hasUnsavedChanges) {
      onOpenMicrophones();
      return;
    }
    Alert.alert(
      'تغييرات غير محفوظة',
      'احفظ تغييراتك أو تجاهلها قبل الانتقال إلى إدارة المقاعد.',
      [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'تجاهل والانتقال', style: 'destructive', onPress: onOpenMicrophones },
      ],
    );
  };

  const saveActiveSection = async () => {
    const patch = activeSection === 'room' ? roomDraft : activeSection === 'chat' ? chatDraft : null;
    if (!patch) return;
    setSaveState('saving');
    setLocalError('');
    try {
      await onSaveSection(patch);
      if (activeSection === 'room') setRoomBaseline({ ...roomDraft });
      if (activeSection === 'chat') setChatBaseline({ ...chatDraft });
      setSaveState('saved');
    } catch (error) {
      setSaveState('error');
      setLocalError(error instanceof Error ? error.message : 'تعذر حفظ الإعدادات. حاول مرة أخرى.');
    }
  };

  const activeDirty = activeSection === 'room' ? roomDirty : activeSection === 'chat' ? chatDirty : false;
  const displayedError = localError || errorMessage;

  return (
    <Modal
      animationType="slide"
      onRequestClose={requestClose}
      presentationStyle="fullScreen"
      statusBarTranslucent
      visible={visible}
    >
      <LinearGradient colors={['#070304', '#180607', '#030202']} style={styles.screen}>
        <View pointerEvents="none" style={styles.rubyGlow} />
        <View pointerEvents="none" style={styles.goldHalo} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.keyboard, { paddingTop: Math.max(insets.top, spacing.md) }]}
        >
          <RoyalHeader onClose={requestClose} roomId={roomId} roomTitle={roomTitle} />
          <SettingsTabs active={activeSection} onChange={(section) => {
            setActiveSection(section);
            setSaveState('idle');
            setLocalError('');
          }} />
          <View style={styles.contentFrame}>
            {activeSection === 'room' ? (
              <RoomSection
                draft={roomDraft}
                onChange={setRoomDraft}
                onOpenMicrophones={openMicrophones}
                seatTargetCount={seatTargetCount}
              />
            ) : null}
            {activeSection === 'appearance' ? (
              <AppearanceSection
                currentThemeId={currentThemeId}
                mediaEnabled={mediaEnabled}
                mediaErrorMessage={mediaErrorMessage}
                mediaPending={mediaPending}
                mediaStatus={mediaStatus}
                onSelectRoomImage={onSelectRoomImage}
                purchasesEnabled={purchasesEnabled}
                roomId={roomId}
                themesEnabled={themesEnabled}
                visible={visible}
              />
            ) : null}
            {activeSection === 'chat' ? (
              <ChatSection draft={chatDraft} onChange={setChatDraft} />
            ) : null}
          </View>
          {activeSection !== 'appearance' ? (
            <SaveFooter
              bottomInset={insets.bottom}
              dirty={activeDirty}
              error={displayedError}
              onSave={() => void saveActiveSection()}
              saveState={saving || saveState === 'saving' ? 'saving' : saveState}
            />
          ) : (
            <View style={[styles.immediateFooter, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}> 
              <SymbolView name={{ ios: 'bolt.fill', android: 'bolt', web: 'bolt' }} size={15} tintColor={colors.goldSoft} />
              <Text style={styles.immediateText}>تغييرات المظهر تُطبق مباشرة ولا تحتاج إلى زر حفظ</Text>
            </View>
          )}
        </KeyboardAvoidingView>
      </LinearGradient>
    </Modal>
  );
}

function RoyalHeader({ onClose, roomId, roomTitle }: { onClose: () => void; roomId: string; roomTitle: string }) {
  return (
    <View style={styles.header}>
      <Pressable accessibilityLabel="إغلاق إعدادات الغرفة" accessibilityRole="button" onPress={onClose} style={styles.backButton}>
        <SymbolView name={{ ios: 'chevron.right', android: 'arrow_forward', web: 'arrow_forward' }} size={21} tintColor={colors.goldSoft} />
      </Pressable>
      <View style={styles.headerCopy}>
        <View style={styles.eyebrowRow}>
          <View style={styles.eyebrowLine} />
          <Text style={styles.eyebrow}>لوحة المالك</Text>
          <View style={styles.eyebrowLine} />
        </View>
        <Text numberOfLines={1} style={styles.headerTitle}>إعدادات الغرفة</Text>
        <Text numberOfLines={1} style={styles.headerMeta}>{roomTitle} · ID {roomId}</Text>
      </View>
      <LinearGradient colors={['#F5DA95', '#B87922']} style={styles.crownMedallion}>
        <SymbolView name={{ ios: 'crown.fill', android: 'workspace_premium', web: 'workspace_premium' }} size={20} tintColor="#351006" />
      </LinearGradient>
    </View>
  );
}

function SettingsTabs({ active, onChange }: { active: RoomSettingsSection; onChange: (section: RoomSettingsSection) => void }) {
  const tabs: Array<{ id: RoomSettingsSection; label: string; icon: React.ComponentProps<typeof SymbolView>['name'] }> = [
    { id: 'room', label: 'الغرفة', icon: { ios: 'house.fill', android: 'home', web: 'home' } },
    { id: 'appearance', label: 'المظهر', icon: { ios: 'paintpalette.fill', android: 'palette', web: 'palette' } },
    { id: 'chat', label: 'الدردشة والأمان', icon: { ios: 'shield.fill', android: 'shield', web: 'shield' } },
  ];
  return (
    <View accessibilityRole="tablist" style={styles.tabs}>
      {tabs.map((tab) => {
        const selected = active === tab.id;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={tab.id}
            onPress={() => onChange(tab.id)}
            style={({ pressed }) => [styles.tab, selected && styles.tabSelected, pressed && styles.pressed]}
          >
            {selected ? <LinearGradient colors={['#8E1F2F', '#4A0B12']} style={StyleSheet.absoluteFill} /> : null}
            <SymbolView name={tab.icon} size={16} tintColor={selected ? colors.goldSoft : '#A88E67'} />
            <Text numberOfLines={1} style={[styles.tabLabel, selected && styles.tabLabelSelected]}>{tab.label}</Text>
            {selected ? <View style={styles.tabGlint} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function RoomSection({
  draft,
  onChange,
  onOpenMicrophones,
  seatTargetCount,
}: {
  draft: RoomCopySettings;
  onChange: (value: RoomCopySettings) => void;
  onOpenMicrophones: () => void;
  seatTargetCount: number;
}) {
  return (
    <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
      <SectionIntro title="هوية الغرفة" text="اضبط الرسائل التي يراها الضيوف وأدر المقاعد من مكان واضح." />
      <RoyalCard icon={{ ios: 'megaphone.fill', android: 'campaign', web: 'campaign' }} title="إعلان الغرفة" note="يظهر مثبتاً أعلى الغرفة للجميع">
        <Counter value={draft.announcement.length} limit={160} />
        <TextInput
          accessibilityLabel="إعلان الغرفة"
          maxLength={160}
          multiline
          onChangeText={(announcement) => onChange({ ...draft, announcement })}
          placeholder="اكتب إعلاناً قصيراً وواضحاً"
          placeholderTextColor="#806D66"
          style={styles.royalTextArea}
          textAlign="right"
          value={draft.announcement}
        />
      </RoyalCard>
      <RoyalCard icon={{ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }} title="رسالة الترحيب" note="تظهر للعضو عند دخوله الغرفة">
        <Counter value={draft.welcomeMessage.length} limit={200} />
        <TextInput
          accessibilityLabel="رسالة الترحيب"
          maxLength={200}
          multiline
          onChangeText={(welcomeMessage) => onChange({ ...draft, welcomeMessage })}
          placeholder="رحّب بضيوف الغرفة"
          placeholderTextColor="#806D66"
          style={styles.royalTextArea}
          textAlign="right"
          value={draft.welcomeMessage}
        />
      </RoyalCard>
      <Pressable accessibilityRole="button" onPress={onOpenMicrophones} style={({ pressed }) => [styles.seatShortcut, pressed && styles.pressed]}>
        <LinearGradient colors={['rgba(105,19,29,0.72)', 'rgba(24,7,8,0.95)']} style={StyleSheet.absoluteFill} />
        <View style={styles.shortcutIcon}>
          <SymbolView name={{ ios: 'mic.fill', android: 'mic', web: 'mic' }} size={23} tintColor={colors.goldSoft} />
        </View>
        <View style={styles.shortcutCopy}>
          <Text style={styles.cardTitle}>المقاعد والميكروفونات</Text>
          <Text style={styles.cardNote}>عدد المقاعد الحالي: {seatTargetCount} · اضغط للإدارة</Text>
        </View>
        <SymbolView name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }} size={20} tintColor={colors.goldSoft} />
      </Pressable>
    </ScrollView>
  );
}

function AppearanceSection({
  currentThemeId,
  mediaEnabled,
  mediaErrorMessage,
  mediaPending,
  mediaStatus,
  onSelectRoomImage,
  purchasesEnabled,
  roomId,
  themesEnabled,
  visible,
}: {
  currentThemeId: string;
  mediaEnabled: boolean;
  mediaErrorMessage?: string;
  mediaPending: boolean;
  mediaStatus: 'none' | 'pending' | 'approved' | 'rejected' | 'removed';
  onSelectRoomImage: () => Promise<void>;
  purchasesEnabled: boolean;
  roomId: string;
  themesEnabled: boolean;
  visible: boolean;
}) {
  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <SectionIntro title="مظهر الغرفة" text="اختر هوية بصرية فاخرة أو أرسل صورة مخصصة للمراجعة." />
      <RoyalCard icon={{ ios: 'photo.fill', android: 'image', web: 'image' }} title="صورة الغرفة" note={roomImageStatusLabel(mediaStatus)}>
        <View style={styles.mediaStatusRow}>
          <View style={[styles.mediaStatusBadge, mediaStatus === 'rejected' && styles.mediaStatusDanger]}>
            <Text style={styles.mediaStatusText}>{roomImageStatusShort(mediaStatus)}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={!mediaEnabled || mediaPending}
            onPress={() => void onSelectRoomImage().catch(() => undefined)}
            style={({ pressed }) => [styles.outlineButton, (!mediaEnabled || mediaPending) && styles.disabled, pressed && styles.pressed]}
          >
            <SymbolView name={{ ios: 'photo.badge.plus', android: 'add_photo_alternate', web: 'add_photo_alternate' }} size={17} tintColor={colors.goldSoft} />
            <Text style={styles.outlineButtonText}>{mediaPending ? 'جارٍ الرفع…' : mediaStatus === 'none' ? 'اختيار صورة' : 'استبدال الصورة'}</Text>
          </Pressable>
        </View>
        {!mediaEnabled ? <Text style={styles.inlineHint}>رفع الصور غير متاح حالياً.</Text> : null}
        {mediaErrorMessage ? <Text style={styles.inlineError}>{mediaErrorMessage}</Text> : null}
      </RoyalCard>
      <RoomThemePicker
        currentThemeId={currentThemeId}
        enabled={themesEnabled}
        purchasesEnabled={purchasesEnabled}
        roomId={roomId}
        visible={visible}
      />
    </ScrollView>
  );
}

function ChatSection({ draft, onChange }: { draft: RoomChatSettings; onChange: (value: RoomChatSettings) => void }) {
  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <SectionIntro title="الدردشة والأمان" text="تحكم في من يكتب وكيف تُعرض الرسائل والمؤثرات داخل الغرفة." />
      <RoyalCard icon={{ ios: 'bubble.left.and.bubble.right.fill', android: 'forum', web: 'forum' }} title="من يمكنه الدردشة" note="حدد الجمهور المسموح له بإرسال الرسائل">
        <RoyalSegments
          onChange={(chatMode) => onChange({ ...draft, chatMode: chatMode as RoomChatMode })}
          options={[['everyone', 'الجميع'], ['followers', 'المتابعون'], ['off', 'متوقفة']]}
          value={draft.chatMode}
        />
      </RoyalCard>
      <RoyalCard icon={{ ios: 'timer', android: 'timer', web: 'timer' }} title="الوضع البطيء" note="يفرض انتظاراً بين الرسائل لتقليل الإزعاج">
        <RoyalSegments
          onChange={(value) => onChange({ ...draft, slowModeSeconds: Number(value) as 0 | 5 | 10 | 30 | 60 })}
          options={[['0', 'إيقاف'], ['5', '5 ث'], ['10', '10 ث'], ['30', '30 ث'], ['60', '60 ث']]}
          value={String(draft.slowModeSeconds)}
        />
      </RoyalCard>
      <RoyalCard icon={{ ios: 'clock.arrow.circlepath', android: 'history', web: 'history' }} title="سجل الرسائل" note="حدد الرسائل التي يمكن للمنضم حديثاً رؤيتها">
        <RoyalSegments
          onChange={(historyVisibility) => onChange({ ...draft, historyVisibility: historyVisibility as RoomHistoryVisibility })}
          options={[['everyone', 'للجميع'], ['after-join', 'منذ الدخول'], ['hidden', 'مخفي']]}
          value={draft.historyVisibility}
        />
      </RoyalCard>
      <RoyalCard icon={{ ios: 'text.badge.checkmark', android: 'rule', web: 'rule' }} title="فلتر الكلمات" note="يساعد في إخفاء الكلمات المسيئة تلقائياً">
        <RoyalSegments
          onChange={(keywordFilterMode) => onChange({ ...draft, keywordFilterMode: keywordFilterMode as RoomKeywordFilterMode })}
          options={[['off', 'متوقف'], ['standard', 'قياسي'], ['strict', 'مشدّد']]}
          value={draft.keywordFilterMode}
        />
      </RoyalCard>
      <RoyalCard icon={{ ios: 'wand.and.stars', android: 'auto_fix_high', web: 'auto_fix_high' }} title="مؤثرات الدخول والهدايا" note="خفّض المؤثرات في الغرف الهادئة أو أوقفها">
        <RoyalSegments
          onChange={(effectsPolicy) => onChange({ ...draft, effectsPolicy: effectsPolicy as RoomEffectsPolicy })}
          options={[['full', 'كاملة'], ['reduced', 'مخففة'], ['off', 'متوقفة']]}
          value={draft.effectsPolicy}
        />
      </RoyalCard>
    </ScrollView>
  );
}

function RoyalCard({ children, icon, note, title }: { children: React.ReactNode; icon: React.ComponentProps<typeof SymbolView>['name']; note: string; title: string }) {
  return (
    <View style={styles.card}>
      <LinearGradient colors={['rgba(111,20,30,0.22)', 'rgba(12,5,6,0.05)']} style={StyleSheet.absoluteFill} />
      <View pointerEvents="none" style={styles.cardCorner} />
      <View style={styles.cardHeader}>
        <View style={styles.cardIcon}>
          <SymbolView name={icon} size={18} tintColor={colors.goldSoft} />
        </View>
        <View style={styles.cardHeaderCopy}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.cardNote}>{note}</Text>
        </View>
      </View>
      {children}
    </View>
  );
}

function SectionIntro({ text, title }: { text: string; title: string }) {
  return (
    <View style={styles.sectionIntro}>
      <View style={styles.introDiamond} />
      <View style={styles.introCopy}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionText}>{text}</Text>
      </View>
    </View>
  );
}

function Counter({ limit, value }: { limit: number; value: number }) {
  return <Text style={styles.counter}>{value}/{limit}</Text>;
}

function RoyalSegments({ onChange, options, value }: { onChange: (value: string) => void; options: Array<[string, string]>; value: string }) {
  return (
    <View style={styles.segmentRow}>
      {options.map(([id, label]) => {
        const selected = id === value;
        return (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            key={id}
            onPress={() => onChange(id)}
            style={({ pressed }) => [styles.segment, selected && styles.segmentSelected, pressed && styles.pressed]}
          >
            {selected ? <LinearGradient colors={['#8F2334', '#59101A']} style={StyleSheet.absoluteFill} /> : null}
            <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SaveFooter({ bottomInset, dirty, error, onSave, saveState }: { bottomInset: number; dirty: boolean; error?: string; onSave: () => void; saveState: SaveState }) {
  const disabled = !dirty || saveState === 'saving';
  return (
    <View style={[styles.saveFooter, { paddingBottom: Math.max(bottomInset, spacing.md) }]}> 
      {error ? <Text numberOfLines={2} style={styles.footerError}>{error}</Text> : null}
      {saveState === 'saved' && !dirty ? <Text style={styles.savedText}>تم حفظ هذا القسم بنجاح</Text> : null}
      <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onSave} style={({ pressed }) => [styles.saveButtonShell, disabled && styles.disabled, pressed && styles.pressed]}>
        <LinearGradient colors={['#D7AC55', '#9A6118']} style={styles.saveButton}>
          <SymbolView name={{ ios: 'checkmark.seal.fill', android: 'verified', web: 'verified' }} size={19} tintColor="#2E1305" />
          <Text style={styles.saveButtonText}>{saveState === 'saving' ? 'جارٍ الحفظ…' : dirty ? 'حفظ تغييرات القسم' : 'لا توجد تغييرات'}</Text>
        </LinearGradient>
      </Pressable>
    </View>
  );
}

function roomImageStatusShort(status: 'none' | 'pending' | 'approved' | 'rejected' | 'removed') {
  return { none: 'بدون صورة', pending: 'قيد المراجعة', approved: 'معتمدة', rejected: 'مرفوضة', removed: 'تمت الإزالة' }[status];
}

function roomImageStatusLabel(status: 'none' | 'pending' | 'approved' | 'rejected' | 'removed') {
  return {
    none: 'لا توجد صورة مخصصة حالياً',
    pending: 'الصورة الجديدة بانتظار مراجعة فريق الأمان',
    approved: 'الصورة الحالية معتمدة وتظهر في الغرفة',
    rejected: 'رُفضت آخر صورة؛ يمكنك اختيار صورة أخرى',
    removed: 'أزال فريق الأمان الصورة السابقة',
  }[status];
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  keyboard: { flex: 1 },
  rubyGlow: { backgroundColor: 'rgba(138,18,35,0.16)', borderRadius: 220, height: 440, position: 'absolute', right: -190, top: 80, width: 440 },
  goldHalo: { backgroundColor: 'rgba(224,176,76,0.055)', borderRadius: 180, bottom: 80, height: 360, left: -220, position: 'absolute', width: 360 },
  header: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, minHeight: 88, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  backButton: { alignItems: 'center', backgroundColor: 'rgba(53,11,14,0.86)', borderColor: 'rgba(232,190,97,0.42)', borderRadius: radius.full, borderWidth: 1, height: 46, justifyContent: 'center', width: 46 },
  headerCopy: { alignItems: 'flex-end', flex: 1 },
  eyebrowRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  eyebrowLine: { backgroundColor: 'rgba(232,190,97,0.45)', height: 1, width: 18 },
  eyebrow: { color: '#CBAA69', fontSize: 9, fontWeight: typography.weights.bold, writingDirection: 'rtl' },
  headerTitle: { color: colors.goldSoft, fontSize: 23, fontWeight: typography.weights.black, textAlign: 'right', writingDirection: 'rtl' },
  headerMeta: { color: '#9C8672', fontSize: 10, marginTop: 2, textAlign: 'right', writingDirection: 'rtl' },
  crownMedallion: { alignItems: 'center', borderRadius: radius.full, height: 46, justifyContent: 'center', shadowColor: colors.gold, shadowOpacity: 0.28, shadowRadius: 10, width: 46 },
  tabs: { backgroundColor: 'rgba(8,3,4,0.92)', borderColor: 'rgba(232,190,97,0.28)', borderRadius: 17, borderWidth: 1, flexDirection: 'row-reverse', marginHorizontal: spacing.lg, overflow: 'hidden' },
  tab: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 5, justifyContent: 'center', minHeight: 50, overflow: 'hidden', paddingHorizontal: 4, position: 'relative' },
  tabSelected: { borderColor: colors.gold, borderRadius: 15, borderWidth: 1 },
  tabLabel: { color: '#A88E67', fontSize: 10, fontWeight: typography.weights.bold, textAlign: 'center', writingDirection: 'rtl' },
  tabLabelSelected: { color: colors.goldSoft },
  tabGlint: { backgroundColor: colors.goldSoft, bottom: 0, height: 2, left: '28%', position: 'absolute', right: '28%' },
  contentFrame: { flex: 1 },
  scrollContent: { gap: spacing.md, paddingBottom: spacing.xl, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  sectionIntro: { alignItems: 'center', flexDirection: 'row-reverse', gap: spacing.sm, paddingHorizontal: spacing.xs },
  introDiamond: { backgroundColor: colors.gold, height: 9, transform: [{ rotate: '45deg' }], width: 9 },
  introCopy: { flex: 1 },
  sectionTitle: { color: colors.goldSoft, fontSize: typography.sizes.title, fontWeight: typography.weights.black, textAlign: 'right', writingDirection: 'rtl' },
  sectionText: { color: '#A99483', fontSize: 11, lineHeight: 17, marginTop: 2, textAlign: 'right', writingDirection: 'rtl' },
  card: { backgroundColor: 'rgba(16,6,7,0.94)', borderColor: 'rgba(211,157,59,0.38)', borderRadius: 19, borderWidth: 1, gap: spacing.sm, overflow: 'hidden', padding: spacing.md, position: 'relative' },
  cardCorner: { borderColor: 'rgba(232,190,97,0.36)', borderRightWidth: 1, borderTopWidth: 1, height: 20, position: 'absolute', right: 8, top: 8, width: 20 },
  cardHeader: { alignItems: 'center', flexDirection: 'row-reverse', gap: spacing.sm },
  cardIcon: { alignItems: 'center', backgroundColor: 'rgba(126,25,37,0.55)', borderColor: 'rgba(232,190,97,0.48)', borderRadius: 13, borderWidth: 1, height: 42, justifyContent: 'center', width: 42 },
  cardHeaderCopy: { flex: 1 },
  cardTitle: { color: '#FFF0D0', fontSize: 14, fontWeight: typography.weights.black, textAlign: 'right', writingDirection: 'rtl' },
  cardNote: { color: '#A38E7B', fontSize: 10, lineHeight: 15, marginTop: 2, textAlign: 'right', writingDirection: 'rtl' },
  counter: { color: '#9B8268', fontSize: 9, textAlign: 'left' },
  royalTextArea: { backgroundColor: 'rgba(3,2,2,0.74)', borderColor: 'rgba(232,190,97,0.27)', borderRadius: 13, borderWidth: 1, color: colors.text, fontSize: 14, minHeight: 92, padding: spacing.md, textAlignVertical: 'top', writingDirection: 'rtl' },
  seatShortcut: { alignItems: 'center', borderColor: 'rgba(232,190,97,0.48)', borderRadius: 19, borderWidth: 1, flexDirection: 'row-reverse', gap: spacing.sm, minHeight: 82, overflow: 'hidden', padding: spacing.md },
  shortcutIcon: { alignItems: 'center', backgroundColor: 'rgba(232,190,97,0.11)', borderColor: 'rgba(232,190,97,0.35)', borderRadius: radius.full, borderWidth: 1, height: 48, justifyContent: 'center', width: 48 },
  shortcutCopy: { flex: 1 },
  mediaStatusRow: { alignItems: 'center', flexDirection: 'row-reverse', gap: spacing.sm, justifyContent: 'space-between' },
  mediaStatusBadge: { backgroundColor: 'rgba(34,143,96,0.14)', borderColor: 'rgba(75,211,151,0.36)', borderRadius: radius.full, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: 8 },
  mediaStatusDanger: { backgroundColor: 'rgba(184,41,75,0.14)', borderColor: 'rgba(255,120,146,0.42)' },
  mediaStatusText: { color: colors.goldSoft, fontSize: 10, fontWeight: typography.weights.bold },
  outlineButton: { alignItems: 'center', backgroundColor: 'rgba(130,27,39,0.32)', borderColor: colors.borderGold, borderRadius: radius.full, borderWidth: 1, flexDirection: 'row-reverse', gap: 6, minHeight: 44, paddingHorizontal: spacing.md },
  outlineButtonText: { color: colors.goldSoft, fontSize: 11, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  inlineHint: { color: '#A38E7B', fontSize: 10, textAlign: 'right', writingDirection: 'rtl' },
  inlineError: { color: '#FFB3C1', fontSize: 10, textAlign: 'right', writingDirection: 'rtl' },
  segmentRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 7 },
  segment: { alignItems: 'center', backgroundColor: 'rgba(255,240,210,0.035)', borderColor: 'rgba(232,190,97,0.19)', borderRadius: 11, borderWidth: 1, flexGrow: 1, justifyContent: 'center', minHeight: 44, minWidth: 62, overflow: 'hidden', paddingHorizontal: 10, position: 'relative' },
  segmentSelected: { borderColor: colors.gold },
  segmentText: { color: '#A99483', fontSize: 10, fontWeight: typography.weights.bold, writingDirection: 'rtl' },
  segmentTextSelected: { color: colors.goldSoft },
  saveFooter: { backgroundColor: 'rgba(5,2,3,0.97)', borderTopColor: 'rgba(232,190,97,0.25)', borderTopWidth: 1, gap: 6, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  saveButtonShell: { borderRadius: 15, overflow: 'hidden' },
  saveButton: { alignItems: 'center', flexDirection: 'row-reverse', gap: spacing.sm, justifyContent: 'center', minHeight: 52 },
  saveButtonText: { color: '#2E1305', fontSize: 13, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  footerError: { color: '#FFB3C1', fontSize: 10, textAlign: 'center', writingDirection: 'rtl' },
  savedText: { color: '#7CDEAD', fontSize: 10, textAlign: 'center', writingDirection: 'rtl' },
  immediateFooter: { alignItems: 'center', backgroundColor: 'rgba(5,2,3,0.97)', borderTopColor: 'rgba(232,190,97,0.25)', borderTopWidth: 1, flexDirection: 'row-reverse', gap: spacing.sm, justifyContent: 'center', minHeight: 58, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  immediateText: { color: '#BDA57D', fontSize: 10, textAlign: 'center', writingDirection: 'rtl' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.76, transform: [{ scale: 0.985 }] },
});
