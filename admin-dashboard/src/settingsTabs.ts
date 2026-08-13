export type SettingsTab = 'account' | 'admins' | 'platform' | 'economy';

export const SETTINGS_TAB_KEYS: readonly SettingsTab[] = ['account', 'admins', 'platform', 'economy'];

export const settingsTabLabels: Record<SettingsTab, string> = {
  account: 'الحساب والعرض',
  admins: 'المسؤولون',
  platform: 'مفاتيح المنصة',
  economy: 'الاقتصاد والرسائل',
};

export const settingsTabDescriptions: Record<SettingsTab, string> = {
  account: 'هوية الجلسة، تفضيلات العرض، التنبيهات، وحدود الحماية.',
  admins: 'إدارة الأدوار، النطاقات الإقليمية، وسجل الحوكمة.',
  platform: 'مفاتيح المنصة المعتمدة وعوارض التجميل الطارئة.',
  economy: 'عمولة الهدايا، حالة الرسائل المباشرة، وسياسة الاحتفاظ.',
};

export function parseSettingsTab(value: string): SettingsTab {
  return (SETTINGS_TAB_KEYS as readonly string[]).includes(value) ? (value as SettingsTab) : 'account';
}
