/** مفاتيح الميزات: تُفعَّل مع اكتمال كل ميزة وتحقق اختبارها، لا قبل ذلك. */
export const FEATURES = {
  /** الحسابات والأهداف وبدء المسارات (المرحلة التالية) */
  accounts: true,
} as const;

export const SITE = {
  name: 'يَقَظَة',
  nameSearch: 'يقظة',
  tagline: 'من الوعي إلى العمل',
  description:
    'منصة عربية تساعدك على إصلاح نفسك وحياتك: اختر ما تريد أن تعمل عليه، واتبع مسارات عملية ومواد موثوقة بمصادرها.',
  locale: 'ar',
} as const;

export const PAGE_SIZE = 12;
