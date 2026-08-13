export type AdminRouteKey = 'overview' | 'users' | 'rooms' | 'reports' | 'store' | 'status' | 'cosmetics' | 'incentives' | 'representatives' | 'notifications' | 'audit' | 'settings';

export type DashboardRoute = {
  detail: string;
  key: AdminRouteKey;
  label: string;
  navigation: 'primary' | 'footer';
  path: string;
  subtitle: string;
  title: string;
};

export const adminRoutes: readonly DashboardRoute[] = [
  {
    detail: 'مراقبة VIP وSVIP والأرستقراطية والتدقيق والتفعيل الآمن.',
    key: 'status',
    label: 'الحالة والرتب',
    navigation: 'primary',
    path: '/status',
    subtitle: 'VIP وSVIP والأرستقراطية',
    title: 'مركز عمليات الحالة',
  },
  {
    detail: 'لا توجد ملخصات تشغيلية محمّلة.',
    key: 'overview',
    label: 'نظرة عامة',
    navigation: 'primary',
    path: '/',
    subtitle: 'نظرة عامة',
    title: 'لوحة الإدارة',
  },
  {
    detail: 'لا توجد سجلات مستخدمين محمّلة.',
    key: 'users',
    label: 'المستخدمون',
    navigation: 'primary',
    path: '/users',
    subtitle: 'إدارة المجتمع',
    title: 'المستخدمون',
  },
  {
    detail: 'لا توجد سجلات غرف محمّلة.',
    key: 'rooms',
    label: 'الغرف',
    navigation: 'primary',
    path: '/rooms',
    subtitle: 'المجتمع المباشر',
    title: 'الغرف',
  },
  {
    detail: 'لا توجد بلاغات محمّلة.',
    key: 'reports',
    label: 'البلاغات',
    navigation: 'primary',
    path: '/reports',
    subtitle: 'الثقة والأمان',
    title: 'البلاغات',
  },
  {
    detail: 'لا توجد عناصر متجر محمّلة.',
    key: 'store',
    label: 'المتجر',
    navigation: 'primary',
    path: '/store',
    subtitle: 'الاقتصاد والكتالوج',
    title: 'إدارة المتجر',
  },
  {
    detail: 'إصدارات ثابتة، فحص موثوق، موافقات، نشر، ورجوع آمن.',
    key: 'cosmetics',
    label: 'أصول التجميل',
    navigation: 'primary',
    path: '/cosmetics',
    subtitle: 'سلطة أصول الموجة الأولى',
    title: 'سجل أصول التجميل',
  },
  {
    detail: 'لا توجد عمليات وكلاء محمّلة.',
    key: 'representatives',
    label: 'عمليات الوكلاء',
    navigation: 'primary',
    path: '/representatives',
    subtitle: 'التحويلات والحدود والاسترجاع',
    title: 'عمليات الوكلاء',
  },
  {
    detail: 'اكتب العنوان والنص، اختر الجمهور، وعاين الإشعار على الهاتف قبل الإرسال.',
    key: 'notifications',
    label: 'الإشعارات',
    navigation: 'primary',
    path: '/notifications',
    subtitle: 'إرسال فوري للجمهور',
    title: 'إرسال إشعار فوري',
  },
  {
    detail: 'لا توجد أحداث تدقيق محمّلة.',
    key: 'audit',
    label: 'سجل التدقيق',
    navigation: 'primary',
    path: '/audit',
    subtitle: 'التدقيق والأمان',
    title: 'سجل التدقيق',
  },
  {
    detail: 'إعدادات الإدارة والتفضيلات المحلية.',
    key: 'settings',
    label: 'الإعدادات',
    navigation: 'footer',
    path: '/settings',
    subtitle: 'التفضيلات والأمان',
    title: 'الإعدادات',
  },
  {
    detail: 'إعداد أهداف ومكافآت الغرف الأسبوعية.',
    key: 'incentives',
    label: 'حوافز الغرف',
    navigation: 'primary',
    path: '/incentives',
    subtitle: 'الأهداف والمكافآت الأسبوعية',
    title: 'حوافز الغرف',
  },
] as const;

export const primaryAdminRoutes = adminRoutes.filter((route) => route.navigation === 'primary');

const overviewRoute = adminRoutes.find((route) => route.key === 'overview') as DashboardRoute;

export function getAdminRouteByKey(key: AdminRouteKey): DashboardRoute {
  return adminRoutes.find((route) => route.key === key) ?? overviewRoute;
}

export function getAdminRouteFromPath(pathname: string): DashboardRoute {
  const normalizedPath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return adminRoutes.find((route) => route.path === normalizedPath) ?? overviewRoute;
}
