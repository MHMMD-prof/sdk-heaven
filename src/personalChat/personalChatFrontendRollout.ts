export type PersonalChatFrontendRolloutStage = 'global' | 'internal' | 'off' | 'percentage';

export type PersonalChatFrontendRollout = {
  percentage: number;
  salt: string;
  schemaVersion: 1;
  stage: PersonalChatFrontendRolloutStage;
};

export const disabledPersonalChatFrontendRollout: PersonalChatFrontendRollout = Object.freeze({
  percentage: 0,
  salt: '',
  schemaVersion: 1,
  stage: 'off',
});

export function mapPersonalChatFrontendRollout(data: unknown): PersonalChatFrontendRollout {
  if (!data || typeof data !== 'object') return disabledPersonalChatFrontendRollout;
  const candidate = data as Record<string, unknown>;
  const stage = isStage(candidate.stage) ? candidate.stage : 'off';
  const percentage = Number.isInteger(candidate.percentage) && Number(candidate.percentage) >= 0 && Number(candidate.percentage) <= 100
    ? Number(candidate.percentage)
    : 0;
  const salt = typeof candidate.salt === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(candidate.salt)
    ? candidate.salt
    : '';
  if (candidate.schemaVersion !== 1) return disabledPersonalChatFrontendRollout;
  return { percentage, salt, schemaVersion: 1, stage };
}

export function isPersonalChatFrontendEnabled({
  internalPreview,
  masterEnabled,
  rollout,
  uid,
}: {
  internalPreview: boolean;
  masterEnabled: unknown;
  rollout: PersonalChatFrontendRollout;
  uid?: string;
}) {
  if (masterEnabled !== true) return false;
  if (rollout.stage === 'global') return true;
  if (rollout.stage === 'internal') return internalPreview === true;
  if (rollout.stage !== 'percentage' || !uid || !rollout.salt || rollout.percentage < 1) return false;
  return stableRolloutBucket(uid, rollout.salt) < rollout.percentage;
}

export function stableRolloutBucket(uid: string, salt: string) {
  let hash = 0x811c9dc5;
  for (const character of `${salt}:${uid}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 100;
}

export async function subscribePersonalChatFrontendRollout(listener: (rollout: PersonalChatFrontendRollout) => void) {
  const [{ firebaseDb }, { doc, onSnapshot }] = await Promise.all([
    import('../auth/firebase'),
    import('firebase/firestore'),
  ]);
  return onSnapshot(
    doc(firebaseDb, 'appConfig', 'personalChatsFrontendRollout'),
    (snapshot) => listener(mapPersonalChatFrontendRollout(snapshot.exists() ? snapshot.data() : undefined)),
    () => listener(disabledPersonalChatFrontendRollout),
  );
}

function isStage(value: unknown): value is PersonalChatFrontendRolloutStage {
  return value === 'off' || value === 'internal' || value === 'percentage' || value === 'global';
}
