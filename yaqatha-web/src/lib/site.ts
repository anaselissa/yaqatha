// «واجهة الموقع» (الهجرة 18): نصوص يديرها الفريق من اللوحة. قبل الهجرة أو عند تعذّر الجلب: النصوص الافتراضية هنا.
import { one, rest, rpc } from './api';
import { CHEERS } from './cheers';

export interface Cheer { t: string; s: string }
let cheersCache: { at: number; list: Cheer[] } | null = null;

/** عبارات «أحسنت» المنشورة بالترتيب (ذاكرة قصيرة دقيقة واحدة لكل عامل) */
export async function getCheers(): Promise<Cheer[]> {
  if (cheersCache && Date.now() - cheersCache.at < 60_000) return cheersCache.list;
  try {
    const { rows } = await rest<{ text: string; source: string | null }>('cheers', { select: 'text,source', status: 'eq.published', order: 'position,created_at' });
    const list = rows.length ? rows.map((r) => ({ t: r.text, s: r.source ?? '' })) : CHEERS;
    cheersCache = { at: Date.now(), list };
    return list;
  } catch { return CHEERS; }
}
export const pickCheer = (list: Cheer[], n: number) => list[((n % list.length) + list.length) % list.length];

/** نصيحة اليوم: واحدة كل يوم بالترتيب (حسب تاريخ المستخدم المحلي). null إن لم توجد. */
export async function getTipOfDay(localDay: string): Promise<{ text: string; source: string | null } | null> {
  try {
    const { rows } = await rest<{ text: string; source: string | null }>('daily_tips', { select: 'text,source', status: 'eq.published', order: 'position,created_at', limit: 365 });
    if (!rows.length) return null;
    const day = Math.floor(Date.parse(`${localDay}T00:00:00Z`) / 86_400_000);
    return rows[((day % rows.length) + rows.length) % rows.length];
  } catch { return null; }
}

type Links = { whatsapp: string | null; instagram: string | null };
let linksCache: { at: number; v: Links } | null = null;
/** يُفرغ ذاكرة هذا العامل بعد التعديل من اللوحة (العمّال الآخرون يتحدّثون خلال دقيقة) */
export const clearSiteCache = () => { linksCache = null; cheersCache = null; };
/** روابط التواصل (تظهر في التذييل و«حسابي»). ذاكرة قصيرة دقيقة واحدة. */
export async function getPublicLinks(): Promise<Links> {
  if (linksCache && Date.now() - linksCache.at < 60_000) return linksCache.v;
  let v: Links = { whatsapp: null, instagram: null };
  try { v = await rpc<Links>('public_links', {}); } catch { /* قبل الهجرة 18 */ }
  linksCache = { at: Date.now(), v };
  return v;
}

export type PageSlug = 'about' | 'privacy' | 'terms';
export const PAGE_SLUGS: PageSlug[] = ['about', 'privacy', 'terms'];

export async function getSitePage(slug: PageSlug): Promise<{ title: string; body: string; updated_at: string | null; custom: boolean }> {
  const row = await one<{ title: string; body: string; updated_at: string }>('site_pages', { select: 'title,body,updated_at', slug: `eq.${slug}` }).catch(() => null);
  return row ? { ...row, custom: true } : { ...DEFAULT_PAGES[slug], updated_at: null, custom: false };
}

/** النصوص الافتراضية (هي نفسها التي كانت مكتوبة في الصفحات قبل الهجرة 18) */
export const DEFAULT_PAGES: Record<PageSlug, { title: string; body: string }> = {
  about: {
    title: 'عن يَقَظَة',
    body: `يَقَظَة منصة عربية تسعى إلى الإسهام في يقظة الأمة، بمساعدة الأفراد على إصلاح أنفسهم وحياتهم، وتقوية صلتهم بالله، واكتساب العلم والوعي، وتحويل المعاني الإيمانية إلى أعمال نافعة.

ليست يقظة مكتبة محاضرات فحسب. هي تجربة تبدأ من حاجتك أنت: تختار ما تريد أن تعمل عليه، فتجد مسارات عملية مرتّبة، ومواد تعينك، ثم تطبّق.

## ما نحرص عليه

- الانتقال من المعرفة إلى التطبيق: ترك الحرام، وأداء الواجبات، واكتساب السنن والأعمال الصالحة.
- التصفّح بلا حساب ولا عوائق.
- مسارات معدّة يدويًا بعناية، لا مولَّدة آليًا.
- لكل مادة مصدرها الأصلي، والتمييز بين المادة الأصلية وما أعدّه فريق يقظة.

## ما لا نفعله

- لا نقيس إيمانك ولا صلاحك.
- لا نحدد مقدار الأجر ولا قبول العمل.
- لا ننظّم تنافسًا على الطاعات، ولا نحوّل الدين إلى نقاط وأوسمة.
- لا نختلق نصوصًا دينية ولا أحكامًا، ولا ننسب أقوالًا إلى العلماء دون مصدر.

## حين نخطئ

إن ثبت خطأ في مادة أو مسار أخفيناه فورًا ثم راجعناه، ولا نتركه ظاهرًا. ومن يتابع مسارًا سُحب إصداره يُنبَّه إلى ذلك ولا يضيع تقدمه.`,
  },
  privacy: {
    title: 'الخصوصية',
    body: `نجمع أقل قدر ممكن من البيانات، ولا نجمع ما لا تحتاجه وظيفة الموقع. تصفّح الموقع لا يتطلب حسابًا.

## إن لم تسجّل الدخول

- لا نخزّن شيئًا عنك، ولا نستخدم أدوات تحليل أو تتبّع أو إعلانات.
- قد يسجّل مزوّد الاستضافة بيانات تقنية قياسية في سجلاته (مثل عنوان الشبكة ونوع المتصفح) لأغراض التشغيل والأمان.
- عبارات البحث تُرسل إلى قاعدة البيانات لإرجاع النتائج فقط، ولا نربطها بهويتك.

## إن سجّلت الدخول بحساب Google

- نستلم من Google اسمك وبريدك فقط، ونستخدمهما لتعريف حسابك. لا نستلم كلمة مرورك.
- نخزّن ما تحفظه أنت: أهدافك، والمسارات التي بدأتها وتقدمك فيها، والمواد التي حفظتها، والبلاغات التي أرسلتها.
- لا يظهر شيء من ذلك لمستخدم آخر ولا لفريق المحتوى. ولا نطلب منك كتابة تفاصيل الذنوب أو معلومات حساسة، فاكتفِ بوصف ما تريد العمل عليه.
- تستطيع حذف حسابك وكل بياناتك فورًا من «رحلتي ← الإعدادات». وقد تبقى نسخ احتياطية لدى مزوّد قاعدة البيانات فترة محدودة قبل أن تُمحى.

## إن طلبت متابعة من الفريق

نحفظ ما تكتبه في نموذج الطلب فقط: الاسم الذي تختاره، ووسيلة التواصل، والمجال، والوقت المناسب. لا يرى هذه البيانات إلا مدير الموقع والمتابِع الذي يُسند إليه طلبك، ولا تُسجَّل في سجل التغييرات. ويمكنك سحب طلبك فتُحذف بياناته فورًا، وتُحذف كذلك مع حذف حسابك. أما إن راسلتنا على واتساب مباشرة فالمحادثة تخضع لسياسة واتساب.

## ملفات تعريف الارتباط والتخزين

- بعد تسجيل الدخول نضع ملفات ضرورية فقط لإبقائك مسجّلًا ولإظهار رسائل التأكيد. لا نضع ملفات للتتبع أو الإعلان.
- إن كتبت هدفًا قبل الدخول فيُحفظ نصه مؤقتًا في متصفحك حتى تكمل الدخول، ويُمسح بإغلاق التبويب.

## جهات تعالج بياناتنا

Google (تسجيل الدخول)، وSupabase (قاعدة البيانات والمصادقة)، وCloudflare (الاستضافة). ولا نشارك بياناتك مع غيرها.

## الفيديو والمصادر الخارجية

لا يُحمَّل أي فيديو من موقع خارجي إلا حين تنقر تشغيله، وعندها يخضع لسياسة ذلك الموقع. والروابط الخارجية مسؤولية أصحابها.`,
  },
  terms: {
    title: 'الشروط',
    body: `- المحتوى توعوي وتعليمي عام، ولا يغني عن سؤال أهل العلم فيما يخصك من مسائل.
- نحرص على إسناد كل مادة إلى مصدرها، وقد نعدّل المحتوى أو نخفيه أو نسحبه عند ثبوت خطأ أو الحاجة إلى مراجعة.
- الحساب اختياري ويُستخدم لحفظ أهدافك وتقدمك. وأنت مسؤول عن حسابك في Google، وتستطيع حذف حسابك وبياناتك في أي وقت.
- الروابط الخارجية خارج سيطرتنا، ولا نتحمل مسؤولية محتواها.
- يُقدَّم الموقع كما هو، دون ضمان بخلوّه من الأخطاء أو انقطاع الخدمة.
- لا يجوز استخدام الموقع لأي غرض يخالف النظام أو يضر بغيرك أو يعطّل الخدمة.`,
  },
};
