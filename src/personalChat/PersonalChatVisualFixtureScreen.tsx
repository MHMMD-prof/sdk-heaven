import { useMemo, useState } from 'react';
import { I18nManager, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomNavigationBar } from '../components/BottomNavigationBar';
import { disabledCosmeticsFeatureFlags } from '../cosmetics/featureFlags';
import type { MainTabKey } from '../types/navigation';
import type { DirectChatUiMessage } from './directChatModels';
import {
  buildMessageGroups,
  ChatConversationRow,
  ChatFilterBar,
  ChatRequestDecisionCard,
  ChatRequestSummary,
  ChatRoyalBackdrop,
  ChatSearchField,
  ChatThreadCanvas,
  ChatTimelineRow,
  ChatTopBar,
  chatColors,
  chatMetrics,
  DirectChatComposerModernRoyal,
} from './ui';

type FixtureState = 'inbox' | 'request' | 'thread';
const ar = process.env.EXPO_PUBLIC_PERSONAL_CHAT_FIXTURE_RTL === '1' || I18nManager.isRTL;
const tr = (arabic: string, english: string) => ar ? arabic : english;
const noOp = () => undefined;
const asyncTrue = async () => true;

export function PersonalChatVisualFixtureScreen() {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<FixtureState>('inbox');
  const [activeTab, setActiveTab] = useState<MainTabKey>('chats');
  const [draft, setDraft] = useState('');
  const [filter, setFilter] = useState<'all' | 'requests' | 'unread'>('all');
  const [query, setQuery] = useState('');
  const messages = useMemo(() => fixtureMessages(), []);
  const timeline = useMemo(() => buildMessageGroups({ messages, unreadAfterSequence: 1, viewerUid: 'self' }), [messages]);

  return (
    <View style={styles.root} testID="personal-chat-visual-fixture">
      <ChatRoyalBackdrop />
      <View style={{ paddingTop: insets.top }}>
        <FixtureSwitcher onChange={setState} value={state} />
      </View>
      {state === 'inbox' ? (
        <View style={styles.screen}>
          <ChatTopBar actionLabel={tr('محادثة جديدة', 'New chat')} count={5} onAction={noOp} subtitle={tr('تواصل خاص وآمن', 'Private, safer conversations')} title={tr('المحادثات', 'Chats')} />
          <View style={styles.inboxControls}>
            <ChatSearchField accessibilityLabel={tr('البحث في المحادثات', 'Search chats')} clearAccessibilityLabel={tr('مسح البحث', 'Clear search')} onChangeText={setQuery} placeholder={tr('ابحث بالاسم', 'Search by name')} value={query} />
            <ChatFilterBar labels={{ all: tr('الكل', 'All'), requests: tr('الطلبات', 'Requests'), unread: tr('غير المقروءة', 'Unread') }} onChange={setFilter} value={filter} />
          </View>
          <ScrollView contentContainerStyle={styles.list}>
            {filter === 'all' ? <ChatRequestSummary count={2} label={tr('طلبات المحادثة', 'Chat requests')} onPress={() => setState('request')} reviewLabel={tr('راجع الرسائل قبل القبول', 'Review messages before accepting')} /> : null}
            {fixtureRows().filter((row) => filter !== 'unread' || row.unreadCount > 0).filter((row) => !query || row.displayName.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map((presentation) => <ChatConversationRow flags={disabledCosmeticsFeatureFlags} key={presentation.displayName} onPress={() => setState('thread')} presentation={presentation} />)}
          </ScrollView>
        </View>
      ) : (
        <View style={styles.screen}>
          <ChatTopBar actionIcon="more" actionLabel={tr('خيارات المحادثة', 'Chat options')} onAction={noOp} subtitle={state === 'request' ? tr('طلب محادثة وارد', 'Incoming chat request') : tr('متصلة الآن', 'Online')} title={tr('سارة', 'Sara')} />
          {state === 'request' ? (
            <ChatRequestDecisionCard
              acceptLabel={tr('قبول', 'Accept')}
              blockLabel={tr('حظر', 'Block')}
              body={tr('لن تتمكن سارة من إرسال المزيد حتى تقبل الطلب.', 'Sara cannot send more until you accept.')}
              busy={false}
              onAccept={() => setState('thread')}
              onBlock={noOp}
              onReject={noOp}
              onReport={noOp}
              rejectLabel={tr('رفض', 'Reject')}
              reportLabel={tr('إبلاغ', 'Report')}
              title={tr('سارة تريد بدء محادثة', 'Sara wants to start a chat')}
            />
          ) : null}
          <ChatThreadCanvas>
            <ScrollView contentContainerStyle={styles.timeline}>
              {timeline.map((item) => <ChatTimelineRow cosmetics={disabledCosmeticsFeatureFlags} item={item} key={item.id} messages={messages} onMessageAction={noOp} peerName={tr('سارة', 'Sara')} peerReadSequence={4} uid="self" />)}
            </ScrollView>
          </ChatThreadCanvas>
          <DirectChatComposerModernRoyal
            accepted={state === 'thread'}
            bottomInset={Math.max(insets.bottom, 8)}
            draft={draft}
            mediaDisabled={false}
            onCancelReply={noOp}
            onChangeDraft={setDraft}
            onCompleteAttachment={asyncTrue}
            onEmoji={asyncTrue}
            onSend={asyncTrue}
            onSticker={asyncTrue}
            requestIncoming={state === 'request'}
            requestOutgoing={false}
            statusReady
            targetUid="fixture-sara"
          />
        </View>
      )}
      <BottomNavigationBar activeTab={activeTab} onTabPress={setActiveTab} unreadCount={5} />
    </View>
  );
}

function FixtureSwitcher({ onChange, value }: { onChange: (value: FixtureState) => void; value: FixtureState }) {
  return <View accessibilityLabel="Visual fixture states" style={styles.switcher}>{(['inbox', 'thread', 'request'] as const).map((item) => <Pressable accessibilityRole="button" key={item} onPress={() => onChange(item)} style={[styles.switcherItem, value === item && styles.switcherSelected]}><Text style={styles.switcherText}>{item}</Text></Pressable>)}</View>;
}

function fixtureRows() {
  return [
    { accessibilityLabel: tr('سارة، رسالتان غير مقروءتين', 'Sara, 2 unread messages'), archiveLabel: tr('أرشفة', 'Archive'), displayName: tr('سارة', 'Sara'), muteLabel: tr('كتم', 'Mute'), muted: false, online: true, preview: tr('وصلت الصورة، شكراً', 'Thanks, I got the photo'), timestampLabel: tr('١٢:٤٥', '12:45 PM'), unreadCount: 2 },
    { accessibilityLabel: tr('نور، ثلاث رسائل غير مقروءة', 'Noor, 3 unread messages'), archiveLabel: tr('أرشفة', 'Archive'), displayName: tr('نور', 'Noor'), muteLabel: tr('كتم', 'Mute'), muted: false, online: true, preview: tr('تكتب الآن…', 'Typing…'), timestampLabel: tr('١٢:٣٨', '12:38 PM'), unreadCount: 3 },
    { accessibilityLabel: tr('عمر، محادثة مكتومة', 'Omar, muted conversation'), archiveLabel: tr('أرشفة', 'Archive'), displayName: tr('عمر', 'Omar'), muteLabel: tr('إلغاء الكتم', 'Unmute'), muted: true, online: false, preview: tr('مسودة: سأعود بعد قليل', 'Draft: I will be back soon'), timestampLabel: tr('أمس', 'Yesterday'), unreadCount: 0 },
    { accessibilityLabel: tr('مستخدم محذوف', 'Deleted user'), archiveLabel: tr('أرشفة', 'Archive'), displayName: tr('مستخدم محذوف', 'Deleted user'), muteLabel: tr('كتم', 'Mute'), muted: false, online: false, preview: tr('تم إلغاء إرسال هذه الرسالة', 'This message was unsent'), timestampLabel: tr('السبت', 'Saturday'), unreadCount: 0 },
  ];
}

function fixtureMessages(): DirectChatUiMessage[] {
  return [
    message({ id: 'm1', senderUid: 'peer', sequence: 1, text: tr('مرحباً، هل أنت في الغرفة؟', 'Hi, are you in the room?') }),
    message({ createdAtMs: Date.now() - 70_000, id: 'm2', senderUid: 'self', sequence: 2, text: tr('نعم، سأدخل الآن', 'Yes, I will join now') }),
    message({ createdAtMs: Date.now() - 45_000, id: 'm3', replyToMessageId: 'm1', senderUid: 'self', sequence: 3, text: tr('انتظريني دقيقة واحدة', 'Give me one minute') }),
    message({ createdAtMs: Date.now() - 20_000, deliveryState: 'failed', id: 'm4', senderUid: 'self', sequence: 4, text: tr('سأرسل رابط الغرفة الآن', 'I will send the room link now') }),
  ];
}

function message(overrides: Partial<DirectChatUiMessage>): DirectChatUiMessage {
  return { attachmentId: '', createdAtMs: Date.now() - 90_000, deliveryState: 'sent', id: 'message', kind: 'text', mediaContentType: '', mediaDurationMs: 0, mediaHeight: 0, mediaPath: '', mediaWidth: 0, replyToMessageId: '', senderUid: 'peer', sequence: 1, systemType: '', text: '', visibilityState: 'visible', ...overrides };
}

const styles = StyleSheet.create({
  inboxControls: { alignSelf: 'center', gap: 10, maxWidth: chatMetrics.contentMaxWidth, paddingHorizontal: 14, paddingVertical: 12, width: '100%' },
  list: { alignSelf: 'center', maxWidth: chatMetrics.contentMaxWidth, paddingBottom: 24, width: '100%' },
  root: { backgroundColor: chatColors.canvas, flex: 1 },
  screen: { flex: 1 },
  switcher: { alignSelf: 'center', backgroundColor: chatColors.canvasRaised, borderColor: chatColors.divider, borderRadius: 18, borderWidth: 1, flexDirection: 'row', gap: 4, margin: 6, padding: 3 },
  switcherItem: { borderRadius: 14, minWidth: 58, paddingHorizontal: 6, paddingVertical: 7 },
  switcherSelected: { backgroundColor: chatColors.royalRed },
  switcherText: { color: chatColors.textPrimary, fontSize: 11, fontWeight: '800', textAlign: 'center', textTransform: 'uppercase' },
  timeline: { padding: 14 },
});
