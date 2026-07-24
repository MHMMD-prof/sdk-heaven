import {
  Image,
  ImageSourcePropType,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { roomCountries } from '../data/roomCountries';
import { colors, radius, spacing, typography } from '../theme';
import { RoomCountryCode, VoiceRoomType } from '../types/voice';
import { normalizeInviteCode } from '../voice/roomProfile';
import { LuxuryInput } from './LuxuryInput';

const voiceIcon = require('../../assets/home/icons/voice.png') as ImageSourcePropType;
const gamesIcon = require('../../assets/home/icons/games.png') as ImageSourcePropType;
const addRoomIcon = require('../../assets/home/icons/add-room.png') as ImageSourcePropType;

export type CreateRoomModalProps = {
  errorMessage?: string;
  inviteCode: string;
  isCreating: boolean;
  isPrivateRoom: boolean;
  isVisible: boolean;
  selectedCountryCode: RoomCountryCode;
  selectedType: VoiceRoomType;
  onClose: () => void;
  onCreate: () => void;
  onInviteCodeChange: (inviteCode: string) => void;
  onSelectCountryCode: (countryCode: RoomCountryCode) => void;
  onSelectType: (type: VoiceRoomType) => void;
  onTogglePrivateRoom: () => void;
};

export function CreateRoomModal({
  errorMessage,
  inviteCode,
  isCreating,
  isPrivateRoom,
  isVisible,
  onClose,
  onCreate,
  onInviteCodeChange,
  onSelectCountryCode,
  onSelectType,
  onTogglePrivateRoom,
  selectedCountryCode,
  selectedType,
}: CreateRoomModalProps) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const normalizedInviteCode = normalizeInviteCode(inviteCode);
  const isCreateDisabled = isCreating || (isPrivateRoom && normalizedInviteCode.length < 6);
  const maxCardHeight = Math.max(300, height - insets.top - insets.bottom - spacing.xxl);

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={isVisible}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.modalOverlay}
      >
        <View style={[styles.modalCard, { maxHeight: maxCardHeight }]}>
          <ScrollView
            contentContainerStyle={styles.modalContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
          <View style={styles.modalHeader}>
            <Pressable
              accessibilityLabel="إغلاق"
              accessibilityRole="button"
              hitSlop={8}
              onPress={onClose}
              style={({ pressed }) => [styles.modalCloseButton, pressed && styles.pressed]}
            >
              <Text style={styles.modalCloseText}>×</Text>
            </Pressable>
            <View style={styles.modalCopy}>
              <Text style={styles.modalEyebrow}>إنشاء غرفة</Text>
              <Text style={styles.modalTitle}>غرفة جديدة</Text>
              <Text style={styles.modalSubtitle}>
                اختر نوع الغرفة والدولة، ويمكنك جعلها خاصة باستخدام رمز دعوة.
              </Text>
            </View>
          </View>

          <View style={styles.typeRow}>
            <TypeChoice
              icon={voiceIcon}
              isSelected={selectedType === 'voice'}
              label="مجلس صوتي"
              onPress={() => onSelectType('voice')}
            />
            <TypeChoice
              icon={gamesIcon}
              isSelected={selectedType === 'game'}
              label="غرفة ألعاب"
              onPress={() => onSelectType('game')}
            />
          </View>

          <View>
            <Text style={styles.sectionLabel}>الدولة</Text>
            <ScrollView
              accessibilityRole="radiogroup"
              contentContainerStyle={styles.countryRow}
              horizontal
              nestedScrollEnabled
              showsHorizontalScrollIndicator={false}
            >
              {roomCountries.map((country) => {
                const isSelected = selectedCountryCode === country.code;

                return (
                  <Pressable
                    accessibilityLabel={country.label}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: isSelected }}
                    key={country.code}
                    onPress={() => onSelectCountryCode(country.code)}
                    style={({ pressed }) => [
                      styles.countryChoice,
                      isSelected && styles.countryChoiceSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Image resizeMode="contain" source={country.flag} style={styles.countryFlag} />
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: isPrivateRoom }}
            onPress={onTogglePrivateRoom}
            style={({ pressed }) => [
              styles.privateToggle,
              isPrivateRoom && styles.privateToggleActive,
              pressed && styles.pressed,
            ]}
          >
            <View style={[styles.privateToggleDot, isPrivateRoom && styles.privateToggleDotActive]} />
            <View style={styles.privateToggleCopy}>
              <Text style={styles.privateToggleTitle}>غرفة خاصة</Text>
              <Text style={styles.privateToggleText}>
                لا يدخلها إلا من يملك رقم الغرفة ورمز الدعوة.
              </Text>
            </View>
          </Pressable>

          {isPrivateRoom ? (
            <LuxuryInput
              autoCapitalize="characters"
              label="رمز الدعوة"
              onChangeText={onInviteCodeChange}
              placeholder="مثال: MAJLIS7"
              value={inviteCode}
            />
          ) : null}

          {errorMessage ? (
            <View style={styles.errorNotice}>
              <Text style={styles.errorNoticeText}>{errorMessage}</Text>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={isCreateDisabled}
            onPress={onCreate}
            style={({ pressed }) => [
              styles.modalCreateButton,
              isCreateDisabled && styles.disabledButton,
              pressed && styles.pressed,
            ]}
          >
            <Image source={addRoomIcon} style={styles.modalCreateIcon} />
            <Text style={styles.modalCreateText}>{isCreating ? 'جارٍ الإنشاء…' : 'إنشاء الغرفة'}</Text>
          </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

type TypeChoiceProps = {
  icon: ImageSourcePropType;
  isSelected: boolean;
  label: string;
  onPress: () => void;
};

function TypeChoice({ icon, isSelected, label, onPress }: TypeChoiceProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: isSelected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.typeChoice,
        isSelected && styles.typeChoiceSelected,
        pressed && styles.pressed,
      ]}
    >
      <Image source={icon} style={[styles.typeChoiceIcon, !isSelected && styles.typeChoiceIconIdle]} />
      <Text style={[styles.typeChoiceText, isSelected && styles.typeChoiceTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(3, 2, 7, 0.82)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: '#120B0B',
    borderColor: colors.borderGold,
    borderRadius: radius.xl,
    borderWidth: 1,
    maxWidth: 520,
    overflow: 'hidden',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.45,
    shadowRadius: 28,
    width: '100%',
  },
  modalContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  modalHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  modalCloseButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  modalCloseText: {
    color: colors.goldSoft,
    fontSize: 28,
    lineHeight: 32,
  },
  modalCopy: {
    flex: 1,
  },
  modalEyebrow: {
    color: colors.gold,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  modalTitle: {
    color: colors.text,
    fontSize: typography.sizes.title,
    fontWeight: typography.weights.black,
    marginTop: spacing.xs,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  modalSubtitle: {
    color: colors.textMuted,
    fontSize: typography.sizes.caption,
    lineHeight: 21,
    marginTop: spacing.sm,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  typeRow: {
    flexDirection: 'row-reverse',
    gap: spacing.md,
  },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    marginBottom: spacing.sm,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  countryRow: {
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    paddingVertical: 2,
  },
  countryChoice: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 52,
    width: 58,
  },
  countryChoiceSelected: {
    backgroundColor: 'rgba(232, 190, 97, 0.12)',
    borderColor: colors.gold,
  },
  countryFlag: {
    borderRadius: 3,
    height: 22,
    width: 34,
  },
  privateToggle: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: spacing.md,
    padding: spacing.md,
  },
  privateToggleActive: {
    backgroundColor: 'rgba(232, 190, 97, 0.10)',
    borderColor: colors.gold,
  },
  privateToggleDot: {
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    height: 24,
    width: 24,
  },
  privateToggleDotActive: {
    backgroundColor: colors.gold,
    borderColor: colors.goldSoft,
  },
  privateToggleCopy: {
    flex: 1,
  },
  privateToggleTitle: {
    color: colors.text,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  privateToggleText: {
    color: colors.textMuted,
    fontSize: typography.sizes.caption,
    marginTop: 2,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  typeChoice: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    minHeight: 54,
    paddingHorizontal: spacing.md,
  },
  typeChoiceSelected: {
    backgroundColor: 'rgba(232, 190, 97, 0.12)',
    borderColor: colors.borderGold,
  },
  typeChoiceIcon: {
    height: 34,
    resizeMode: 'contain',
    width: 34,
  },
  typeChoiceIconIdle: {
    opacity: 0.45,
  },
  typeChoiceText: {
    color: colors.textMuted,
    flex: 1,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  typeChoiceTextSelected: {
    color: colors.goldSoft,
  },
  modalCreateButton: {
    alignItems: 'center',
    backgroundColor: colors.gold,
    borderRadius: radius.full,
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: spacing.lg,
  },
  modalCreateText: {
    color: colors.backgroundDeep,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.black,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  modalCreateIcon: {
    height: 30,
    resizeMode: 'contain',
    width: 30,
  },
  errorNotice: {
    backgroundColor: 'rgba(185,38,52,0.12)',
    borderColor: 'rgba(225,85,96,0.38)',
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  errorNoticeText: {
    color: '#F3A7AD',
    fontSize: typography.sizes.caption,
    lineHeight: 19,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  disabledButton: {
    opacity: 0.62,
  },
  pressed: {
    opacity: 0.86,
  },
});
