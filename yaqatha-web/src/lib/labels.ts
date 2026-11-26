export const MATERIAL_TYPE: Record<string, string> = {
  article: 'مقال',
  video: 'فيديو',
  external_link: 'مصدر خارجي',
  guidance: 'توجيه عملي',
  exercise: 'تمرين',
  reflection: 'سؤال للتفكير',
};
export const STEP_TYPE: Record<string, string> = {
  watch: 'مشاهدة',
  read: 'قراءة',
  guidance: 'توجيه عملي',
  exercise: 'تمرين',
  reflection: 'سؤال للتفكير',
  review: 'مراجعة التجربة',
  exam: 'الامتحان',
};
export const NATURE: Record<string, string> = {
  original_source: 'مصدر أصلي',
  yaqatha_summary: 'تلخيص أو توجيه من فريق يقظة',
};
export const CHANGE_TYPE: Record<string, string> = {
  quit_haram: 'ترك محرم',
  perform_duty: 'أداء واجب',
  acquire_good_deed: 'اكتساب سنة أو عمل صالح',
  increase_knowledge: 'زيادة علم ووعي',
};
/** نص مدة المسار: null تعني مسارًا مفتوحًا بلا مدة */
export function durationLabel(days: number | null | undefined): string {
  if (!days) return 'مفتوح بلا مدة';
  if (days === 1) return 'يوم واحد';
  if (days === 2) return 'يومان';
  if (days >= 3 && days <= 10) return `${days} أيام`;
  return `${days} يومًا`;
}
export function stepsLabel(n: number): string {
  if (n === 1) return 'خطوة واحدة';
  if (n === 2) return 'خطوتان';
  if (n >= 3 && n <= 10) return `${n} خطوات`;
  return `${n} خطوة`;
}
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('ar', { year: 'numeric', month: 'long', day: 'numeric', numberingSystem: 'latn' }).format(new Date(iso));
}

export const GOAL_STATUS: Record<string, string> = {
  not_started: 'لم يبدأ', in_progress: 'قيد العمل', paused: 'متوقف مؤقتًا', completed: 'مكتمل', archived: 'مؤرشف',
};
export const STEP_STATE: Record<string, string> = {
  not_started: 'لم تبدأ', in_progress: 'قيد التنفيذ', completed: 'مكتملة',
};
