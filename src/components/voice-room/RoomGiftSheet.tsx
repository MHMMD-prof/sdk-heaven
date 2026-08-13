import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { activeVoiceProviderConfig } from '../../voice/activeVoiceProviderConfig';
import {
  RoomGiftCatalogItem,
  RoomGiftEffect,
  RoomGiftMagicFrameTemplate,
  RoomGiftQuote,
  RoomGiftRequestError,
  requestRoomGiftCommand,
} from '../../voice/requestRoomGiftCommand';

type RecipientOption = {
  displayName: string;
  uid: string;
};

type RoomGiftSheetProps = {
  enabled: boolean;
  onClose: () => void;
  onGiftCommitted?: (effect: RoomGiftEffect) => void;
  recipients: RecipientOption[];
  roomId: string;
  visible: boolean;
};

export function RoomGiftSheet({
  enabled,
  onClose,
  onGiftCommitted,
  recipients,
  roomId,
  visible,
}: RoomGiftSheetProps) {
  const [catalog, setCatalog] = useState<RoomGiftCatalogItem[]>([]);
  const [coins, setCoins] = useState(0);
  const [error, setError] = useState('');
  const [giftId, setGiftId] = useState('');
  const [loading, setLoading] = useState(false);
  const [luckyOddsNote, setLuckyOddsNote] = useState('');
  const [magicFrameTemplateId, setMagicFrameTemplateId] = useState('');
  const [magicTemplates, setMagicTemplates] = useState<RoomGiftMagicFrameTemplate[]>([]);
  const [pending, setPending] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [quote, setQuote] = useState<RoomGiftQuote | null>(null);
  const [quoteNowMs, setQuoteNowMs] = useState(() => Date.now());
  const [targetUid, setTargetUid] = useState('');
  const [theaterFlags, setTheaterFlags] = useState({
    giftCombos: false,
    luckyGifts: false,
    magicGiftTemplates: false,
  });

  const selectedGift = useMemo(
    () => catalog.find((item) => item.giftId === giftId),
    [catalog, giftId],
  );
  const selectedRecipient = useMemo(
    () => recipients.find((item) => item.uid === targetUid),
    [recipients, targetUid],
  );

  useEffect(() => {
    if (!visible) return;
    setError('');
    setQuote(null);
    setQuantity(1);
    setGiftId('');
    setMagicFrameTemplateId('');
    setLuckyOddsNote('');
    setTargetUid(recipients[0]?.uid || '');
    if (!enabled) {
      setError('هدايا الغرفة غير مفعّلة حالياً.');
      return;
    }
    let cancelled = false;
    setLoading(true);
    void requestRoomGiftCommand({
      action: 'get-room-gift-center',
      roomId,
    }, activeVoiceProviderConfig.liveKit)
      .then((result) => {
        if (cancelled) return;
        setCatalog((result.catalog || []).filter((item) => item.status === 'available'));
        setCoins(result.balances?.coins || 0);
        setTheaterFlags(result.theaterFlags || {
          giftCombos: false,
          luckyGifts: false,
          magicGiftTemplates: false,
        });
        setMagicTemplates(result.magicFrameTemplates || []);
        if (result.luckyOdds?.entries?.length) {
          setLuckyOddsNote(
            result.luckyOdds.entries
              .map((entry) => `${entry.labelAr} ${entry.oddsLabelAr}`)
              .join(' · '),
          );
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof RoomGiftRequestError ? err.message : 'تعذر تحميل كتالوج الهدايا.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, recipients, roomId, visible]);

  useEffect(() => {
    if (!quote) return;
    setQuoteNowMs(Date.now());
    const interval = setInterval(() => {
      const currentTime = Date.now();
      setQuoteNowMs(currentTime);
      if (currentTime >= quote.expiresAtMs) {
        setQuote((current) => current?.quoteId === quote.quoteId ? null : current);
        setError('انتهت صلاحية عرض السعر. اطلب عرضاً جديداً.');
      }
    }, 1_000);
    return () => clearInterval(interval);
  }, [quote]);

  const quoteGift = useCallback(async () => {
    if (!giftId || !targetUid) {
      setError('اختر هدية ومستلماً.');
      return;
    }
    setPending(true);
    setError('');
    try {
      const result = await requestRoomGiftCommand({
        action: 'quote-room-gift',
        giftId,
        quantity,
        roomId,
        targetUid,
      }, activeVoiceProviderConfig.liveKit);
      setQuote(result.quote || null);
      setQuoteNowMs(Date.now());
      if (result.balances) setCoins(result.balances.coins);
    } catch (err) {
      setQuote(null);
      setError(err instanceof RoomGiftRequestError ? err.message : 'تعذر إنشاء عرض السعر.');
    } finally {
      setPending(false);
    }
  }, [giftId, quantity, roomId, targetUid]);

  const sendGift = useCallback(async () => {
    if (!quote) {
      setError('اطلب عرض السعر أولاً.');
      return;
    }
    const needsMagic = theaterFlags.magicGiftTemplates
      && selectedGift?.theater?.tags.includes('magic') === true;
    if (needsMagic && !magicFrameTemplateId) {
      setError('اختر إطاراً سحرياً معتمداً قبل الإرسال.');
      return;
    }
    setPending(true);
    setError('');
    try {
      const result = await requestRoomGiftCommand({
        action: 'send-room-gift',
        giftId: quote.giftId,
        ...(needsMagic ? { magicFrameTemplateId } : {}),
        quantity: quote.quantity,
        quoteId: quote.quoteId,
        roomId,
        targetUid: quote.targetUid,
      }, activeVoiceProviderConfig.liveKit);
      if (result.balances) setCoins(result.balances.coins);
      if (result.effect) onGiftCommitted?.(result.effect);
      setQuote(null);
      onClose();
    } catch (err) {
      setError(err instanceof RoomGiftRequestError ? err.message : 'تعذر إرسال الهدية.');
    } finally {
      setPending(false);
    }
  }, [magicFrameTemplateId, onClose, onGiftCommitted, quote, roomId, selectedGift, theaterFlags.magicGiftTemplates]);

  const quoteSecondsRemaining = quote
    ? Math.max(0, Math.ceil((quote.expiresAtMs - quoteNowMs) / 1_000))
    : 0;

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <Pressable accessibilityRole="button" onPress={onClose} style={[StyleSheet.absoluteFill, styles.backdrop]} />
      <View style={styles.sheet}>
        <Text style={styles.title}>هدية الغرفة</Text>
        <Text style={styles.meta}>رصيد العملات: {coins}</Text>
        {loading ? <ActivityIndicator color="#f5d76e" /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.section}>المستلم</Text>
          {!loading && recipients.length === 0 ? (
            <Text style={styles.meta}>لا يوجد مستلم متاح في الغرفة حالياً.</Text>
          ) : null}
          {recipients.map((recipient) => (
            <Pressable
              key={recipient.uid}
              accessibilityRole="button"
              onPress={() => {
                setTargetUid(recipient.uid);
                setQuote(null);
              }}
              style={[styles.option, targetUid === recipient.uid && styles.optionActive]}
            >
              <Text style={styles.optionText}>{recipient.displayName}</Text>
            </Pressable>
          ))}
          <Text style={styles.section}>الهدية</Text>
          {!loading && catalog.length === 0 ? (
            <Text style={styles.meta}>لا توجد هدايا متاحة حالياً.</Text>
          ) : null}
          {catalog.map((item) => (
            <Pressable
              key={item.giftId}
              accessibilityRole="button"
              onPress={() => {
                setGiftId(item.giftId);
                setMagicFrameTemplateId('');
                setQuote(null);
              }}
              style={[styles.option, giftId === item.giftId && styles.optionActive]}
            >
              <Text style={styles.optionText}>
                {item.nameAr} — {item.price} عملة
                {item.theater?.tags?.length ? ` · ${item.theater.tags.join('/')}` : ''}
              </Text>
            </Pressable>
          ))}
          {theaterFlags.luckyGifts && selectedGift?.theater?.tags.includes('lucky') && luckyOddsNote ? (
            <Text style={styles.meta}>جدول الحظ (ترفيه): {luckyOddsNote}</Text>
          ) : null}
          {theaterFlags.magicGiftTemplates && selectedGift?.theater?.tags.includes('magic') ? (
            <>
              <Text style={styles.section}>إطار سحري معتمد</Text>
              {magicTemplates.map((template) => (
                <Pressable
                  key={template.templateId}
                  accessibilityRole="button"
                  onPress={() => {
                    setMagicFrameTemplateId(template.templateId);
                    setQuote(null);
                  }}
                  style={[styles.option, magicFrameTemplateId === template.templateId && styles.optionActive]}
                >
                  <Text style={styles.optionText}>{template.labelAr}</Text>
                </Pressable>
              ))}
            </>
          ) : null}
          <Text style={styles.section}>الكمية</Text>
          <View style={styles.quantityRow}>
            {[1, 5, 10].map((value) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                onPress={() => {
                  setQuantity(value);
                  setQuote(null);
                }}
                style={[styles.quantityChip, quantity === value && styles.optionActive]}
              >
                <Text style={styles.optionText}>{value}</Text>
              </Pressable>
            ))}
          </View>
          {selectedGift && selectedRecipient ? (
            <Text style={styles.meta}>
              {selectedGift.nameAr} × {quantity} إلى {selectedRecipient.displayName}
            </Text>
          ) : null}
          {quote ? (
            <View style={styles.quoteBox}>
              <Text style={styles.meta}>الإجمالي: {quote.price} عملة</Text>
              <Text style={styles.meta}>عمولة المنصة: {quote.platformShare}</Text>
              <Text style={styles.meta}>أرباح المستلم: {quote.recipientCredit}</Text>
              <Text style={styles.meta}>سياسة العمولة v{quote.policyVersion}</Text>
              <Text accessibilityLiveRegion="polite" style={styles.meta}>
                ينتهي عرض السعر خلال {quoteSecondsRemaining} ثانية
              </Text>
            </View>
          ) : null}
        </ScrollView>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            disabled={pending || !enabled}
            onPress={() => void quoteGift()}
            style={[styles.button, styles.secondary]}
          >
            <Text style={styles.buttonText}>{pending ? '...' : 'عرض السعر'}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={pending || !enabled || !quote}
            onPress={() => void sendGift()}
            style={styles.button}
          >
            <Text style={styles.buttonText}>{pending ? '...' : 'تأكيد الإرسال'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row-reverse',
    gap: 10,
    paddingTop: 8,
  },
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#c9a227',
    borderRadius: 12,
    flex: 1,
    paddingVertical: 12,
  },
  buttonText: {
    color: '#1a1408',
    fontWeight: '700',
  },
  content: {
    gap: 8,
    paddingBottom: 12,
  },
  error: {
    color: '#ff8f8f',
    marginBottom: 8,
    textAlign: 'right',
  },
  meta: {
    color: '#d7c7a2',
    marginBottom: 4,
    textAlign: 'right',
  },
  option: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  optionActive: {
    backgroundColor: 'rgba(201,162,39,0.28)',
  },
  optionText: {
    color: '#f7f1e4',
    textAlign: 'right',
  },
  quantityChip: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 999,
    minWidth: 44,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  quantityRow: {
    flexDirection: 'row-reverse',
    gap: 8,
  },
  quoteBox: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    gap: 2,
    marginTop: 8,
    padding: 12,
  },
  secondary: {
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  section: {
    color: '#f5d76e',
    fontWeight: '700',
    marginTop: 8,
    textAlign: 'right',
  },
  sheet: {
    backgroundColor: '#241c12',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    bottom: 0,
    left: 0,
    maxHeight: '78%',
    padding: 16,
    position: 'absolute',
    right: 0,
  },
  title: {
    color: '#fff8e8',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'right',
  },
});
