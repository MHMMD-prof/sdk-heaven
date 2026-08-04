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
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { requestMyStoreItems } from '../social/requestSocialCommand';
import type { MyStoreItem } from '../social/types';
import { colors, radius, spacing, typography } from '../theme';
import {
  beginDirectChatUpload,
  DIRECT_CHAT_IMAGE_MAX_BYTES,
  DIRECT_CHAT_VOICE_MAX_BYTES,
  DIRECT_CHAT_VOICE_MAX_SECONDS,
  type DirectChatLocalAttachment,
  type DirectChatUploadController,
} from './directChatMedia';

const EMOJIS = ['😀', '😂', '🥰', '😍', '😎', '🤔', '😢', '😭', '😡', '👍', '👏', '🔥', '❤️', '✨', '🎉', '💎', '🚀', '🌹'];

export function DirectChatComposerTools({
  disabled,
  mediaDisabled,
  onComplete,
  onEmoji,
  onSticker,
  replyToMessageId,
  targetUid,
}: {
  disabled: boolean;
  mediaDisabled: boolean;
  onComplete: () => Promise<unknown>;
  onEmoji: (emoji: string) => Promise<boolean>;
  onSticker: (itemId: string) => Promise<boolean>;
  replyToMessageId?: string;
  targetUid: string;
}) {
  const [attachment, setAttachment] = useState<DirectChatLocalAttachment>();
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [picker, setPicker] = useState<'emoji' | 'sticker'>();
  const upload = useRef<DirectChatUploadController | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void ImagePicker.getPendingResultAsync().then((result) => {
      if (!active || !result || 'code' in result || result.canceled) return;
      const asset = result.assets[0];
      if (asset) setImageAttachment(asset);
    }).catch(() => undefined);
    return () => { active = false; upload.current?.cancel(); };
  }, []);

  const setImageAttachment = (asset: ImagePicker.ImagePickerAsset) => {
    const contentType = asset.mimeType || inferImageType(asset.fileName || asset.uri);
    const sizeBytes = Number(asset.fileSize || new File(asset.uri).size || 0);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType) || sizeBytes < 1 || sizeBytes > DIRECT_CHAT_IMAGE_MAX_BYTES) {
      setError('Choose a JPEG, PNG, or WebP image smaller than 6 MB.');
      return;
    }
    setError('');
    setAttachment({ contentType: contentType as DirectChatLocalAttachment['contentType'], kind: 'image', sizeBytes, uri: asset.uri });
  };

  const pickImage = async (camera: boolean) => {
    try {
      if (camera && !(await ImagePicker.requestCameraPermissionsAsync()).granted) throw new Error('Camera permission is required.');
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
      setError(cause instanceof Error ? cause.message : 'Unable to open images.');
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
      await onComplete();
    }).catch((cause) => setError(cause instanceof Error && cause.message === 'UPLOAD_CANCELLED' ? 'Upload cancelled.' : cause instanceof Error ? cause.message : 'Upload failed.')).finally(() => {
      setUploading(false);
      upload.current = undefined;
    });
  };

  return (
    <>
      {attachment ? <AttachmentPreview attachment={attachment} error={error} onCancel={() => { upload.current?.cancel(); setAttachment(undefined); setUploading(false); }} onRetry={submit} progress={progress} uploading={uploading} /> : error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
      <View style={styles.toolbar}>
        <ToolButton disabled={disabled || mediaDisabled || uploading} label="Choose image" onPress={() => Alert.alert('Share image', 'Choose a protected image source.', [{ text: 'Camera', onPress: () => void pickImage(true) }, { text: 'Photo library', onPress: () => void pickImage(false) }, { style: 'cancel', text: 'Cancel' }])} symbol={{ ios: 'photo.fill', android: 'image', web: 'image' }} />
        <VoiceRecordButton disabled={disabled || mediaDisabled || uploading} onRecorded={(next) => { setError(''); setAttachment(next); }} />
        <ToolButton disabled={disabled || uploading} label="Emoji" onPress={() => setPicker('emoji')} symbol={{ ios: 'face.smiling.fill', android: 'mood', web: 'mood' }} />
        <ToolButton disabled={disabled || uploading} label="Owned stickers" onPress={() => setPicker('sticker')} symbol={{ ios: 'sparkles.rectangle.stack.fill', android: 'auto_awesome', web: 'auto_awesome' }} />
      </View>
      <EmojiPicker open={picker === 'emoji'} onClose={() => setPicker(undefined)} onSelect={(emoji) => { setPicker(undefined); void onEmoji(emoji); }} />
      <StickerPicker open={picker === 'sticker'} onClose={() => setPicker(undefined)} onSelect={(itemId) => { setPicker(undefined); void onSticker(itemId); }} />
    </>
  );
}

function VoiceRecordButton({ disabled, onRecorded }: { disabled: boolean; onRecorded: (attachment: DirectChatLocalAttachment) => void }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 100);
  const held = useRef(false);
  const started = useRef(false);
  useEffect(() => () => {
    held.current = false;
    if (recorder.isRecording) void recorder.stop();
    void setAudioModeAsync({ allowsRecording: false, interruptionMode: 'doNotMix', playsInSilentMode: true, shouldPlayInBackground: false, shouldRouteThroughEarpiece: false });
  }, [recorder]);
  const start = async () => {
    held.current = true;
    try {
      if (!(await requestRecordingPermissionsAsync()).granted) throw new Error('Microphone permission is required.');
      if (!held.current) return;
      await setAudioModeAsync({ allowsRecording: true, interruptionMode: 'doNotMix', playsInSilentMode: true, shouldPlayInBackground: false, shouldRouteThroughEarpiece: false });
      await recorder.prepareToRecordAsync();
      if (!held.current) return;
      started.current = true;
      recorder.record({ forDuration: DIRECT_CHAT_VOICE_MAX_SECONDS });
    } catch (cause) {
      held.current = false;
      started.current = false;
      void setAudioModeAsync({ allowsRecording: false, interruptionMode: 'doNotMix', playsInSilentMode: true, shouldPlayInBackground: false, shouldRouteThroughEarpiece: false });
      Alert.alert('Voice message', cause instanceof Error ? cause.message : 'Unable to start recording.');
    }
  };
  const stop = async () => {
    held.current = false;
    if (!started.current) return;
    if (recorder.isRecording) await recorder.stop();
    started.current = false;
    await setAudioModeAsync({ allowsRecording: false, interruptionMode: 'doNotMix', playsInSilentMode: true, shouldPlayInBackground: false, shouldRouteThroughEarpiece: false });
    const uri = recorder.uri;
    if (!uri || state.durationMillis < 300) return;
    const file = new File(uri);
    if (!file.exists || file.size > DIRECT_CHAT_VOICE_MAX_BYTES) {
      Alert.alert('Voice message', 'Recording is larger than 5 MB.');
      return;
    }
    onRecorded({ contentType: 'audio/mp4', kind: 'voice-note', sizeBytes: file.size, uri });
  };
  return (
    <Pressable
      accessibilityHint="Press and hold to record, release to preview"
      accessibilityLabel={state.isRecording ? `Recording ${Math.ceil(state.durationMillis / 1000)} seconds` : 'Record voice message'}
      accessibilityRole="button"
      disabled={disabled}
      onPressIn={() => void start()}
      onPressOut={() => void stop()}
      style={[styles.tool, state.isRecording && styles.recording, disabled && styles.disabled]}
    >
      <SymbolView name={{ ios: 'mic.fill', android: 'mic', web: 'mic' }} size={20} tintColor={state.isRecording ? '#FFF' : colors.goldSoft} />
      {state.isRecording ? <Text style={styles.recordingTime}>{Math.min(120, Math.ceil(state.durationMillis / 1000))}s</Text> : null}
    </Pressable>
  );
}

function AttachmentPreview({ attachment, error, onCancel, onRetry, progress, uploading }: { attachment: DirectChatLocalAttachment; error: string; onCancel: () => void; onRetry: () => void; progress: number; uploading: boolean }) {
  return <View style={styles.preview}>{attachment.kind === 'image' ? <Image contentFit="cover" source={{ uri: attachment.uri }} style={styles.previewImage} /> : <LocalVoicePreview uri={attachment.uri} />}<View style={styles.previewCopy}><Text style={styles.previewTitle}>{attachment.kind === 'image' ? 'Protected image' : 'Voice message'}</Text><Text style={styles.previewMeta}>{uploading ? `${Math.round(progress * 100)}%` : error || `${Math.ceil(attachment.sizeBytes / 1024)} KB`}</Text>{uploading ? <View style={styles.progress}><View style={[styles.progressFill, { width: `${Math.max(2, progress * 100)}%` }]} /></View> : null}</View><Pressable accessibilityLabel={uploading ? 'Cancel upload' : 'Discard attachment'} onPress={onCancel} style={styles.previewAction}><Text style={styles.cancel}>×</Text></Pressable>{!uploading ? <Pressable accessibilityLabel={error ? 'Retry upload' : 'Send attachment'} onPress={onRetry} style={styles.previewAction}><Text style={styles.send}>{error ? '↻' : '↑'}</Text></Pressable> : null}</View>;
}

function LocalVoicePreview({ uri }: { uri: string }) { const player = useAudioPlayer(uri); const status = useAudioPlayerStatus(player); return <Pressable accessibilityLabel={status.playing ? 'Pause preview' : 'Play preview'} onPress={() => status.playing ? player.pause() : player.play()} style={styles.localVoice}><Text style={styles.send}>{status.playing ? 'Ⅱ' : '▶'}</Text></Pressable>; }
function ToolButton({ disabled, label, onPress, symbol }: { disabled: boolean; label: string; onPress: () => void; symbol: ComponentProps<typeof SymbolView>['name'] }) { return <Pressable accessibilityLabel={label} accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.tool, disabled && styles.disabled]}><SymbolView name={symbol} size={20} tintColor={colors.goldSoft} /></Pressable>; }

function EmojiPicker({ onClose, onSelect, open }: { onClose: () => void; onSelect: (emoji: string) => void; open: boolean }) { return <Modal animationType="fade" onRequestClose={onClose} transparent visible={open}><Pressable onPress={onClose} style={styles.backdrop}><View accessibilityViewIsModal style={styles.sheet}><Text style={styles.sheetTitle}>Emoji</Text><View style={styles.emojiGrid}>{EMOJIS.map((emoji) => <Pressable accessibilityLabel={`Send ${emoji}`} key={emoji} onPress={() => onSelect(emoji)} style={styles.emoji}><Text style={styles.emojiText}>{emoji}</Text></Pressable>)}</View></View></Pressable></Modal>; }

function StickerPicker({ onClose, onSelect, open }: { onClose: () => void; onSelect: (itemId: string) => void; open: boolean }) {
  const [items, setItems] = useState<MyStoreItem[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => { if (!open) return; setLoading(true); void requestMyStoreItems().then((response) => setItems(response.ok ? response.result.items.filter((row) => row.ownership.category === 'stickers' && row.ownership.state === 'active' && row.catalog?.availability === 'available' && Boolean(row.catalog.stickerAsset)) : [])).catch(() => setItems([])).finally(() => setLoading(false)); }, [open]);
  const empty = useMemo(() => !loading && items.length === 0, [items.length, loading]);
  return <Modal animationType="slide" onRequestClose={onClose} transparent visible={open}><Pressable onPress={onClose} style={styles.backdrop}><View accessibilityViewIsModal style={styles.sheet}><Text style={styles.sheetTitle}>Owned stickers</Text>{loading ? <ActivityIndicator color={colors.gold} /> : null}{empty ? <Text style={styles.empty}>No active owned stickers. Get stickers from the Store first.</Text> : <FlatList data={items} horizontal keyExtractor={(row) => row.ownership.itemId} renderItem={({ item }) => <Pressable accessibilityLabel={`Send ${item.catalog?.name.en || 'sticker'}`} onPress={() => onSelect(item.ownership.itemId)} style={styles.sticker}><Image contentFit="contain" source={{ uri: item.catalog?.thumbnailUrl }} style={styles.stickerImage} /></Pressable>} />}</View></Pressable></Modal>;
}

function inferImageType(value: string) { const lower = value.toLowerCase(); return lower.endsWith('.png') ? 'image/png' : lower.endsWith('.webp') ? 'image/webp' : lower.endsWith('.jpg') || lower.endsWith('.jpeg') ? 'image/jpeg' : ''; }

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,.72)', flex: 1, justifyContent: 'flex-end' },
  cancel: { color: '#FF9DA7', fontSize: 24 },
  disabled: { opacity: 0.3 },
  emoji: { alignItems: 'center', height: 48, justifyContent: 'center', width: '16.6%' },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  emojiText: { fontSize: 27 },
  empty: { color: colors.textMuted, padding: spacing.md, textAlign: 'center' },
  error: { color: '#FF9DA7', fontSize: 11, paddingBottom: spacing.xs, textAlign: 'center' },
  localVoice: { alignItems: 'center', backgroundColor: '#2A0B0E', borderRadius: radius.full, height: 52, justifyContent: 'center', width: 52 },
  preview: { alignItems: 'center', backgroundColor: '#150809', borderColor: colors.borderGold, borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm, padding: spacing.sm },
  previewAction: { alignItems: 'center', height: 38, justifyContent: 'center', width: 34 },
  previewCopy: { flex: 1 },
  previewImage: { borderRadius: radius.md, height: 52, width: 52 },
  previewMeta: { color: colors.textMuted, fontSize: 10 },
  previewTitle: { color: colors.text, fontSize: 12, fontWeight: typography.weights.bold },
  progress: { backgroundColor: 'rgba(232,190,97,.2)', borderRadius: radius.full, height: 4, marginTop: 5, overflow: 'hidden' },
  progressFill: { backgroundColor: colors.gold, height: 4 },
  recording: { backgroundColor: '#B31224', borderColor: '#FF8B96', width: 70 },
  recordingTime: { color: '#FFF', fontSize: 10, fontWeight: '800' },
  send: { color: colors.goldSoft, fontSize: 20, fontWeight: '900' },
  sheet: { backgroundColor: '#120707', borderColor: colors.borderGold, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, maxHeight: 330, padding: spacing.lg },
  sheetTitle: { color: colors.goldSoft, fontSize: 18, fontWeight: typography.weights.black, marginBottom: spacing.md, textAlign: 'center' },
  sticker: { alignItems: 'center', backgroundColor: '#1D0B0D', borderColor: colors.borderGold, borderRadius: radius.lg, borderWidth: 1, height: 92, justifyContent: 'center', marginEnd: spacing.sm, width: 92 },
  stickerImage: { height: 76, width: 76 },
  tool: { alignItems: 'center', backgroundColor: '#16090A', borderColor: colors.borderGold, borderRadius: radius.full, borderWidth: 1, flexDirection: 'row', gap: 4, height: 38, justifyContent: 'center', minWidth: 38 },
  toolbar: { flexDirection: 'row', gap: spacing.sm, paddingBottom: spacing.sm },
});
