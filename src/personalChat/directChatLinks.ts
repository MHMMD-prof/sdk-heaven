const DIRECT_CHAT_UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function parseDirectChatLink(url: string | null) {
  if (!url) return '';
  const match = url.match(/(?:^|\/)chat\/([^/?#]+)(?:[/?#]|$)/i);
  if (!match) return '';
  try {
    const targetUid = decodeURIComponent(match[1]);
    return DIRECT_CHAT_UID_PATTERN.test(targetUid) ? targetUid : '';
  } catch {
    return '';
  }
}
