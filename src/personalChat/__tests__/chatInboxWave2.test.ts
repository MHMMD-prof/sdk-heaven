import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { FriendConnectionSummary } from '../../social/types';
import { directChatCopy } from '../directChatCopy';
import { buildComposeSections } from '../ui/buildComposeSections';
import { resolvePersonalChatPresentation } from '../ui/usePersonalChatPresentation';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Personal Chats frontend rebuild Wave 2', () => {
  it('keeps the Modern Royal inbox behind the fail-closed selector', () => {
    expect(resolvePersonalChatPresentation(undefined)).toBe('legacy');
    expect(resolvePersonalChatPresentation(true, { percentage: 100, salt: '', schemaVersion: 1, stage: 'global' })).toBe('modern-royal');
    const source = readSource('src/screens/ChatsScreen.tsx');
    expect(source).toContain("presentation === 'modern-royal'");
    expect(source).toContain('<ChatsScreenModernRoyal {...props} />');
    expect(source).toContain('<LegacyChatsScreen {...props} />');
  });

  it('keeps friends out of the inbox and in the new-chat sheet', () => {
    const inboxSource = readSource('src/screens/ChatsScreenModernRoyal.tsx');
    const composeSource = readSource('src/personalChat/DirectChatComposeSheetModernRoyal.tsx');
    expect(inboxSource).not.toContain('requestFriendsOverview');
    expect(inboxSource).not.toContain('startableFriends');
    expect(composeSource).toContain('requestFriendsOverview');
    expect(composeSource).toContain('buildComposeSections');
  });

  it('removes the legacy scenic assets from the replacement render tree', () => {
    const source = readSource('src/screens/ChatsScreenModernRoyal.tsx');
    expect(source).not.toMatch(/velvet|leather|royalCrestArtwork|ImageBackground/);
    expect(source).toContain('ChatRoyalBackdrop');
    expect(source).toContain('chatColors');
  });

  it('groups recent friends once and leaves remaining friends in the main section', () => {
    const sections = buildComposeSections({
      friends: [friend('sara', 'Sara'), friend('omar', 'Omar'), friend('noor', 'Noor')],
      friendsTitle: 'Friends',
      query: '',
      recentPeerUids: ['noor', 'sara'],
      recentTitle: 'Recent',
    });
    expect(sections.map((section) => section.key)).toEqual(['recent', 'friends']);
    expect(sections[0]?.data.map((row) => row.profile.uid)).toEqual(['noor', 'sara']);
    expect(sections[1]?.data.map((row) => row.profile.uid)).toEqual(['omar']);
  });

  it('searches people without duplicating recent sections', () => {
    const sections = buildComposeSections({
      friends: [friend('sara', 'Sára'), friend('omar', 'Omar')],
      friendsTitle: 'Friends',
      query: 'SÁRA',
      recentPeerUids: ['sara'],
      recentTitle: 'Recent',
    });
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ key: 'friends', title: 'Friends' });
    expect(sections[0]?.data[0]?.profile.uid).toBe('sara');
  });

  it('provides Arabic and English labels for the new inbox hierarchy', () => {
    const ar = directChatCopy('ar');
    const en = directChatCopy('en');
    expect(ar).toMatchObject({ all: 'الكل', draft: 'مسودة', reviewRequests: 'مراجعة الطلبات', unread: 'غير المقروءة' });
    expect(en).toMatchObject({ all: 'All', draft: 'Draft', reviewRequests: 'Review requests', unread: 'Unread' });
  });
});

function friend(uid: string, displayName: string) {
  return { profile: { displayName, uid } } as FriendConnectionSummary;
}
