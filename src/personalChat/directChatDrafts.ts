import AsyncStorage from '@react-native-async-storage/async-storage';

const DRAFT_PREFIX = '@sdk-heaven/direct-chat-draft/v1';
const MAX_DRAFT_LENGTH = 2_000;

export async function readDirectChatDraft(uid: string, conversationId: string) {
  if (!validScope(uid, conversationId)) return '';
  const value = await AsyncStorage.getItem(draftKey(uid, conversationId));
  return typeof value === 'string' ? value.slice(0, MAX_DRAFT_LENGTH) : '';
}

export async function writeDirectChatDraft(uid: string, conversationId: string, text: string) {
  if (!validScope(uid, conversationId)) return;
  const normalized = text.slice(0, MAX_DRAFT_LENGTH);
  if (!normalized) {
    await AsyncStorage.removeItem(draftKey(uid, conversationId));
    return;
  }
  await AsyncStorage.setItem(draftKey(uid, conversationId), normalized);
}

export async function clearDirectChatDraft(uid: string, conversationId: string) {
  if (validScope(uid, conversationId)) await AsyncStorage.removeItem(draftKey(uid, conversationId));
}

/** Wipe all private draft keys for one account. Safe to call on logout. */
export async function clearDirectChatPrivateData(uid: string) {
  if (!uid || uid.length > 128) return 0;
  const prefix = `${DRAFT_PREFIX}/${encodeURIComponent(uid)}/`;
  const keys = await AsyncStorage.getAllKeys();
  const owned = keys.filter((key) => key.startsWith(prefix));
  if (owned.length > 0) await AsyncStorage.multiRemove(owned);
  return owned.length;
}

export function draftKey(uid: string, conversationId: string) {
  return `${DRAFT_PREFIX}/${encodeURIComponent(uid)}/${encodeURIComponent(conversationId)}`;
}

function validScope(uid: string, conversationId: string) {
  return Boolean(uid && uid.length <= 128 && conversationId && conversationId.length <= 160);
}
