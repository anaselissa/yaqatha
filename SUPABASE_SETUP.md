# دليل إطلاق يَقَظَة: Supabase + Google + Cloudflare

> قاعدة ثابتة: **لا ترسل لي أي مفتاح سري** (service_role أو sb_secret_… أو Client Secret أو كلمة مرور قاعدة البيانات). المشروع كله يعمل بالمفتاح العام فقط. الأسرار تُدخَل في لوحات Supabase وGoogle وCloudflare ولا تغادرها.

## 0. من يفعل ماذا

| ما نُفِّذ وجُرِّب (جاهز) | ما يتطلب منك لوحة خارجية |
|---|---|
| المخطط والصلاحيات: `yaqatha-db/supabase/migrations` (7 هجرات) و`seed.sql` | إنشاء مشروع Supabase |
| `verify.sql` يفحص الأمان بعد التطبيق، و`bootstrap-manager.sql` لأول مدير | تطبيق الهجرات في SQL Editor |
| كود الدخول (PKCE) والجلسة والنية المعلقة وحذف الحساب، مختبرة على محاكٍ لـGoTrue | **إنشاء OAuth Client في Google Cloud** (يتطلب حسابك) |
| `scripts/smoke-remote.mjs` يفحص المشروع الحقيقي بالمفتاح العام | تفعيل Google في Supabase ووضع الـSecret هناك |
| بناء Cloudflare مختبر (workerd) وWrangler dry-run ناجح | ربط المستودع بـCloudflare وإدخال المتغيرات والنطاق |

**ما أحتاجه منك لاحقًا فقط:** عنوان المشروع (`https://xxxx.supabase.co`) والمفتاح العام وعنوان الموقع النهائي. هذه قيم عامة بطبيعتها.

---

## 1. إنشاء مشروع Supabase

1. supabase.com ← New project. الاسم `yaqatha`. اختر المنطقة الأقرب لمعظم زوارك (غالبًا فرانكفورت). *السبب: زمن الاستجابة.*
2. كلمة مرور قاعدة البيانات: ولّدها في مدير كلمات المرور واحفظها هناك. **لا يحتاجها الموقع ولا أحد غيرك.**
3. الخطة المجانية كافية للبداية. *تنبيه [تحقق]:* المشاريع المجانية قد تُوقَف بعد فترة بلا نشاط؛ أضفت `.github/workflows/keepalive.yml` لطلب أسبوعي يمنع ذلك.
4. من Project Settings ← API انسخ: **Project URL** و**المفتاح العام** (يسمى anon أو publishable `sb_publishable_…`). لا تنسخ service_role/secret أبدًا.

## 2. تطبيق المخطط

في Supabase ← **SQL Editor**، شغّل الملفات **بالترتيب** (كل ملف في استعلام واحد، وانتظر النجاح قبل التالي):

```
yaqatha-db/supabase/migrations/20261109000001_types_and_helpers.sql
… 0002_content.sql   … 0003_user_data.sql   … 0004_functions.sql
… 0005_rls_and_grants.sql   … 0006_account_deletion.sql   … 0007_reorder_steps.sql
yaqatha-db/supabase/seed.sql
```
*بديل:* Supabase CLI (`supabase link` ثم `supabase db push`) يطبّق مجلد `migrations`؛ ثم شغّل `seed.sql` في SQL Editor.

**لا تشغّل أبدًا:** `tests/` ولا `dev/` ولا `dev-seed.sql` (بيانات تجريبية للتطوير فقط).

ثم شغّل `yaqatha-db/supabase/verify.sql`. **المطلوب:** كل الصفوف `ok = true` ما عدا «يوجد مدير» (تُحل في الخطوة 6). أي `false` آخر = توقف ولا تطلق.

## 3. إعداد Google OAuth

**أ. Google Cloud Console** (console.cloud.google.com)
1. أنشئ مشروعًا جديدًا (مثلًا `yaqatha`).
2. APIs & Services ← **OAuth consent screen**: النوع External. اسم التطبيق «يقظة»، بريد الدعم بريدك، Authorized domains: نطاق موقعك و`supabase.co`. أضف رابط الخصوصية `https://موقعك/privacy` والشروط `/terms`.
3. Scopes: `openid` و`email` و`profile` فقط (أساسية، لا تتطلب مراجعة Google).
4. **انشر التطبيق** (Publishing status ← In production). *السبب: وهو في حالة Testing لا يدخل إلا المستخدمون التجريبيون المسمّون.*
5. Credentials ← Create credentials ← **OAuth client ID** ← Web application.
   - **Authorized redirect URIs:** `https://<project-ref>.supabase.co/auth/v1/callback` (انسخه من صفحة Google Provider في Supabase بالضبط).
   - JavaScript origins: يمكن تركها فارغة (التدفق كله على الخادم).
6. انسخ **Client ID** و**Client Secret**.

**ب. Supabase ← Authentication**
1. Providers ← **Google**: فعّله والصق Client ID وSecret ثم Save. *السر يبقى هنا فقط.*
2. **URL Configuration:**
   - Site URL: `https://موقعك` (نفس قيمة `SITE_URL` حرفيًا، بلا شرطة أخيرة).
   - Redirect URLs: أضف `https://موقعك/auth/callback` و`http://localhost:4321/auth/callback` (للتطوير). *لا تستخدم wildcard.*
3. Providers ← **Email**: عطّله (المنصة تعتمد Google فقط). تأكد أن Anonymous sign-ins معطّل.
4. اترك «Allow new signups» مفعّلًا (لازم لأول دخول بـGoogle).

## 4. متغيرات البيئة

| المتغير | القيمة | أين |
|---|---|---|
| `PUBLIC_SUPABASE_URL` | Project URL | Cloudflare (Build) + `.env` محليًا |
| `PUBLIC_SUPABASE_ANON_KEY` | المفتاح العام فقط | نفسه |
| `SITE_URL` | `https://موقعك` | نفسه (البناء يفشل عمدًا بدونه في الإنتاج) |
| `ASTRO_ADAPTER` | `cloudflare` | Cloudflare (Build) |

متغيرات `PUBLIC_*` تُدمج وقت البناء: **تغييرها يتطلب إعادة نشر**. المفتاح العام بصيغتيه (JWT القديم أو `sb_publishable_`) مدعوم في الكود؛ الصيغة الجديدة لم تُجرَّب على مشروع حقيقي [تحقق].

## 5. النشر على Cloudflare

المحوّل الحالي يستهدف **Workers** (مع أصول ثابتة) لا Pages، وقد جرّبت `wrangler deploy --dry-run` بنجاح: ارتباط واحد فقط (ASSETS)، وحجم 279KB مضغوطًا.

1. ضع المشروعين في مستودع Git واحد، أو `yaqatha-web` وحده (لا يحتاج `dev/` إلا للتطوير).
2. Cloudflare ← Workers & Pages ← Create ← استيراد المستودع (Workers Builds) [تحقق من أسماء الواجهة].
3. Root directory: `yaqatha-web`. Build command: `npm ci && npm run build`. Deploy command: `npx wrangler deploy`.
4. أدخل المتغيرات في القسم 4 كـ**Build variables**، وNode ≥ 22.
5. أضف نطاقك: Settings ← Domains & Routes. ثم تأكد أن `SITE_URL` وSite URL في Supabase يطابقان النطاق النهائي.

## 6. أول مدير

1. افتح موقعك وسجّل الدخول بحسابك مرة واحدة (`/login`).
2. في SQL Editor: افتح `yaqatha-db/supabase/bootstrap-manager.sql`، غيّر البريد إلى بريدك، وشغّله. *السبب: لا أحد يملك صلاحية منح أول مدير، فيُمنح يدويًا عبر لوحتك المحمية.*
3. أعد تشغيل `verify.sql`: الآن «يوجد مدير» = true.

## 7. التحقق (بالترتيب)

```bash
# أ) فحص الأمان العام بالمفتاح العام
PUBLIC_SUPABASE_URL=... PUBLIC_SUPABASE_ANON_KEY=... SITE_URL=https://موقعك npm run smoke:remote
```
يجب أن ينجح كله. **سيفشل عمدًا** إن وجد بيانات «[تجريبي]» ظاهرة، وسيحذّرك إن كان مزوّد البريد مفعّلًا أو لم يحوّل `/authorize` إلى Google.

ب) **فحص يدوي** (10 دقائق):
1. افتح `/journey` وأنت غير مسجَّل ← يحوّلك إلى `/login`.
2. سجّل الدخول بـGoogle ← تعود إلى `/journey`، ثم حدّث الصفحة: الجلسة باقية.
3. صفحة مسار منشور ← «ابدأ هذا المسار» وأنت خارج الجلسة ← دخول ← يبدأ المسار تلقائيًا.
4. أكمل خطوة، أغلق المتصفح وأعد فتحه: التقدم محفوظ.
5. أنشئ هدفًا واربطه بالمسار، ثم أرشفه واستعده.
6. احفظ مادة ثم أخفِها من SQL (`update materials set status='hidden' …`) ← تظهر «غير متاحة حاليًا».
7. بحساب Google ثانٍ: افتح رابط هدف الحساب الأول ← 404.
8. Settings ← حذف الحساب ← يمحو كل شيء، ودخول جديد يبدأ نظيفًا.
9. من هاتف داخل تطبيق مراسلة (واتساب/تيليجرام): افتح رابط الدخول ← يجب أن تظهر رسالة «افتح في متصفحك» [تحقق].
10. `https://موقعك/sitemap.xml` و`/robots.txt` يعملان، وخلوّ sitemap من أي مسودة.

## 8. بعد الإطلاق

- **نسخ احتياطي:** راجع ما تتيحه خطتك [تحقق]. الخطة المجانية قد لا تتيح استرجاعًا لنقطة زمنية؛ صدّر القاعدة دوريًا (`pg_dump` أو Dashboard).
- **مفاتيح:** إن تسرّب أي سر (حتى Client Secret) فبدّله فورًا من لوحته.
- **Cache Rule على Cloudflare:** الصفحات العامة ترسل `s-maxage=60`؛ تأكد من سريان الإخفاء خلال دقيقة تقريبًا بعد تغيير مادة [تحقق].

## 9. أعراض شائعة

| العَرَض | السبب والحل |
|---|---|
| `redirect_uri_mismatch` من Google | عنوان Redirect URI في Google لا يطابق `https://<ref>.supabase.co/auth/v1/callback` حرفيًا |
| بعد الدخول تعود إلى `/login?error=failed` | Redirect URLs في Supabase لا تحوي `https://موقعك/auth/callback`، أو `SITE_URL` مختلف عن النطاق الفعلي |
| `Access blocked: app not verified` | تطبيق Google ما زال Testing؛ انشره أو أضف نفسك مستخدمًا تجريبيًا |
| يدخل ثم يُطرد فورًا | كوكيز `Secure` على نطاق http، أو `SITE_URL` بـ http بينما الموقع https |
| `No API key found` | `PUBLIC_SUPABASE_ANON_KEY` غير مضبوط وقت **البناء** (أعد النشر بعد ضبطه) |
| الدخول لا يعمل داخل واتساب/إنستغرام | Google ترفض OAuth في المتصفح المدمج؛ الصفحة تنبّه المستخدم لفتح المتصفح |

## 10. ما لم أستطع التحقق منه

لا يتوفر لي مشروع Supabase ولا حساب Google ولا Cloudflare، لذا **لم يُختبر على الحقيقي:** عقد GoTrue الفعلي (جرّبته على محاكٍ بنيته من مواصفاته)، وتحويل Google، وصيغة المفتاح `sb_publishable_`، وسلوك التخزين المؤقت على Cloudflare، وتوفر النسخ الاحتياطي. كل بند منها له فحص في الخطوة 7.
