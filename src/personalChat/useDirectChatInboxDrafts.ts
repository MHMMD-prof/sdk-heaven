import { useEffect, useMemo, useState } from 'react';

import { readDirectChatDraft } from './directChatDrafts';

export function useDirectChatInboxDrafts(uid: string | undefined, conversationIds: string[]) {
  const stableIds = useMemo(
    () => [...new Set(conversationIds.filter(Boolean))].sort().slice(0, 150),
    [conversationIds.join('\u0000')],
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!uid || stableIds.length === 0) {
      setDrafts({});
      return;
    }
    let active = true;
    void Promise.all(stableIds.map(async (conversationId) => [conversationId, await readDirectChatDraft(uid, conversationId)] as const))
      .then((entries) => {
        if (active) setDrafts(Object.fromEntries(entries.filter(([, value]) => Boolean(value))));
      })
      .catch(() => {
        if (active) setDrafts({});
      });
    return () => { active = false; };
  }, [stableIds.join('\u0000'), uid]);

  return drafts;
}
