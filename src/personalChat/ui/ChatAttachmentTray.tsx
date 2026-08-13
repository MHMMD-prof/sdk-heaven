import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, I18nManager, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { requestMyStoreItems } from '../../social/requestSocialCommand';
import type { MyStoreItem } from '../../social/types';
import {
  beginDirectChatUpload,
  DIRECT_CHAT_IMAGE_MAX_BYTES,
  DIRECT_CHAT_VOICE_MAX_BYTES,
  DIRECT_CHAT_VOICE_MAX_SECONDS,
  type DirectChatLocalAttachment,
  type DirectChatUploadController,
} from '../directChatMedia';
import { triggerChatSelectionFeedback, triggerChatSuccessFeedback, triggerChatWarningFeedback } from './chatFeedback';
import { chatColors, chatMetrics } from './chatTheme';

const ar = I18nManager.isRTL;
const tr = (arabic: string, english: string) => ar ? arabic : english;
const EMOJIS = ['😀', '😂', '🥰', '😍', '😎', '🤔', '😢', '😭', '😡', '👍', '👏', '🔥', '❤️', '✨', '🎉', '💎', '🚀', '🌹'];

type TrayMode = 'image' | 'root' | 'sticker';

export function ChatAttachmentTray({
  disabled,
  mediaDisabled,
  onClose,
  onComplete,
  onEmoji,
  onSticker,
  open,
  replyToMessageId,
  targetUid,
}: {
  disabled: boolean;
  mediaDisabled: boolean;
  onClose: () => void;
  onComplete: () => Promise<unknown>;
  onEmoji: (emoji: string) => Promise<boolean>;
  onSticker: (itemId: string) => Promise<boolean>;
  open: boolean;
  replyToMessageId?: string;
  targetUid: string;
}) {
  const insets = useSafeAreaInsets();
  const [attachment, setAttachment] = useState<DirectChatLocalAttachment>();
  const [error, setError] = useState('');
  const [mode, setMode] = useState<TrayMode>('root');
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const upload = useRef<DirectChatUploadController | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void ImagePicker.getPendingResultAsync().then((result) => {
      if (!active || !result || 'code' in result || result.canceled) return;
      const asset = result.assets[0];
      if (asset) setImageAttachment(asset);
    }).catch(() => undefined);
    return () => {
      active = false;
      upload.current?.cancel();
    };
  }, []);

  useEffect(() => {
    if (open) setMode('root');
  }, [open]);

  useEffect(() => {
    if (!disabled) return;
    upload.current?.cancel();
    setAttachment(undefined);
    setUploading(false);
  }, [disabled]);

  const setImageAttachment = (asset: ImagePicker.ImagePickerAsset) => {
    const contentType = asset.mimeType || inferImageType(asset.fileName || asset.uri);
    const sizeBytes = Number(asset.fileSize || new File(asset.uri).size || 0);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType) || sizeBytes < 1 || sizeBytes > DIRECT_CHAT_IMAGE_MAX_BYTES) {
      setError(tr('اختر صورة JPEG أو PNG أو WebP أصغر من 6 م.ب.', 'Choose a JPEG, PNG, or WebP image smaller than 6 MB.'));
      triggerChatWarningFeedback();
      return;
    }
    setError('');
    setAttachment({ contentType: contentType as DirectChatLocalAttachment['contentType'], kind: 'image', sizeBytes, uri: asset.uri });
    onClose();
    triggerChatSelectionFeedback();
  };

  const pickImage = async (camera: boolean) => {
    try {
      if (camera && !(await ImagePicker.requestCameraPermissionsAsync()).granted) throw new Error(tr('يلزم إذن الكاميرا.', 'Camera permission is required.'));
      const result = await (camera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync)({
        allowsEditing: false,
        base64: false,
        exif: false,
        mediaTypes: ['images'],
        quality: 0.9,
        selectionLimit: 1,
      });
      if (!result.canceled && result.assets[0]) setImageAttachment(result.assets[0]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr('تعذر فتح الصور.', 'Unable to open images.'));
      triggerChatWarningFeedback();
    }
  };

  const submit = () => {
    if (!attachment || uploading) return;
    setUploading(true);
    setProgress(0);
    setError('');
    const controller = beginDirectChatUpload({ attachment, onProgress: (value) => setProgress(value.progress), replyToMessageId, targetUid });
    upload.current = controller;
    void controller.completed.then(async () => {
      setAttachment(undefined);
      setProgress(0);
      triggerChatSuccessFeedback();
      await onComplete();
    }).catch((cause) => {
      setError(cause instanceof Error && cause.message === 'UPLOAD_CANCELLED'
        ? tr('أُلغي الرفع.', 'Upload cancelled.')
        : cause instanceof Error ? cause.message : tr('فشل الرفع.', 'Upload failed.'));
      triggerChatWarningFeedback();
    }).finally(() => {
      setUploading(false);
      upload.current = undefined;
    });
  };

  const chooseEmoji = async (emoji: string) => {
    onClose();
    triggerChatSelectionFeedback();
    if (await onEmoji(emoji)) triggerChatSuccessFeedback();
    else triggerChatWarningFeedback();
  };

  const chooseSticker = async (itemId: string) => {
    onClose();
    triggerChatSelectionFeedback();
    if (await onSticker(itemId)) triggerChatSuccessFeedback();
    else triggerChatWarningFeedback();
  };

  return (
    <>
      {attachment ? (
        <AttachmentPreview
          attachment={attachment}
          error={error}
          onCancel={() => {
            upload.current?.cancel();
            setAttachment(undefined);
            setUploading(false);
          }}
          onSend={submit}
          progress={progress}
          uploading={uploading}
        />
      ) : error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
      <Modal animationType="slide" onRequestClose={onClose} transparent visible={open}>
        <View accessibilityViewIsModal style={styles.stage}>
          <Pressable accessibilityLabel={tr('إغلاق المرفقات', 'Close attachments')} onPress={onClose} style={styles.scrim} />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 14) }]}>
            <View style={styles.handle} />
            <View style={styles.sheetHeader}>
              {mode !== 'root' ? <Pressable accessibilityLabel={tr('رجوع', 'Back')} onPress={() => setMode('root')} style={styles.back}><Text style={styles.backText}>‹</Text></Pressable> : <View style={styles.back} />}
              <Text accessibilityRole="header" style={styles.title}>{mode === 'image' ? tr('مشاركة صورة', 'Share image') : mode === 'sticker' ? tr('ملصقاتك', 'Your stickers') : tr('إضافة إلى الرسالة', 'Add to message')}</Text>
              <Pressable accessibilityLabel={tr('إغلاق', 'Close')} onPress={onClose} style={styles.back}><Text style={styles.close}>×</Text></Pressable>
            </View>
            {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
            {mode === 'root' ? (
              <>
                <View style={styles.actionGrid}>
                  <TrayAction disabled={disabled || mediaDisabled || uploading} label={tr('صورة', 'Image')} onPress={() => { setMode('image'); triggerChatSelectionFeedback(); }} symbol={{ ios: 'photo.fill', android: 'image', web: 'image' }} />
                  <VoiceRecordAction disabled={disabled || mediaDisabled || uploading} onError={setError} onRecorded={(next) => { setError(''); setAttachment(next); onClose(); }} />
                  <TrayAction disabled={disabled || uploading} label={tr('ملصق', 'Sticker')} onPress={() => { setMode('sticker'); triggerChatSelectionFeedback(); }} symbol={{ ios: 'sparkles.rectangle.stack.fill', android: 'auto_awesome', web: 'auto_awesome' }} />
                </View>
                <Text style={styles.sectionLabel}>{tr('رموز تعبيرية', 'Emoji')}</Text>
                <View style={styles.emojiGrid}>{EMOJIS.map((emoji) => <Pressable accessibilityLabel={tr(`إرسال ${emoji}`, `Send ${emoji}`)} key={emoji} onPress={() => void chooseEmoji(emoji)} style={styles.emoji}><Text style={styles.emojiText}>{emoji}</Text></Pressable>)}</View>
              </>
            ) : mode === 'image' ? (
              <View style={styles.imageActions}>
                <TrayAction disabled={disabled || mediaDisabled} label={tr('الكاميرا', 'Camera')} onPress={() => void pickImage(true)} symbol={{ ios: 'camera.fill', android: 'photo_camera', web: 'photo_camera' }} />
                <TrayAction disabled={disabled || mediaDisabled} label={tr('مكتبة الصور', 'Photo library')} onPress={() => void pickImage(false)} symbol={{ ios: 'photo.on.rectangle', android: 'photo_library', web: 'photo_library' }} />
              </View>
            ) : <StickerCollection onSelect={(itemId) => void chooseSticker(itemId)} />}
          </View>
        </View>
      </Modal>
    </>
  );
}

function VoiceRecordAction({ disabled, onError, onRecorded }: { disabled: boolean; onError: (message: string) => void; onRecorded: (attachment: DirectChatLocalAttachment) => void }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 200);
  const alive = useRef(true);
  const held = useRef(false);
  const started = useRef(false);
  const durationMillis = useRef(0);
  const busy = useRef(false);

  useEffect(() => { durationMillis.current = state.durationMillis; }, [state.durationMillis]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      held.current = false;
      started.current = false;
      void releaseRecorder(recorder);
    };
  }, [recorder]);

  const start = async () => {
    if (disabled || busy.current) return;
    held.current = true;
    busy.current = true;
    try {
      if (!(await requestRecordingPermissionsAsync()).granted) throw new Error(tr('يلزم إذن الميكروفون.', 'Microphone permission is required.'));
      if (!held.current || !alive.current) return;
      await setAudioModeAsync({ allowsRecording: true, interruptionMode: 'doNotMix', playsInSilentMode: true, shouldPlayInBackground: false, shouldRouteThroughEarpiece: false });
      if (!held.current || !alive.current) return;
      await recorder.prepareToRecordAsync();
      if (!held.current || !alive.current) return void releaseRecorder(recorder);
      started.current = true;
      recorder.record({ forDuration: DIRECT_CHAT_VOICE_MAX_SECONDS });
      triggerChatSelectionFeedback();
    } catch (cause) {
      held.current = false;
      started.current = false;
      onError(cause instanceof Error ? cause.message : tr('تعذر بدء التسجيل.', 'Unable to start recording.'));
      triggerChatWarningFeedback();
      await releaseRecorder(recorder);
    } finally {
      busy.current = false;
    }
  };

  const stop = async () => {
    held.current = false;
    if (!started.current || busy.current) return;
    busy.current = true;
    started.current = false;
    try {
      await recorder.stop();
      const uri = typeof recorder.uri === 'string' ? recorder.uri : '';
      await resetAudioMode();
      if (!alive.current || !uri || durationMillis.current < 300) return;
      const file = new File(uri);
      if (!file.exists || file.size > DIRECT_CHAT_VOICE_MAX_BYTES) {
        onError(tr('التسجيل أكبر من 5 م.ب.', 'Recording is larger than 5 MB.'));
        return triggerChatWarningFeedback();
      }
      onRecorded({ contentType: 'audio/mp4', kind: 'voice-note', sizeBytes: file.size, uri });
      triggerChatSelectionFeedback();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : tr('تعذر حفظ التسجيل.', 'Unable to save recording.'));
      triggerChatWarningFeedback();
    } finally {
      busy.current = false;
    }
  };

  return (
    <Pressable
      accessibilityHint={tr('اضغط مطولاً للتسجيل واترك للمعاينة', 'Press and hold to record, release to preview')}
      accessibilityLabel={state.isRecording ? tr(`تسجيل ${Math.ceil(state.durationMillis / 1000)} ثانية`, `Recording ${Math.ceil(state.durationMillis / 1000)} seconds`) : tr('رسالة صوتية', 'Voice message')}
      accessibilityRole="button"
      disabled={disabled}
      onPressIn={() => void start()}
      onPressOut={() => void stop()}
      style={[styles.action, state.isRecording && styles.recording, disabled && styles.disabled]}
    >
      <SymbolView name={{ ios: 'mic.fill', android: 'mic', web: 'mic' }} size={24} tintColor={state.isRecording ? '#FFF' : chatColors.goldBright} />
      <Text style={styles.actionLabel}>{state.isRecording ? `${Math.min(120, Math.ceil(state.durationMillis / 1000))}s` : tr('صوت', 'Voice')}</Text>
    </Pressable>
  );
}

function TrayAction({ disabled, label, onPress, symbol }: { disabled: boolean; label: string; onPress: () => void; symbol: SymbolViewProps['name'] }) {
  return <Pressable accessibilityLabel={label} accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.action, disabled && styles.disabled, pressed && styles.pressed]}><SymbolView name={symbol} size={24} tintColor={chatColors.goldBright} /><Text style={styles.actionLabel}>{label}</Text></Pressable>;
}

function AttachmentPreview({ attachment, error, onCancel, onSend, progress, uploading }: { attachment: DirectChatLocalAttachment; error: string; onCancel: () => void; onSend: () => void; progress: number; uploading: boolean }) {
  return (
    <View style={styles.preview}>
      {attachment.kind === 'image' ? <Image accessibilityLabel={tr('معاينة الصورة', 'Image preview')} contentFit="cover" source={{ uri: attachment.uri }} style={styles.previewImage} /> : <LocalVoicePreview uri={attachment.uri} />}
      <View style={styles.previewCopy}>
        <Text style={styles.previewTitle}>{attachment.kind === 'image' ? tr('صورة محمية', 'Protected image') : tr('رسالة صوتية', 'Voice message')}</Text>
        <Text accessibilityLiveRegion="polite" style={[styles.previewMeta, error && styles.errorText]}>{uploading ? `${Math.round(progress * 100)}%` : error || `${Math.ceil(attachment.sizeBytes / 1024)} KB`}</Text>
        {uploading ? <View style={styles.progress}><View style={[styles.progressFill, { width: `${Math.max(2, progress * 100)}%` }]} /></View> : null}
      </View>
      <Pressable accessibilityLabel={uploading ? tr('إلغاء الرفع', 'Cancel upload') : tr('حذف المرفق', 'Discard attachment')} accessibilityRole="button" onPress={onCancel} style={styles.previewButton}><Text style={styles.discard}>×</Text></Pressable>
      {!uploading ? <Pressable accessibilityLabel={error ? tr('إعادة محاولة الرفع', 'Retry upload') : tr('إرسال المرفق', 'Send attachment')} accessibilityRole="button" onPress={onSend} style={styles.previewButton}><Text style={styles.previewSend}>{error ? '↻' : '↑'}</Text></Pressable> : null}
    </View>
  );
}

function LocalVoicePreview({ uri }: { uri: string }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  return <Pressable accessibilityLabel={status.playing ? tr('إيقاف المعاينة', 'Pause preview') : tr('تشغيل المعاينة', 'Play preview')} onPress={() => status.playing ? player.pause() : player.play()} style={styles.localVoice}><Text style={styles.previewSend}>{status.playing ? 'Ⅱ' : '▶'}</Text></Pressable>;
}

function StickerCollection({ onSelect }: { onSelect: (itemId: string) => void }) {
  const [items, setItems] = useState<MyStoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void requestMyStoreItems().then((response) => {
      if (active) setItems(response.ok ? response.result.items.filter((row) => row.ownership.category === 'stickers' && row.ownership.state === 'active' && row.catalog?.availability === 'available' && Boolean(row.catalog.stickerAsset)) : []);
    }).catch(() => { if (active) setItems([]); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const empty = useMemo(() => !loading && items.length === 0, [items.length, loading]);
  if (loading) return <ActivityIndicator color={chatColors.gold} />;
  if (empty) return <Text style={styles.empty}>{tr('لا توجد ملصقات نشطة. احصل عليها من المتجر أولاً.', 'No active stickers. Get stickers from the Store first.')}</Text>;
  return <FlatList contentContainerStyle={styles.stickers} data={items} horizontal keyExtractor={(row) => row.ownership.itemId} renderItem={({ item }) => <Pressable accessibilityLabel={tr(`إرسال ${item.catalog?.name.ar || 'ملصق'}`, `Send ${item.catalog?.name.en || 'sticker'}`)} onPress={() => onSelect(item.ownership.itemId)} style={styles.sticker}><Image contentFit="contain" source={{ uri: item.catalog?.thumbnailUrl }} style={styles.stickerImage} /></Pressable>} showsHorizontalScrollIndicator={false} />;
}

async function releaseRecorder(recorder: ReturnType<typeof useAudioRecorder>) {
  try { await recorder.stop(); } catch { /* Already stopped or released. */ }
  await resetAudioMode();
}

async function resetAudioMode() {
  await setAudioModeAsync({ allowsRecording: false, interruptionMode: 'doNotMix', playsInSilentMode: true, shouldPlayInBackground: false, shouldRouteThroughEarpiece: false }).catch(() => undefined);
}

function inferImageType(value: string) {
  const lower = value.toLowerCase();
  return lower.endsWith('.png') ? 'image/png' : lower.endsWith('.webp') ? 'image/webp' : lower.endsWith('.jpg') || lower.endsWith('.jpeg') ? 'image/jpeg' : '';
}

const styles = StyleSheet.create({
  action: { alignItems: 'center', backgroundColor: chatColors.surface, borderColor: chatColors.divider, borderRadius: 18, borderWidth: 1, flex: 1, gap: 6, justifyContent: 'center', minHeight: 84, minWidth: 0, paddingHorizontal: 8 },
  actionGrid: { flexDirection: ar ? 'row-reverse' : 'row', gap: 10, justifyContent: 'center', width: '100%' },
  actionLabel: { color: chatColors.textPrimary, fontSize: 12, fontWeight: '700' },
  back: { alignItems: 'center', height: chatMetrics.controlMinHeight, justifyContent: 'center', width: chatMetrics.controlMinHeight },
  backText: { color: chatColors.goldBright, fontSize: 29 },
  close: { color: chatColors.textSecondary, fontSize: 25 },
  disabled: { opacity: 0.34 },
  discard: { color: chatColors.danger, fontSize: 23 },
  emoji: { alignItems: 'center', height: 48, justifyContent: 'center', width: '16.66%' },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  emojiText: { fontSize: 27 },
  empty: { color: chatColors.textSecondary, lineHeight: 20, padding: 20, textAlign: 'center' },
  error: { color: chatColors.danger, fontSize: 11, paddingBottom: 6, textAlign: 'center' },
  errorText: { color: chatColors.danger },
  handle: { alignSelf: 'center', backgroundColor: chatColors.gold, borderRadius: 2, height: 3, opacity: 0.72, width: 42 },
  imageActions: { flexDirection: ar ? 'row-reverse' : 'row', gap: 12, justifyContent: 'center', paddingVertical: 18, width: '100%' },
  localVoice: { alignItems: 'center', backgroundColor: chatColors.royalRedSoft, borderRadius: 26, height: 52, justifyContent: 'center', width: 52 },
  pressed: { opacity: 0.76, transform: [{ scale: 0.98 }] },
  preview: { alignItems: 'center', backgroundColor: chatColors.surface, borderColor: chatColors.divider, borderRadius: 14, borderWidth: 1, flexDirection: ar ? 'row-reverse' : 'row', gap: 8, padding: 8 },
  previewButton: { alignItems: 'center', height: 40, justifyContent: 'center', width: 34 },
  previewCopy: { flex: 1, gap: 2 },
  previewImage: { borderRadius: 10, height: 52, width: 52 },
  previewMeta: { color: chatColors.textSecondary, fontSize: 10 },
  previewSend: { color: chatColors.goldBright, fontSize: 20, fontWeight: '900' },
  previewTitle: { color: chatColors.textPrimary, fontSize: 12, fontWeight: '800' },
  progress: { backgroundColor: chatColors.divider, borderRadius: 2, height: 4, overflow: 'hidden' },
  progressFill: { backgroundColor: chatColors.gold, height: 4 },
  recording: { backgroundColor: chatColors.royalRed, borderColor: chatColors.danger },
  scrim: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  sectionLabel: { color: chatColors.goldBright, fontSize: 12, fontWeight: '800', marginBottom: 6, marginTop: 18, textAlign: ar ? 'right' : 'left' },
  sheet: { backgroundColor: chatColors.canvasRaised, borderColor: chatColors.divider, borderTopLeftRadius: chatMetrics.sheetTopRadius, borderTopRightRadius: chatMetrics.sheetTopRadius, borderWidth: 1, maxHeight: '72%', paddingHorizontal: 16, paddingTop: 10 },
  sheetHeader: { alignItems: 'center', flexDirection: ar ? 'row-reverse' : 'row', justifyContent: 'space-between' },
  stage: { backgroundColor: chatColors.scrim, flex: 1, justifyContent: 'flex-end' },
  sticker: { alignItems: 'center', backgroundColor: chatColors.surface, borderColor: chatColors.divider, borderRadius: 16, borderWidth: 1, height: 92, justifyContent: 'center', marginEnd: 9, width: 92 },
  stickerImage: { height: 76, width: 76 },
  stickers: { paddingBottom: 8 },
  title: { color: chatColors.textPrimary, flex: 1, fontSize: 17, fontWeight: '900', textAlign: 'center' },
});
