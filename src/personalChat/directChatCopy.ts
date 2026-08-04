export type DirectChatLanguage = 'ar' | 'en';

const copy = {
  ar: {
    accept: 'قبول', archive: 'أرشفة', block: 'حظر', cancel: 'إلغاء', chats: 'المحادثات',
    chatsEyebrow: 'تواصل خاص وآمن', conversations: 'المحادثات', emptyBody: 'افتح ملف مستخدم أو قائمة المشاركين في الغرفة لبدء محادثة.',
    emptyTitle: 'ابدأ أول محادثة', errorTitle: 'تعذر تحميل المحادثات', loadingOlder: 'تحميل رسائل أقدم',
    mute: 'كتم', noMessages: 'لا رسائل جديدة', noResults: 'لا توجد نتائج', offline: 'الاتصال غير مستقر — اضغط لإعادة المحاولة',
    requestNew: 'طلب جديد: ', requestSent: 'طلبك: ', requests: 'طلبات المحادثة', retry: 'إعادة المحاولة',
    safePrivate: 'المحادثة مرئية للمشاركين فقط، لكنها ليست مشفرة من طرف إلى طرف.', searchA11y: 'البحث في المحادثات المحملة',
    searchPlaceholder: 'ابحث بالاسم أو المعرّف', searchTryAgain: 'جرّب اسماً أو معرّفاً آخر.', startChat: 'ابدأ المحادثة',
    unavailableBody: 'ستظهر المحادثات هنا عند تفعيلها.', unavailableTitle: 'المحادثات غير مفعلة بعد', unmute: 'إلغاء الكتم', user: 'مستخدم',
  },
  en: {
    accept: 'Accept', archive: 'Archive', block: 'Block', cancel: 'Cancel', chats: 'Chats',
    chatsEyebrow: 'Private, safer conversations', conversations: 'Conversations', emptyBody: 'Open a profile or a room participant menu to start a chat.',
    emptyTitle: 'Start your first chat', errorTitle: 'Could not load chats', loadingOlder: 'Load older messages',
    mute: 'Mute', noMessages: 'No new messages', noResults: 'No results', offline: 'Connection is unstable — tap to retry',
    requestNew: 'New request: ', requestSent: 'Your request: ', requests: 'Chat requests', retry: 'Try again',
    safePrivate: 'This chat is visible only to its participants, but it is not end-to-end encrypted.', searchA11y: 'Search loaded chats',
    searchPlaceholder: 'Search by name or ID', searchTryAgain: 'Try another name or ID.', startChat: 'Start the conversation',
    unavailableBody: 'Chats will appear here when this feature is enabled.', unavailableTitle: 'Chats are not enabled yet', unmute: 'Unmute', user: 'User',
  },
} as const;

export function directChatCopy(language: DirectChatLanguage) {
  return copy[language];
}
