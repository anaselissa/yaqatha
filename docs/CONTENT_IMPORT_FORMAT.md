# يَقَظَة — صيغة رفع المحتوى بالجملة (الإصدار 1)

> مرجع لمحادثة جمع المحتوى وللمحادثة التقنية التي تبني أداة الرفع في اللوحة.
> كل ما يُرفع ينزل **مسودة** بحالة مراجعة «تجريبي»، ولا يظهر للزوار حتى ينشره المحرر من اللوحة.
> الرفع من: اللوحة ← «رفع محتوى» (`/admin/import`). الفحص أولًا يعرض الأخطاء بالعربية؛ والملف كله أو لا شيء.

## شكل التسليم

- ملف JSON واحد لكل **مسار** مع مواده: `content/<رقم-الدفعة>-<slug-المسار>.json`، مثل `content/01-fajr-consistency.json`.
- يُحفظ في ملفات المشروع (Project) على هذا المسار نفسه.
- مواد مستقلة بلا مسار (للمكتبة فقط): `content/<رقم>-library-<موضوع>.json` بالشكل نفسه مع `"path": null`.
- الترميز UTF-8، والنصوص عربية. الـ`slug` بالإنجليزية الصغيرة والأرقام والشرطة فقط (`a-z0-9-`)، ولا يتجاوز 80 حرفًا، وفريد في كل المشروع.

## البنية

```json
{
  "format": "yaqatha-content/1",
  "batch": "01",
  "path": {
    "slug": "fajr-consistency",
    "title": "المحافظة على صلاة الفجر",
    "description": "سطر أو سطران يظهران على بطاقة المسار (≤ 1000 حرف).",
    "purpose": "ما الذي سيتغيّر في حياة من يكمله (≤ 2000 حرف).",
    "duration_days": 7,
    "level": "intro",
    "change_type": "perform_duty",
    "needs": ["prayer-consistency"],
    "domain": "worship",
    "steps": [
      {
        "type": "read",
        "title": "لماذا الفجر؟",
        "instructions": "اقرأ المادة بتأنٍّ، ثم اكتب سببًا واحدًا يخصك (≤ 2000 حرف).",
        "materials": ["fajr-why"]
      }
    ],
    "exam_questions": [
      { "prompt": "…", "options": ["…", "…", "…"], "correct_index": 0, "explanation": "…", "material": "fajr-why" }
    ],
    "suggested_goals": [
      { "title": "الفجر في وقته 7 أيام", "description": "…" }
    ],
    "next_paths": [
      { "slug": "witr-and-sunan", "kind": "next_level" }
    ]
  },
  "materials": [
    {
      "slug": "fajr-why",
      "title": "لماذا صلاة الفجر؟",
      "description": "سطر يظهر في البطاقة (≤ 1000).",
      "type": "article",
      "body": "نص Markdown (≤ 60000).",
      "url": null,
      "source_title": "صحيح مسلم",
      "source_url": "https://…",
      "author": null,
      "nature": "yaqatha_summary",
      "needs": ["prayer-consistency"],
      "domain": "worship",
      "questions": [
        {
          "prompt": "السؤال",
          "options": ["خيار 1", "خيار 2", "خيار 3"],
          "correct_index": 0,
          "explanation": "يظهر بعد الإجابة."
        }
      ],
      "review_note": "ملاحظة داخلية للمراجع: ما الذي يحتاج تحققًا (≤ 2000)."
    }
  ],
  "sources_checked": [
    { "ref": "مسلم 657", "url": "https://…", "grade": "صحيح", "checked_on": "2026-11-26" }
  ]
}
```

## القيم المسموحة

| الحقل | القيم |
|---|---|
| `level` | `intro` (تمهيدي) · `basic` (أساسي) · `advanced` (متقدم). إلزامي. يصف مقدار الالتزام ومرحلة الطريق، لا صعوبة الموضوع. |
| `exam_questions` | **إلزامي لكل مسار: 5 إلى 10 أسئلة** (قرار 26 نوفمبر). تُضاف تلقائيًا كخطوة «الامتحان» في آخر المسار، فلا تكتبها ضمن `steps`. `material` (اختياري) slug المادة التي يُراجعها من أخطأ. يجوز تكرار أسئلة «اختبر فهمك» من مواد المسار. |
| `change_type` | `quit_haram` ترك محرّم · `perform_duty` أداء فريضة · `acquire_good_deed` اكتساب خير · `increase_knowledge` زيادة علم |
| `material.type` | `article` مقال · `video` مقطع (يوتيوب في `url`) · `external_link` رابط خارجي · `guidance` إرشاد عملي · `exercise` تمرين · `reflection` تأمل |
| `step.type` | `watch` · `read` · `guidance` · `exercise` · `reflection` · `review` |
| `nature` | `original_source` المادة نفسها من مصدرها (مقطع، رابط) · `yaqatha_summary` تلخيص أو صياغة فريق يقظة |
| `next_paths[].kind` | `next_level` المستوى التالي في الموضوع نفسه · `related` مسار قريب |
| `questions` | 0–3 أسئلة لكل مادة، 2–5 خيارات، `correct_index` يبدأ من 0 |

**الاحتياجات (`needs`):** prayer-consistency, repentance, faith-and-certainty, quran-relationship, adhkar-and-worship, revive-sunnah, quit-sin-or-habit, control-desires, anger-control, improve-character, honor-parents, righteous-company, dealing-with-people, invest-time-and-youth, future-and-responsibilities, learn-religion-with-insight, understand-whats-happening, awareness-truth-vs-falsehood, start-dawah, serve-community-and-ummah

**المجالات (`domain`، واحد فقط):** worship, self-discipline, character, family-relations, time-and-life, knowledge-awareness, dawah-service

## قواعد الكتابة (تقنية)

- كل `materials` في خطوة يجب أن تكون معرّفة في `materials` بالملف نفسه، أو موجودة من دفعة سابقة (اذكر ذلك في `review_note`).
- `next_paths` تشير إلى مسارات بملفات أخرى؛ يُتجاهل الرابط إن لم يوجد المسار بعد، ويُربط حين يُرفع.
- Markdown: عناوين `##`، وقوائم، واقتباس `>`. **لا جداول**، ولا HTML، ولا تنتهِ سطرًا بقوس (ينقلب في العربية).
- الآية بنصها بين ﴿ ﴾ ثم «السورة: رقم الآية». الحديث بين « » ثم «رواه … رقم». التخريج بالأرقام دائمًا.
- المقطع: `url` بصيغة `https://www.youtube.com/watch?v=ID`، و`nature: original_source`، و`body` فارغ أو سطر تمهيد.
- لا بيانات شخصية، ولا أسماء أشخاص أحياء إلا المحاضرين وأصحاب المصادر.
