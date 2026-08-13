import * as ImagePicker from 'expo-image-picker';
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import { useCallback, useEffect, useState } from 'react';

import { firebaseApp } from '../auth/firebase';
import { VoiceRoom } from '../types/voice';
import { debugError, debugLog } from '../utils/debugLog';
import { VoiceProviderConfig } from './types';
import { useVoiceProviderConfig } from './useVoiceProviderConfig';
import { getVoiceAppCheckHeader } from './voiceRequestAppCheck';

export type RoomMediaCommandAction =
  | 'submit-room-image'
  | 'approve-room-image'
  | 'reject-room-image'
  | 'remove-room-image'
  | 'restore-room-customization';

export type RoomMediaCommandRequest = {
  action: RoomMediaCommandAction;
  expectedRevision: number;
  mediaId?: string;
  mediaPath?: string;
  reason?: string;
  requestId?: string;
  roomId: string;
  suspendCustomization?: boolean;
};

type RoomMediaCommandResponse = {
  ok?: boolean;
  code?: string;
  error?: string;
  result?: {
    action: RoomMediaCommandAction;
    mediaId: string;
    requestId: string;
    revision: number;
    roomId: string;
    status: 'applied';
  };
};

const roomMediaCommandTimeoutMs = 10_000;

export class RoomMediaError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'RoomMediaError';
    this.code = code;
    this.status = status;
  }
}

export function useRoomMediaControls(room: VoiceRoom) {
  const config = useVoiceProviderConfig();
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();

  const selectAndSubmitImage = useCallback(async () => {
    if (pending) return;
    setPending(true);
    setErrorMessage(undefined);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        aspect: [16, 9],
        mediaTypes: ['images'],
        quality: 0.82,
        selectionLimit: 1,
      });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      if (
        !Number.isInteger(asset.width)
        || !Number.isInteger(asset.height)
        || asset.width < 800
        || asset.height < 450
        || asset.width > 4096
        || asset.height > 4096
      ) {
        throw new RoomMediaError(
          'ROOM_IMAGE_DIMENSIONS_INVALID',
          'اختر صورة أفقية بين 800×450 و4096 بكسل.',
          400,
        );
      }
      const blob = await (await fetch(asset.uri)).blob();
      if (blob.size < 1 || blob.size > 4 * 1024 * 1024) {
        throw new RoomMediaError('ROOM_IMAGE_INVALID', 'يجب ألا يتجاوز حجم صورة الغرفة 4 ميغابايت.', 400);
      }
      const contentType = normalizeRoomImageContentType(asset.mimeType || blob.type);
      if (!contentType) {
        throw new RoomMediaError('ROOM_IMAGE_INVALID', 'استخدم صورة JPEG أو PNG أو WebP.', 400);
      }
      const mediaId = createRoomMediaId();
      const mediaPath = `room-media/${room.id}/${mediaId}/source`;
      debugLog('voice.roomMedia', 'upload:start', { mediaId, roomId: room.id, size: blob.size });
      await uploadBytes(ref(getStorage(firebaseApp), mediaPath), blob, {
        contentType,
        customMetadata: {
          height: String(asset.height),
          uploaderUid: room.localMember?.id || '',
          width: String(asset.width),
        },
      });
      await requestRoomMediaCommand({
        action: 'submit-room-image',
        expectedRevision: room.revision ?? 1,
        mediaId,
        mediaPath,
        roomId: room.id,
      }, config.liveKit);
      debugLog('voice.roomMedia', 'upload:submitted', { mediaId, roomId: room.id });
    } catch (error) {
      debugError('voice.roomMedia', 'upload:error', error, { roomId: room.id });
      const message = error instanceof RoomMediaError
        ? error.message
        : 'تعذر رفع صورة الغرفة. حاول مرة أخرى.';
      setErrorMessage(message);
      throw error;
    } finally {
      setPending(false);
    }
  }, [config.liveKit, pending, room]);

  return {
    errorMessage,
    pending,
    selectAndSubmitImage,
  };
}

export function useRoomImageUrl(path: string | undefined) {
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    let mounted = true;
    setUrl(undefined);
    if (!path) return undefined;
    void getDownloadURL(ref(getStorage(firebaseApp), path))
      .then((nextUrl) => {
        if (mounted) setUrl(nextUrl);
      })
      .catch((error) => {
        debugError('voice.roomMedia', 'downloadUrl:error', error, { path });
      });
    return () => {
      mounted = false;
    };
  }, [path]);

  return url;
}

export async function requestRoomMediaCommand(
  input: RoomMediaCommandRequest,
  config?: VoiceProviderConfig['liveKit'],
  getIdToken = getDefaultFirebaseIdToken,
) {
  const endpoint = config?.roomMediaCommandEndpoint;
  if (!endpoint) {
    throw new RoomMediaError('ENDPOINT_MISSING', 'خدمة صور الغرف غير مهيأة.', 0);
  }
  const requestId = input.requestId || createRoomMediaRequestId();
  const idToken = await getIdToken();
  const body = JSON.stringify({ ...input, requestId });
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), roomMediaCommandTimeoutMs);
    try {
      const response = await fetch(endpoint, {
        body,
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
          ...(await getVoiceAppCheckHeader()),
        },
        method: 'POST',
        signal: controller.signal,
      });
      const payload = await readResponse(response);
      if (!response.ok || payload.ok !== true || !payload.result) {
        const error = new RoomMediaError(
          payload.code || `HTTP_${response.status}`,
          roomMediaErrorMessage(payload.code, payload.error),
          response.status,
        );
        if (response.status >= 500 && attempt === 1) {
          lastError = error;
          continue;
        }
        throw error;
      }
      return payload.result;
    } catch (error) {
      if (error instanceof RoomMediaError) throw error;
      lastError = error;
      if (attempt === 1) continue;
    } finally {
      clearTimeout(timeout);
    }
  }
  const timeout = lastError instanceof Error && lastError.name === 'AbortError';
  throw new RoomMediaError(
    timeout ? 'TIMEOUT' : 'NETWORK_ERROR',
    timeout ? 'انتهت مهلة خدمة صور الغرف. حاول مرة أخرى.' : 'تعذر الاتصال بخدمة صور الغرف.',
    0,
  );
}

export function normalizeRoomImageContentType(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'image/jpg') return 'image/jpeg';
  return normalized === 'image/jpeg' || normalized === 'image/png' || normalized === 'image/webp'
    ? normalized
    : null;
}

export function createRoomMediaId(now = Date.now(), random = Math.random()) {
  return `media_${now.toString(36)}_${Math.floor(random * Number.MAX_SAFE_INTEGER).toString(36).padStart(11, '0')}`;
}

export function createRoomMediaRequestId(now = Date.now(), random = Math.random()) {
  return `media_cmd_${now.toString(36)}_${Math.floor(random * Number.MAX_SAFE_INTEGER).toString(36).padStart(11, '0')}`;
}

function roomMediaErrorMessage(code?: string, fallback?: string) {
  const messages: Record<string, string> = {
    FEATURE_DISABLED: 'صور الغرف متوقفة مؤقتاً.',
    FORBIDDEN: 'لا تملك صلاحية إدارة صورة الغرفة.',
    REVISION_CONFLICT: 'تغيّرت الغرفة. أعد فتح الإعدادات ثم حاول مجدداً.',
    ROOM_CUSTOMIZATION_SUSPENDED: 'تخصيص هذه الغرفة موقوف من فريق السلامة.',
    ROOM_IMAGE_DIMENSIONS_INVALID: 'اختر صورة أفقية بين 800×450 و4096 بكسل.',
    ROOM_IMAGE_INVALID: 'الصورة غير صالحة أو يتجاوز حجمها 4 ميغابايت.',
    ROOM_IMAGE_NOT_FOUND: 'لم نعثر على الصورة المرفوعة.',
  };
  return (code && messages[code]) || fallback || 'تعذر تنفيذ أمر صورة الغرفة.';
}

async function readResponse(response: Response): Promise<RoomMediaCommandResponse> {
  try {
    return await response.json() as RoomMediaCommandResponse;
  } catch {
    return {};
  }
}

async function getDefaultFirebaseIdToken() {
  const { getCurrentFirebaseIdToken } = await import('../auth/getCurrentFirebaseIdToken');
  return getCurrentFirebaseIdToken();
}
