import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { colors, radius, spacing, typography } from '../../theme';
import { VoiceRoomMember } from '../../types/voice';
import {
  RoomBanRecord,
  RoomModerationEventRecord,
  RoomSeatInviteRecord,
  RoomSeatRequestRecord,
} from '../../voice/roomCommandCenterData';
import { RoomSettingsPatch } from '../../voice/requestRoomCommand';
import {
  RoomChatMode,
  RoomEffectsPolicy,
  RoomHistoryVisibility,
  RoomKeywordFilterMode,
  RoomSeatDocument,
  RoomSeatMode,
  RoomThemeId,
} from '../../voice/roomV2Contract';
import { RoomSheet } from './VoiceRoomSheets';
import { RepresentativeBadge } from '../RepresentativeBadge';

type PendingCheck = (action: string, targetUid?: string, seatId?: string) => boolean;

export function RoomSettingsSheet({
  errorMessage,
  initialSettings,
  mediaEnabled,
  mediaErrorMessage,
  mediaPending,
  mediaStatus,
  onClose,
  onSelectRoomImage,
  onSave,
  saving,
  visible,
}: {
  errorMessage?: string;
  initialSettings: Required<RoomSettingsPatch>;
  mediaEnabled: boolean;
  mediaErrorMessage?: string;
  mediaPending: boolean;
  mediaStatus: 'none' | 'pending' | 'approved' | 'rejected' | 'removed';
  onClose: () => void;
  onSelectRoomImage: () => Promise<void>;
  onSave: (settings: RoomSettingsPatch) => Promise<void>;
  saving: boolean;
  visible: boolean;
}) {
  const [settings, setSettings] = useState(initialSettings);

  useEffect(() => {
    if (visible) setSettings(initialSettings);
  }, [initialSettings, visible]);

  const update = <Key extends keyof RoomSettingsPatch>(key: Key, value: RoomSettingsPatch[Key]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  return (
    <RoomSheet onClose={onClose} title="إعدادات الغرفة" visible={visible}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.statusCard}>
          <View style={[styles.statusDot, mediaStatus === 'rejected' && styles.statusDotDanger]} />
          <View style={styles.statusCopy}>
            <Text style={styles.statusTitle}>صورة الغرفة</Text>
            <Text style={styles.statusText}>{roomImageStatusLabel(mediaStatus)}</Text>
          </View>
          <CompactButton
            disabled={!mediaEnabled || mediaPending}
            label={mediaPending ? 'جارٍ الرفع…' : mediaStatus === 'none' ? 'اختيار صورة' : 'استبدال الصورة'}
            onPress={() => void onSelectRoomImage().catch(() => undefined)}
          />
        </View>
        {!mediaEnabled ? (
          <Text style={styles.helperText}>رفع الصور غير مفعّل لهذه المجموعة بعد.</Text>
        ) : null}
        {mediaErrorMessage ? <Text style={styles.errorText}>{mediaErrorMessage}</Text> : null}
        <FieldLabel label="إعلان الغرفة" value={`${settings.announcement.length}/160`} />
        <TextInput
          accessibilityLabel="إعلان الغرفة"
          maxLength={160}
          multiline
          onChangeText={(value) => update('announcement', value)}
          placeholder="رسالة مثبتة قصيرة تظهر في الغرفة"
          placeholderTextColor={colors.textSubtle}
          style={styles.textArea}
          textAlign="right"
          value={settings.announcement}
        />
        <FieldLabel label="رسالة الترحيب" value={`${settings.welcomeMessage.length}/200`} />
        <TextInput
          accessibilityLabel="رسالة الترحيب"
          maxLength={200}
          multiline
          onChangeText={(value) => update('welcomeMessage', value)}
          placeholder="تظهر للعضو عند دخوله"
          placeholderTextColor={colors.textSubtle}
          style={styles.textArea}
          textAlign="right"
          value={settings.welcomeMessage}
        />
        <ChoiceGroup
          label="مظهر الغرفة"
          onChange={(value) => update('themeId', value as RoomThemeId)}
          options={[
            ['midnight', 'ليلي'],
            ['royal', 'ملكي'],
            ['ocean', 'بحري'],
            ['emerald', 'زمردي'],
          ]}
          value={settings.themeId}
        />
        <ChoiceGroup
          label="من يمكنه الدردشة"
          onChange={(value) => update('chatMode', value as RoomChatMode)}
          options={[
            ['everyone', 'الجميع'],
            ['followers', 'المتابعون'],
            ['off', 'متوقفة'],
          ]}
          value={settings.chatMode}
        />
        <ChoiceGroup
          label="الوضع البطيء"
          onChange={(value) => update('slowModeSeconds', Number(value) as 0 | 5 | 10 | 30 | 60)}
          options={[
            ['0', 'متوقف'],
            ['5', '5 ث'],
            ['10', '10 ث'],
            ['30', '30 ث'],
            ['60', '60 ث'],
          ]}
          value={String(settings.slowModeSeconds)}
        />
        <ChoiceGroup
          label="سجل الرسائل"
          onChange={(value) => update('historyVisibility', value as RoomHistoryVisibility)}
          options={[
            ['everyone', 'للجميع'],
            ['after-join', 'منذ الدخول'],
            ['hidden', 'مخفي'],
          ]}
          value={settings.historyVisibility}
        />
        <ChoiceGroup
          label="فلتر الكلمات"
          onChange={(value) => update('keywordFilterMode', value as RoomKeywordFilterMode)}
          options={[
            ['off', 'متوقف'],
            ['standard', 'قياسي'],
            ['strict', 'مشدّد'],
          ]}
          value={settings.keywordFilterMode}
        />
        <ChoiceGroup
          label="مؤثرات الدخول والهدايا"
          onChange={(value) => update('effectsPolicy', value as RoomEffectsPolicy)}
          options={[
            ['full', 'كاملة'],
            ['reduced', 'مخففة'],
            ['off', 'متوقفة'],
          ]}
          value={settings.effectsPolicy}
        />
        {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
        <PrimaryButton
          disabled={saving}
          label={saving ? 'جارٍ الحفظ…' : 'حفظ الإعدادات'}
          onPress={() => void onSave(settings).catch(() => undefined)}
        />
      </ScrollView>
    </RoomSheet>
  );
}

export function RoomMicrophonesSheet({
  audioLockdown,
  isOwner,
  onClose,
  onLockAudio,
  onLockSeat,
  onApproveRequest,
  onRejectRequest,
  nameForUid,
  onResizeSeats,
  onSetSeatMode,
  onUnlockAudio,
  onUnlockSeat,
  pending,
  pendingInvites,
  pendingRequests,
  seatMode,
  seats,
  seatTargetCount,
  visible,
}: {
  audioLockdown: boolean;
  isOwner: boolean;
  onClose: () => void;
  onLockAudio: () => Promise<void>;
  onLockSeat: (seatId: string) => Promise<void>;
  onApproveRequest: (request: RoomSeatRequestRecord) => Promise<void>;
  onRejectRequest: (request: RoomSeatRequestRecord) => Promise<void>;
  nameForUid: (uid: string) => string;
  onResizeSeats: (count: 5 | 10 | 15 | 20) => Promise<void>;
  onSetSeatMode: (mode: RoomSeatMode) => Promise<void>;
  onUnlockAudio: () => Promise<void>;
  onUnlockSeat: (seatId: string) => Promise<void>;
  pending: PendingCheck;
  pendingInvites: RoomSeatInviteRecord[];
  pendingRequests: RoomSeatRequestRecord[];
  seatMode: RoomSeatMode;
  seats: RoomSeatDocument[];
  seatTargetCount: 5 | 10 | 15 | 20;
  visible: boolean;
}) {
  return (
    <RoomSheet onClose={onClose} title="إدارة الميكروفونات" visible={visible}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.statusCard}>
          <View style={[styles.statusDot, audioLockdown && styles.statusDotDanger]} />
          <View style={styles.statusCopy}>
            <Text style={styles.statusTitle}>{audioLockdown ? 'كل الميكروفونات مقفلة' : 'الصوت يعمل بصورة طبيعية'}</Text>
            <Text style={styles.statusText}>القفل العام يسحب صلاحية النشر فوراً من خدمة الصوت.</Text>
          </View>
          <CompactButton
            danger={!audioLockdown}
            disabled={pending(audioLockdown ? 'unlock-audio' : 'lock-audio')}
            label={audioLockdown ? 'فتح' : 'قفل الكل'}
            onPress={() => void (audioLockdown ? onUnlockAudio() : onLockAudio()).catch(() => undefined)}
          />
        </View>
        {isOwner ? (
          <>
            <ChoiceGroup
              label="عدد المقاعد"
              onChange={(value) => void onResizeSeats(Number(value) as 5 | 10 | 15 | 20).catch(() => undefined)}
              options={[['5', '5'], ['10', '10'], ['15', '15'], ['20', '20']]}
              value={String(seatTargetCount)}
            />
            <ChoiceGroup
              label="طريقة أخذ المقعد"
              onChange={(value) => void onSetSeatMode(value as RoomSeatMode).catch(() => undefined)}
              options={[
                ['open', 'مفتوح'],
                ['request', 'بطلب'],
                ['invite', 'بدعوة'],
                ['locked', 'مقفل'],
              ]}
              value={seatMode}
            />
          </>
        ) : null}
        <Text style={styles.groupLabel}>قفل المقاعد الفردية</Text>
        <View style={styles.seatGrid}>
          {seats
            .filter((seat) => seat.seatNumber <= seatTargetCount)
            .map((seat) => {
              const locked = seat.state === 'locked' || seat.manuallyLocked === true;
              const occupied = seat.state === 'occupied' || seat.state === 'reconnecting';
              return (
                <Pressable
                  accessibilityLabel={`المقعد ${seat.seatNumber}، ${occupied ? 'مشغول' : locked ? 'مقفل' : 'مفتوح'}`}
                  accessibilityRole="button"
                  disabled={occupied || pending(
                    locked ? 'unlock-seat' : 'lock-seat',
                    undefined,
                    seatId(seat.seatNumber),
                  )}
                  key={seat.seatNumber}
                  onPress={() => void (
                    locked ? onUnlockSeat(seatId(seat.seatNumber)) : onLockSeat(seatId(seat.seatNumber))
                  ).catch(() => undefined)}
                  style={({ pressed }) => [
                    styles.seatButton,
                    locked && styles.seatButtonLocked,
                    occupied && styles.disabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <SymbolView
                    name={locked
                      ? { ios: 'lock.fill', android: 'lock', web: 'lock' }
                      : { ios: 'mic.fill', android: 'mic', web: 'mic' }}
                    size={16}
                    tintColor={locked ? '#FFB4C2' : colors.goldSoft}
                  />
                  <Text style={styles.seatNumber}>{seat.seatNumber}</Text>
                </Pressable>
              );
            })}
        </View>
        <Text style={styles.groupLabel}>طلبات الميكروفون المعلقة</Text>
        {pendingRequests.map((request) => (
          <View key={request.requesterUid} style={styles.transferRow}>
            <View style={styles.personCopy}>
              <Text style={styles.personName}>{nameForUid(request.requesterUid)}</Text>
              <Text style={styles.personMeta}>طلب المقعد {Number(request.requestedSeatId)}</Text>
            </View>
            <CompactButton
              disabled={pending('approve-seat-request', request.requesterUid, request.requestedSeatId)}
              label="قبول"
              onPress={() => void onApproveRequest(request).catch(() => undefined)}
            />
            <CompactButton
              danger
              disabled={pending('reject-seat-request', request.requesterUid)}
              label="رفض"
              onPress={() => void onRejectRequest(request).catch(() => undefined)}
            />
          </View>
        ))}
        {!pendingRequests.length ? <Text style={styles.helperText}>لا توجد طلبات معلقة.</Text> : null}
        <Text style={styles.groupLabel}>دعوات الميكروفون المعلقة</Text>
        {pendingInvites.map((invite) => (
          <View key={invite.targetUid} style={styles.transferRow}>
            <View style={styles.personCopy}>
              <Text style={styles.personName}>{nameForUid(invite.targetUid)}</Text>
              <Text style={styles.personMeta}>دعوة إلى المقعد {Number(invite.seatId)}</Text>
            </View>
            <Text style={styles.pendingLabel}>بانتظار الرد</Text>
          </View>
        ))}
        {!pendingInvites.length ? <Text style={styles.helperText}>لا توجد دعوات معلقة.</Text> : null}
      </ScrollView>
    </RoomSheet>
  );
}

export function RoomPeopleManagementSheet({
  actorRole,
  members,
  onAssignModerator,
  onBan,
  onClose,
  onGrantDj,
  onInviteToSeat,
  onRemove,
  onRemoveModerator,
  onRevokeDj,
  pending,
  visible,
}: {
  actorRole: 'owner' | 'moderator';
  members: VoiceRoomMember[];
  onAssignModerator: (uid: string) => void;
  onBan: (uid: string) => void;
  onClose: () => void;
  onGrantDj: (uid: string) => void;
  onInviteToSeat?: (uid: string) => void;
  onRemove: (uid: string) => void;
  onRemoveModerator: (uid: string) => void;
  onRevokeDj: (uid: string) => void;
  pending: PendingCheck;
  visible: boolean;
}) {
  const manageable = useMemo(
    () => members.filter((member) => member.authorityRole !== 'owner'),
    [members],
  );

  return (
    <RoomSheet onClose={onClose} title="إدارة الأشخاص" visible={visible}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {manageable.map((member) => {
          const isModerator = member.authorityRole === 'moderator';
          const isDj = member.privileges?.canManageMusic === true;
          const protectedFromModerator = actorRole === 'moderator' && isModerator;
          return (
            <View key={member.id} style={styles.personCard}>
              <View style={styles.personHeader}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{member.avatarLabel}</Text></View>
                <View style={styles.personCopy}>
                  <View style={styles.nameWithBadge}>
                    <Text numberOfLines={1} style={styles.personName}>{member.displayName}</Text>
                    <RepresentativeBadge active={member.representativeBadgeActive} />
                  </View>
                  <Text style={styles.personMeta}>
                    {isModerator ? 'مشرف الغرفة' : member.seatId ? `على المقعد ${Number(member.seatId)}` : 'مستمع'}
                    {isDj ? ' · DJ' : ''}
                  </Text>
                </View>
              </View>
              {!protectedFromModerator ? (
                <View style={styles.actionRow}>
                  {actorRole === 'owner' ? (
                    <CompactButton
                      disabled={pending(isModerator ? 'remove-moderator' : 'assign-moderator', member.id)}
                      label={isModerator ? 'إلغاء الإشراف' : 'تعيين مشرف'}
                      onPress={() => (isModerator ? onRemoveModerator(member.id) : onAssignModerator(member.id))}
                    />
                  ) : null}
                  <CompactButton
                    disabled={pending(isDj ? 'revoke-dj' : 'grant-dj', member.id)}
                    label={isDj ? 'إلغاء DJ' : 'منح DJ'}
                    onPress={() => (isDj ? onRevokeDj(member.id) : onGrantDj(member.id))}
                  />
                  {onInviteToSeat && !member.seatId ? (
                    <CompactButton label="دعوة للميكروفون" onPress={() => onInviteToSeat(member.id)} />
                  ) : null}
                  <CompactButton danger label="طرد" onPress={() => onRemove(member.id)} />
                  <CompactButton danger label="حظر" onPress={() => onBan(member.id)} />
                </View>
              ) : (
                <Text style={styles.helperText}>لا يستطيع مشرف اتخاذ إجراء ضد مشرف آخر.</Text>
              )}
            </View>
          );
        })}
        {!manageable.length ? <Text style={styles.emptyText}>لا يوجد أعضاء يمكن إدارتهم الآن.</Text> : null}
      </ScrollView>
    </RoomSheet>
  );
}

export function RoomSafetySheet({
  audioLockdown,
  bans,
  moderationEvents,
  nameForUid,
  onClose,
  onLockAudio,
  onParticipants,
  onReports,
  onUnlockAudio,
  onUnban,
  pending,
  visible,
}: {
  audioLockdown: boolean;
  bans: RoomBanRecord[];
  moderationEvents: RoomModerationEventRecord[];
  nameForUid: (uid: string) => string;
  onClose: () => void;
  onLockAudio: () => Promise<void>;
  onParticipants: () => void;
  onReports: () => void;
  onUnlockAudio: () => Promise<void>;
  onUnban: (uid: string) => void;
  pending: PendingCheck;
  visible: boolean;
}) {
  return (
    <RoomSheet onClose={onClose} title="سلامة الغرفة" visible={visible}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.statusCard}>
          <View style={[styles.statusDot, audioLockdown && styles.statusDotDanger]} />
          <View style={styles.statusCopy}>
            <Text style={styles.statusTitle}>{audioLockdown ? 'الغرفة في قفل صوتي' : 'لا يوجد قفل صوتي'}</Text>
            <Text style={styles.statusText}>تُحفظ أوامر السلامة وهوية المنفذ في سجل الإشراف.</Text>
          </View>
        </View>
        <PrimaryButton
          danger={!audioLockdown}
          disabled={pending(audioLockdown ? 'unlock-audio' : 'lock-audio')}
          label={audioLockdown ? 'إنهاء القفل الصوتي' : 'قفل كل الميكروفونات'}
          onPress={() => void (audioLockdown ? onUnlockAudio() : onLockAudio()).catch(() => undefined)}
        />
        <View style={styles.actionRow}>
          <CompactButton label="اختيار عضو للإبلاغ" onPress={onReports} />
          <CompactButton label="قائمة المشاركين" onPress={onParticipants} />
        </View>
        <Text style={styles.groupLabel}>المحظورون من الغرفة</Text>
        {bans.map((ban) => (
          <View key={ban.targetUid} style={styles.transferRow}>
            <View style={styles.personCopy}>
              <Text style={styles.personName}>{nameForUid(ban.targetUid)}</Text>
              <Text numberOfLines={2} style={styles.personMeta}>{ban.reason || 'بدون سبب مسجل'}</Text>
            </View>
            <CompactButton
              disabled={pending('unban-member', ban.targetUid)}
              label="إلغاء الحظر"
              onPress={() => onUnban(ban.targetUid)}
            />
          </View>
        ))}
        {!bans.length ? <Text style={styles.helperText}>لا توجد حالات حظر فعالة.</Text> : null}
        <Text style={styles.groupLabel}>سجل الإشراف</Text>
        {moderationEvents.map((event) => (
          <View key={event.id} style={styles.logRow}>
            <View style={styles.logDot} />
            <View style={styles.personCopy}>
              <Text style={styles.personName}>{moderationActionLabel(event.action)}</Text>
              <Text numberOfLines={2} style={styles.personMeta}>
                {nameForUid(event.actorUid)}
                {event.targetUid ? ` ← ${nameForUid(event.targetUid)}` : ''}
                {event.reason ? ` · ${event.reason}` : ''}
              </Text>
            </View>
            <Text style={styles.logTime}>{formatEventTime(event.createdAtMs)}</Text>
          </View>
        ))}
        {!moderationEvents.length ? <Text style={styles.helperText}>لا توجد أحداث إشراف متاحة.</Text> : null}
      </ScrollView>
    </RoomSheet>
  );
}

export function RoomSeatOffersSheet({
  invite,
  onAcceptInvite,
  onCancelRequest,
  onClose,
  onDeclineInvite,
  pending,
  request,
  visible,
}: {
  invite?: RoomSeatInviteRecord;
  onAcceptInvite: (seatId: string) => Promise<void>;
  onCancelRequest: () => Promise<void>;
  onClose: () => void;
  onDeclineInvite: () => Promise<void>;
  pending: PendingCheck;
  request?: RoomSeatRequestRecord;
  visible: boolean;
}) {
  return (
    <RoomSheet onClose={onClose} title="طلبات الميكروفون" visible={visible}>
      <View style={styles.scrollContent}>
        {invite ? (
          <View style={styles.offerCard}>
            <SymbolView
              name={{ ios: 'mic.badge.plus', android: 'mic', web: 'mic' }}
              size={28}
              tintColor={colors.goldSoft}
            />
            <Text style={styles.offerTitle}>لديك دعوة إلى المقعد {Number(invite.seatId)}</Text>
            <Text style={styles.helperText}>ستنتهي الدعوة تلقائياً إذا لم تعد صالحة أو أصبح المقعد مشغولاً.</Text>
            <View style={styles.actionRow}>
              <CompactButton
                disabled={pending('accept-seat-invite')}
                label="قبول الدعوة"
                onPress={() => void onAcceptInvite(invite.seatId).catch(() => undefined)}
              />
              <CompactButton
                danger
                disabled={pending('decline-seat-invite')}
                label="رفض"
                onPress={() => void onDeclineInvite().catch(() => undefined)}
              />
            </View>
          </View>
        ) : null}
        {request ? (
          <View style={styles.offerCard}>
            <Text style={styles.offerTitle}>طلبك للمقعد {Number(request.requestedSeatId)} قيد المراجعة</Text>
            <Text style={styles.helperText}>يمكنك إلغاء الطلب قبل أن يوافق عليه مالك الغرفة أو أحد المشرفين.</Text>
            <CompactButton
              danger
              disabled={pending('cancel-seat-request')}
              label="إلغاء الطلب"
              onPress={() => void onCancelRequest().catch(() => undefined)}
            />
          </View>
        ) : null}
        {!invite && !request ? <Text style={styles.emptyText}>لا توجد طلبات أو دعوات معلقة.</Text> : null}
      </View>
    </RoomSheet>
  );
}

export function RoomOwnershipSheet({
  candidates,
  errorMessage,
  onClose,
  onRemoveRoom,
  onTransfer,
  pending,
  visible,
}: {
  candidates: VoiceRoomMember[];
  errorMessage?: string;
  onClose: () => void;
  onRemoveRoom: (reason: string) => void;
  onTransfer: (member: VoiceRoomMember) => void;
  pending: PendingCheck;
  visible: boolean;
}) {
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (visible) setReason('');
  }, [visible]);

  return (
    <RoomSheet onClose={onClose} title="الملكية وحذف الغرفة" visible={visible}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.groupLabel}>نقل الملكية</Text>
        <Text style={styles.helperText}>النقل فوري ويحوّل المالك الحالي إلى عضو عادي. اختر عضواً نشطاً فقط.</Text>
        {candidates.map((member) => (
          <View key={member.id} style={styles.transferRow}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{member.avatarLabel}</Text></View>
            <View style={styles.transferIdentity}>
              <Text numberOfLines={1} style={styles.transferName}>{member.displayName}</Text>
              <RepresentativeBadge active={member.representativeBadgeActive} />
            </View>
            <CompactButton
              disabled={pending('transfer-ownership', member.id)}
              label="نقل"
              onPress={() => onTransfer(member)}
            />
          </View>
        ))}
        {!candidates.length ? <Text style={styles.emptyText}>لا يوجد عضو نشط مؤهل لنقل الملكية إليه.</Text> : null}
        <View style={styles.dangerZone}>
          <Text style={styles.dangerTitle}>حذف الغرفة</Text>
          <Text style={styles.helperText}>الحذف قابل للاستعادة بواسطة فريق المنصة ولا يمسح سجل السلامة فوراً.</Text>
          <TextInput
            accessibilityLabel="سبب حذف الغرفة"
            maxLength={240}
            onChangeText={setReason}
            placeholder="اكتب سبب الحذف"
            placeholderTextColor={colors.textSubtle}
            style={styles.input}
            textAlign="right"
            value={reason}
          />
          {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
          <PrimaryButton
            danger
            disabled={!reason.trim() || pending('remove-room')}
            label="حذف الغرفة"
            onPress={() => onRemoveRoom(reason.trim())}
          />
        </View>
      </ScrollView>
    </RoomSheet>
  );
}

function ChoiceGroup({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: [string, string][];
  value: string;
}) {
  return (
    <View style={styles.choiceGroup}>
      <Text style={styles.groupLabel}>{label}</Text>
      <View style={styles.choiceRow}>
        {options.map(([optionValue, optionLabel]) => {
          const selected = value === optionValue;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              key={optionValue}
              onPress={() => onChange(optionValue)}
              style={({ pressed }) => [
                styles.choice,
                selected && styles.choiceSelected,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{optionLabel}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function FieldLabel({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fieldLabelRow}>
      <Text style={styles.counter}>{value}</Text>
      <Text style={styles.groupLabel}>{label}</Text>
    </View>
  );
}

function PrimaryButton({
  danger = false,
  disabled = false,
  label,
  onPress,
}: {
  danger?: boolean;
  disabled?: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        danger && styles.primaryButtonDanger,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {disabled && label.includes('جار') ? <ActivityIndicator color={colors.text} size="small" /> : null}
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function CompactButton({
  danger = false,
  disabled = false,
  label,
  onPress,
}: {
  danger?: boolean;
  disabled?: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.compactButton,
        danger && styles.compactButtonDanger,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.compactButtonText, danger && styles.compactButtonDangerText]}>{label}</Text>
    </Pressable>
  );
}

function seatId(seatNumber: number) {
  return String(seatNumber).padStart(2, '0');
}

function moderationActionLabel(action: string) {
  const labels: Record<string, string> = {
    'approve-seat-request': 'قبول طلب ميكروفون',
    'assign-moderator': 'تعيين مشرف',
    'ban-member': 'حظر عضو',
    'grant-dj': 'منح صلاحية DJ',
    'lock-audio': 'قفل كل الميكروفونات',
    'lock-seat': 'قفل مقعد',
    'reject-seat-request': 'رفض طلب ميكروفون',
    'remove-member': 'طرد عضو',
    'remove-moderator': 'إلغاء إشراف',
    'remove-room': 'حذف الغرفة',
    'revoke-dj': 'إلغاء صلاحية DJ',
    'transfer-ownership': 'نقل الملكية',
    'unban-member': 'إلغاء حظر عضو',
    'unlock-audio': 'إنهاء القفل الصوتي',
    'unlock-seat': 'فتح مقعد',
    'update-room-settings': 'تحديث إعدادات الغرفة',
  };
  return labels[action] || action;
}

function formatEventTime(value: number | undefined) {
  if (!value) return '';
  return new Intl.DateTimeFormat('ar-IQ', { hour: '2-digit', minute: '2-digit' }).format(value);
}

function roomImageStatusLabel(status: 'none' | 'pending' | 'approved' | 'rejected' | 'removed') {
  return {
    approved: 'الصورة الحالية معتمدة',
    none: 'لا توجد صورة مخصصة',
    pending: 'الصورة الجديدة بانتظار مراجعة فريق السلامة',
    rejected: 'رُفضت آخر صورة؛ يمكنك اختيار صورة أخرى',
    removed: 'أزال فريق السلامة الصورة',
  }[status];
}

const styles = StyleSheet.create({
  scrollContent: {
    gap: spacing.md,
    paddingBottom: spacing.xxl,
    paddingTop: spacing.md,
  },
  fieldLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  groupLabel: {
    color: colors.goldSoft,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  counter: {
    color: colors.textSubtle,
    fontSize: 9,
  },
  textArea: {
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: typography.sizes.body,
    minHeight: 74,
    padding: spacing.md,
    textAlignVertical: 'top',
    writingDirection: 'rtl',
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    writingDirection: 'rtl',
  },
  choiceGroup: {
    gap: spacing.sm,
  },
  choiceRow: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  choice: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  choiceSelected: {
    backgroundColor: 'rgba(232,190,97,0.18)',
    borderColor: colors.gold,
  },
  choiceText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: typography.weights.bold,
  },
  choiceTextSelected: {
    color: colors.goldSoft,
  },
  helperText: {
    color: colors.textSubtle,
    fontSize: 10,
    lineHeight: 16,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  errorText: {
    color: '#FFB4C2',
    fontSize: 11,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.goldDeep,
    borderColor: colors.gold,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 48,
  },
  primaryButtonDanger: {
    backgroundColor: '#6E1426',
    borderColor: '#E45B78',
  },
  primaryButtonText: {
    color: colors.text,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.black,
  },
  statusCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    padding: spacing.md,
  },
  statusDot: {
    backgroundColor: colors.emerald,
    borderRadius: radius.full,
    height: 9,
    width: 9,
  },
  statusDotDanger: {
    backgroundColor: colors.ruby,
  },
  statusCopy: {
    flex: 1,
  },
  statusTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: typography.weights.black,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  statusText: {
    color: colors.textSubtle,
    fontSize: 9,
    marginTop: 2,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  compactButton: {
    backgroundColor: 'rgba(232,190,97,0.10)',
    borderColor: colors.borderGold,
    borderRadius: radius.full,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 34,
    paddingHorizontal: spacing.md,
  },
  compactButtonDanger: {
    backgroundColor: 'rgba(184,41,75,0.12)',
    borderColor: 'rgba(255,122,148,0.42)',
  },
  compactButtonText: {
    color: colors.goldSoft,
    fontSize: 10,
    fontWeight: typography.weights.bold,
  },
  compactButtonDangerText: {
    color: '#FFB4C2',
  },
  seatGrid: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  seatButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(232,190,97,0.08)',
    borderColor: colors.borderGold,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    height: 42,
    justifyContent: 'center',
    width: 56,
  },
  seatButtonLocked: {
    backgroundColor: 'rgba(184,41,75,0.14)',
    borderColor: 'rgba(255,122,148,0.42)',
  },
  seatNumber: {
    color: colors.text,
    fontSize: 10,
    fontWeight: typography.weights.black,
  },
  personCard: {
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  personHeader: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: spacing.sm,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: '#26101A',
    borderColor: colors.borderGold,
    borderRadius: radius.full,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  avatarText: {
    color: colors.goldSoft,
    fontWeight: typography.weights.black,
  },
  personCopy: {
    flex: 1,
  },
  nameWithBadge: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: spacing.sm,
  },
  personName: {
    color: colors.text,
    fontSize: 12,
    fontWeight: typography.weights.black,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  personMeta: {
    color: colors.textSubtle,
    fontSize: 9,
    marginTop: 2,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  actionRow: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  transferRow: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: radius.md,
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    minHeight: 54,
    paddingHorizontal: spacing.sm,
  },
  transferName: {
    color: colors.text,
    flex: 1,
    fontSize: 12,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  transferIdentity: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row-reverse',
    gap: spacing.sm,
  },
  pendingLabel: {
    color: colors.textSubtle,
    fontSize: 9,
    writingDirection: 'rtl',
  },
  logRow: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderRadius: radius.md,
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    minHeight: 54,
    padding: spacing.sm,
  },
  logDot: {
    backgroundColor: colors.gold,
    borderRadius: radius.full,
    height: 7,
    width: 7,
  },
  logTime: {
    color: colors.textSubtle,
    fontSize: 8,
  },
  offerCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(232,190,97,0.08)',
    borderColor: colors.borderGold,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  offerTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: typography.weights.black,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  dangerZone: {
    borderColor: 'rgba(255,122,148,0.38)',
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  dangerTitle: {
    color: '#FFB4C2',
    fontSize: 13,
    fontWeight: typography.weights.black,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  emptyText: {
    color: colors.textMuted,
    paddingVertical: spacing.xl,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  disabled: {
    opacity: 0.42,
  },
  pressed: {
    opacity: 0.72,
  },
});
