import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getAllKeys: async () => [...storage.keys()],
    getItem: async (key: string) => storage.get(key) ?? null,
    multiRemove: async (keys: string[]) => {
      keys.forEach((key) => storage.delete(key));
    },
    removeItem: async (key: string) => {
      storage.delete(key);
    },
    setItem: async (key: string, value: string) => {
      storage.set(key, value);
    },
  },
}));

import {
  clearDirectChatPrivateData,
  draftKey,
  writeDirectChatDraft,
} from '../directChatDrafts';

describe('directChatDrafts private-data clearing', () => {
  beforeEach(() => {
    storage.clear();
  });

  it('wipes only the signed-out account draft prefix', async () => {
    await writeDirectChatDraft('user-a', 'conv-1', 'hello a');
    await writeDirectChatDraft('user-a', 'conv-2', 'hello a2');
    await writeDirectChatDraft('user-b', 'conv-1', 'hello b');
    expect(storage.has(draftKey('user-a', 'conv-1'))).toBe(true);
    expect(await clearDirectChatPrivateData('user-a')).toBe(2);
    expect(storage.has(draftKey('user-a', 'conv-1'))).toBe(false);
    expect(storage.has(draftKey('user-a', 'conv-2'))).toBe(false);
    expect(storage.get(draftKey('user-b', 'conv-1'))).toBe('hello b');
  });
});
