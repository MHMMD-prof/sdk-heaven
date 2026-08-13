export type IncentivesTab = 'rocket' | 'room-target' | 'daily-login' | 'ops-events' | 'payroll' | 'integrity';

export const INCENTIVES_TAB_KEYS: readonly IncentivesTab[] = [
  'rocket',
  'room-target',
  'daily-login',
  'ops-events',
  'payroll',
  'integrity',
];

export const incentivesTabLabels: Record<IncentivesTab, string> = {
  rocket: 'صاروخ الغرف',
  'room-target': 'هدف الغرفة',
  'daily-login': 'دخول يومي',
  'ops-events': 'فعاليات ومهام',
  payroll: 'رواتب وحضور',
  integrity: 'سلامة الحوافز',
};

export const incentivesTabDescriptions: Record<IncentivesTab, string> = {
  rocket: 'قالب أسبوعي عالمي ثابت لكل الغرف. أي نشر جديد يبدأ من الأسبوع التالي.',
  'room-target': 'أهداف المالك الأسبوعية والعوائد المختارة مع حدود المخاطر.',
  'daily-login': 'دورة ثابتة من 7 أيام مع مفاتيح سلامة فورية ونشر مجدول.',
  'ops-events': 'نشر فعالية تشغيلية (عنوان ونافذة وثيم) تظهر في شريط الرئيسية مع المهام اليومية.',
  payroll: 'كشوف الرواتب الأسبوعية وتقارير الحضور الاحتياطية.',
  integrity: 'مطابقة الدفاتر، احتجاز المخاطر، ومراجعة التسويات المعلّقة.',
};

export function parseIncentivesTab(value: string): IncentivesTab {
  return (INCENTIVES_TAB_KEYS as readonly string[]).includes(value) ? (value as IncentivesTab) : 'rocket';
}
