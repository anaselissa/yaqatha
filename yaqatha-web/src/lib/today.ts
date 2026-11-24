/** «يومك»: تاريخ المستخدم بتوقيته، والأهداف اليومية وتعليمها. كل ما هنا يتحمّل غياب الهجرة 13 (يعيد قائمة فارغة). */
import type { AstroCookies } from 'astro';
import { rest } from './api';

/** تاريخ اليوم بتوقيت المستخدم (من ملف yq-tz الذي يضعه المتصفح)، وإلا بتوقيت الخادم */
export function localDate(cookies: AstroCookies, offsetDays = 0): string {
  const tz = cookies.get('yq-tz')?.value;
  const d = new Date(Date.now() + offsetDays * 86400000);
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
  catch { return d.toISOString().slice(0, 10); }
}

export interface DailyGoal {
  id: string; title: string; days: number | null; created_at: string;
  doneCount: number; today: boolean | null; checkins: { day: string; done: boolean }[];
}

/** الأهداف اليومية النشطة مع أيامها. null إن لم تُطبَّق الهجرة 13 بعد. */
export async function getDailyGoals(t: string, today: string, id?: string): Promise<DailyGoal[] | null> {
  try {
    const { rows } = await rest<{ id: string; title: string; days: number | null; created_at: string; goal_checkins: { day: string; done: boolean }[] }>('goals', {
      select: 'id,title,days,created_at,goal_checkins(day,done)', kind: 'eq.daily',
      ...(id ? { id: `eq.${id}` } : { status: 'in.(not_started,in_progress)' }), order: 'created_at.asc', limit: 50,
    }, { token: t });
    return rows.map((g) => {
      const ck = [...g.goal_checkins].sort((a, b) => a.day.localeCompare(b.day));
      const td = ck.find((c) => c.day === today);
      return { id: g.id, title: g.title, days: g.days, created_at: g.created_at, checkins: ck, doneCount: ck.filter((c) => c.done).length, today: td ? td.done : null };
    });
  } catch (e) {
    console.error('[daily-goals]', (e as Error).message);
    return null;
  }
}

/** الصيغة العربية للعدد مع المعدود (يوم/خطوة…) */
export function countLabel(n: number, one: string, two: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}
