import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { CosmeticAssetRenderer } from '../cosmetics/CosmeticAssetRenderer';
import type { CosmeticsFeatureFlags } from '../cosmetics/featureFlags';
import { usePublishedCosmeticAsset } from '../cosmetics/assetRegistry';
import { colors, radius, spacing } from '../theme';
import type { DirectChatUiMessage } from './directChatModels';
import { prepareProtectedDirectChatMedia } from './directChatMedia';

export function DirectChatAttachment({ flags, message, uid }: { flags: CosmeticsFeatureFlags; message: DirectChatUiMessage; uid: string }) {
  if (message.visibilityState !== 'visible') return null;
  if (message.kind === 'sticker') return <StickerAttachment flags={flags} message={message} />;
  if (!['image', 'voice-note'].includes(message.kind)) return null;
  if (!message.mediaPath || !message.attachmentId) return <AttachmentPlaceholder label="Unsupported attachment" />;
  return <ProtectedMedia message={message} uid={uid} />;
}

function ProtectedMedia({ message, uid }: { message: DirectChatUiMessage; uid: string }) {
  const [state, setState] = useState<{ error?: string; uri?: string }>({});
  useEffect(() => {
    let active = true;
    setState({});
    void prepareProtectedDirectChatMedia(uid, message.mediaPath).then((uri) => {
      if (active) setState({ uri });
    }).catch((error) => {
      if (active) setState({ error: error instanceof Error ? error.message : 'MEDIA_UNAVAILABLE' });
    });
    return () => { active = false; };
  }, [message.mediaPath, uid]);
  if (state.error) return <AttachmentPlaceholder label="Attachment unavailable" />;
  if (!state.uri) return <AttachmentPlaceholder loading label="Loading attachment" />;
  return message.kind === 'image'
    ? <Image accessibilityLabel="Shared image" contentFit="cover" source={{ uri: state.uri }} style={styles.image} transition={120} />
    : <VoicePlayer durationMs={message.mediaDurationMs} uri={state.uri} />;
}

function VoicePlayer({ durationMs, uri }: { durationMs: number; uri: string }) {
  const player = useAudioPlayer(uri, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const playing = status.playing === true;
  const seconds = Math.max(0, Math.round((playing ? status.currentTime * 1_000 : durationMs) / 1_000));
  return (
    <Pressable
      accessibilityLabel={playing ? 'Pause voice message' : 'Play voice message'}
      accessibilityRole="button"
      onPress={() => {
        if (playing) player.pause();
        else void setAudioModeAsync({ allowsRecording: false, interruptionMode: 'doNotMix', playsInSilentMode: true, shouldPlayInBackground: false, shouldRouteThroughEarpiece: false }).then(() => player.play());
      }}
      style={styles.voice}
    >
      <Text style={styles.voiceIcon}>{playing ? 'Ⅱ' : '▶'}</Text>
      <View style={styles.wave}><View style={[styles.waveProgress, { width: `${Math.min(100, Math.max(4, status.duration ? (status.currentTime / status.duration) * 100 : 4))}%` }]} /></View>
      <Text style={styles.duration}>{formatDuration(seconds)}</Text>
    </Pressable>
  );
}

function StickerAttachment({ flags, message }: { flags: CosmeticsFeatureFlags; message: DirectChatUiMessage }) {
  const sticker = message.sticker;
  const bundle = usePublishedCosmeticAsset(sticker?.assetId, sticker?.assetVersionId, Boolean(sticker));
  if (!sticker) return <AttachmentPlaceholder label="Sticker unavailable" />;
  if (!bundle) return <AttachmentPlaceholder loading label="Loading sticker" />;
  return (
    <View accessibilityLabel="Sticker" style={styles.sticker}>
      <CosmeticAssetRenderer descriptor={bundle.primary} fallbackDescriptor={bundle.fallback} flags={flags} style={styles.stickerAsset} viewerMode="full" />
    </View>
  );
}

function AttachmentPlaceholder({ label, loading }: { label: string; loading?: boolean }) {
  return <View accessibilityLabel={label} style={styles.placeholder}>{loading ? <ActivityIndicator color={colors.gold} size="small" /> : <Text style={styles.placeholderIcon}>!</Text>}<Text style={styles.placeholderText}>{label}</Text></View>;
}

function formatDuration(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  duration: { color: colors.goldSoft, fontSize: 11, minWidth: 34 },
  image: { backgroundColor: '#100607', borderRadius: radius.lg, height: 210, width: 250 },
  placeholder: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,.25)', borderRadius: radius.md, flexDirection: 'row', gap: spacing.sm, minHeight: 52, padding: spacing.sm },
  placeholderIcon: { color: '#FF98A2', fontSize: 20, fontWeight: '900' },
  placeholderText: { color: colors.textMuted, fontSize: 12 },
  sticker: { height: 150, width: 150 },
  stickerAsset: { height: 150, width: 150 },
  voice: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, minWidth: 210, paddingVertical: spacing.sm },
  voiceIcon: { color: colors.goldSoft, fontSize: 19, fontWeight: '900', width: 24 },
  wave: { backgroundColor: 'rgba(232,190,97,.2)', borderRadius: radius.full, flex: 1, height: 5, overflow: 'hidden' },
  waveProgress: { backgroundColor: colors.gold, borderRadius: radius.full, height: 5 },
});
