export type ChatComposerMode = 'accepted' | 'incoming-request' | 'loading' | 'outgoing-request' | 'request';

export function buildComposerState({ accepted, draft, requestIncoming, requestOutgoing, statusReady }: {
  accepted: boolean;
  draft: string;
  requestIncoming: boolean;
  requestOutgoing: boolean;
  statusReady: boolean;
}) {
  const mode: ChatComposerMode = !statusReady
    ? 'loading'
    : requestIncoming
      ? 'incoming-request'
      : requestOutgoing
        ? 'outgoing-request'
        : accepted ? 'accepted' : 'request';
  const canEditText = mode === 'accepted' || mode === 'request';
  return {
    canEditText,
    canOpenAttachments: mode === 'accepted',
    canSend: canEditText && draft.trim().length > 0 && draft.length <= 2_000,
    mode,
  };
}
