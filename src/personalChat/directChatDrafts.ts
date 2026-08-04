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

export function draftKey(uid: string, conversationId: string) {
  return `${DRAFT_PREFIX}/${encodeURIComponent(uid)}/${encodeURIComponent(conversationId)}`;
}

function validScope(uid: string, conversationId: string) {
  return Boolean(uid && uid.length <= 128 && conversationId && conversationId.length <= 160);
}
