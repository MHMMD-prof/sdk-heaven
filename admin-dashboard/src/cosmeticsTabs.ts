export type CosmeticsTab = 'registry' | 'upload' | 'custom';

export const COSMETICS_TAB_KEYS: readonly CosmeticsTab[] = ['registry', 'upload', 'custom'];

export const cosmeticsTabLabels: Record<CosmeticsTab, string> = {
  registry: 'السجل والمراجعة',
  upload: 'رفع أصل',
  custom: 'طلبات مخصصة',
};

export const cosmeticsTabDescriptions: Record<CosmeticsTab, string> = {
  registry: 'تصفح الأصول الثابتة، مراجعة الإصدارات، والموافقة أو النشر الآمن.',
  upload: 'رفع نسخة غير قابلة للاستبدال مع إيصال تحقق قبل أي نشر عام.',
  custom: 'مراجعة طلبات الأصول المخصصة المحجوزة للمالك وإدارة أهلية الرفع.',
};

export const cosmeticsCategoryLabels: Record<string, string> = {
  'avatar-frame': 'إطار الصورة',
  'profile-skin': 'خلفية الملف',
  'chat-bubble': 'فقاعة الدردشة',
  nameplate: 'لوحة الاسم',
  'cosmetic-badge': 'شارة تجميلية',
  'entry-effect': 'تأثير الدخول',
  'seat-effect': 'تأثير المقعد',
  'gift-effect': 'تأثير الهدية',
  'room-theme': 'سمة الغرفة',
  'room-reaction': 'تفاعل الغرفة',
  'couple-effect': 'تأثير الارتباط',
  'effect-audio': 'صوت التأثير',
};

export const cosmeticsFormatLabels: Record<string, string> = {
  png: 'PNG',
  jpeg: 'JPEG',
  'lottie-json': 'Lottie',
  mp4: 'MP4',
  'm4a-aac': 'صوت M4A',
};

export const cosmeticsModerationLabels: Record<string, string> = {
  pending: 'بانتظار المراجعة',
  approved: 'معتمد',
  rejected: 'مرفوض',
  suspended: 'موقوف',
};

export const cosmeticsPublicationLabels: Record<string, string> = {
  unpublished: 'غير منشور',
  published: 'منشور',
  disabled: 'معطّل',
};

export const cosmeticsSubmissionStatusLabels: Record<string, string> = {
  pending: 'بانتظار',
  processed: 'معالَج',
  approved: 'معتمد',
  rejected: 'مرفوض',
  suspended: 'موقوف',
};

export function parseCosmeticsTab(value: string): CosmeticsTab {
  return (COSMETICS_TAB_KEYS as readonly string[]).includes(value) ? (value as CosmeticsTab) : 'registry';
}

export function labelOf(map: Record<string, string>, value: string) {
  return map[value] || value;
}
