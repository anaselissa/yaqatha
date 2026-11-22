/** قراءات المستخدم المسجَّل: كلها بـ JWT المستخدم، فتحكمها RLS (لا يرى إلا بياناته). */
import { one, rest, rpc } from './api';
import type { PathCard } from './data';

export interface Goal {
  id: string; title: string; description: string | null; domain_id: string | null; target_date: string | null;
  status: string; status_before_archive: string | null; created_at: string; updated_at: string;
}
export interface Enrollment {
  id: string; path_id: string; version_id: string; status: string; started_at: string; archived_at: string | null;
  archive_reason: string | null; last_step_id: string | null; migrated_from: string | null;
  paths: { slug: string } | null;
  path_versions: { title: string; version_no: number; status: string; duration_days: number | null; changelog: string | null } | null;
}
export interface Progress { enrollment_id: string; total_steps: number; completed_steps: number; resume_step_id: string | null }
export interface MyStep {
  id: string; position: number; type: string; title: string; instructions: string | null;
  step_materials: { position: number; materials: { id: string; slug: string; title: string; type: string; description: string | null } | null }[];
}

const ENR = 'id,path_id,version_id,status,started_at,archived_at,archive_reason,last_step_id,migrated_from,paths(slug),path_versions(title,version_no,status,duration_days,changelog)';

export const getGoals = async (t: string, statuses?: string[]) =>
  (await rest<Goal>('goals', { select: '*', order: 'updated_at.desc', ...(statuses ? { status: `in.(${statuses.join(',')})` } : {}) }, { token: t })).rows;
export const getGoal = (t: string, id: string) => one<Goal>('goals', { select: '*', id: `eq.${id}` }, t);

export async function getGoalLinks(t: string, goalId: string) {
  const [enr, mats] = await Promise.all([
    rest<{ enrollment_id: string; enrollments: Enrollment | null }>('goal_enrollments', { select: `enrollment_id,enrollments(${ENR})`, goal_id: `eq.${goalId}` }, { token: t }),
    rest<{ material_id: string; materials: { slug: string; title: string; type: string } | null }>('goal_materials', { select: 'material_id,materials(slug,title,type)', goal_id: `eq.${goalId}` }, { token: t }),
  ]);
  return { enrollments: enr.rows, materials: mats.rows };
}

export async function getEnrollments(t: string, status: 'active' | 'archived' = 'active') {
  const { rows } = await rest<Enrollment>('enrollments', { select: ENR, status: `eq.${status}`, order: 'started_at.desc', limit: 100 }, { token: t });
  return rows;
}
export const getEnrollment = (t: string, id: string) => one<Enrollment>('enrollments', { select: ENR, id: `eq.${id}` }, t);

export async function getProgress(t: string, ids: string[]): Promise<Map<string, Progress>> {
  if (!ids.length) return new Map();
  const { rows } = await rest<Progress>('enrollment_progress', { select: '*', enrollment_id: `in.(${ids.join(',')})` }, { token: t });
  return new Map(rows.map((r) => [r.enrollment_id, r]));
}

export async function getStepTitles(t: string, ids: string[]): Promise<Map<string, { id: string; title: string; position: number }>> {
  const list = ids.filter(Boolean);
  if (!list.length) return new Map();
  const { rows } = await rest<{ id: string; title: string; position: number }>('steps', { select: 'id,title,position', id: `in.(${list.join(',')})` }, { token: t });
  return new Map(rows.map((r) => [r.id, r]));
}

export async function getEnrollmentSteps(t: string, e: Enrollment) {
  const [steps, states] = await Promise.all([
    rest<MyStep>('steps', {
      select: 'id,position,type,title,instructions,step_materials(position,materials(id,slug,title,type,description))',
      version_id: `eq.${e.version_id}`, order: 'position',
    }, { token: t }),
    rest<{ step_id: string; state: string }>('enrollment_steps', { select: 'step_id,state', enrollment_id: `eq.${e.id}` }, { token: t }),
  ]);
  const st = new Map(states.rows.map((s) => [s.step_id, s.state]));
  for (const s of steps.rows) s.step_materials.sort((a, b) => a.position - b.position);
  return { steps: steps.rows, state: (id: string) => st.get(id) ?? 'not_started' };
}

/** آخر إصدار منشور لكل مسار (للتنبيه بوجود تحديث) */
export async function getLatestVersions(pathIds: string[]): Promise<Map<string, PathCard>> {
  if (!pathIds.length) return new Map();
  const { rows } = await rest<PathCard>('paths_current', { select: '*', path_id: `in.(${pathIds.join(',')})` });
  return new Map(rows.map((r) => [r.path_id, r]));
}

export const planMigration = (t: string, enrollmentId: string) =>
  rpc<{ step_key: string; kind: 'carried' | 'new' | 'removed'; title: string; position: number; state: string }[]>('plan_migration', { p_enrollment_id: enrollmentId }, t);

export async function getSaved(t: string, limit = 200) {
  const { rows } = await rest<{ material_id: string; created_at: string; materials: { slug: string; title: string; type: string; description: string | null } | null }>(
    'saved_materials', { select: 'material_id,created_at,materials(slug,title,type,description)', order: 'created_at.desc', limit }, { token: t });
  return rows;
}

export async function getRecentActivity(t: string, limit = 10) {
  const { rows } = await rest<{ updated_at: string; steps: { title: string } | null; enrollments: { id: string; path_versions: { title: string } | null } | null }>(
    'enrollment_steps', { select: 'updated_at,steps(title),enrollments(id,path_versions(title))', state: 'eq.completed', order: 'updated_at.desc', limit }, { token: t });
  return rows;
}

export const getDomainsList = async () => (await rest<{ id: string; slug: string; title: string }>('domains', { select: 'id,slug,title', order: 'sort_order' })).rows;

/** ختام المسار: أهداف يقترحها الفريق، ومسارات تالية منشورة (RLS تُظهر المنشور فقط) */
export async function getPathEnding(t: string, pathId: string) {
  try { return await pathEnding(t, pathId); }
  catch (e) { console.error('[path-ending]', (e as Error).message); return { goals: [], paths: [] }; } // إضافة لا أساس: لا تُفشل الصفحة
}
async function pathEnding(t: string, pathId: string) {
  const [goals, next] = await Promise.all([
    rest<{ id: string; title: string; description: string | null }>('path_suggested_goals', { select: 'id,title,description', path_id: `eq.${pathId}`, order: 'position' }, { token: t }).then((r) => r.rows),
    rest<{ next_path_id: string }>('path_next', { select: 'next_path_id', path_id: `eq.${pathId}`, order: 'position' }, { token: t }).then((r) => r.rows.map((x) => x.next_path_id)),
  ]);
  const paths = next.length
    ? (await rest<{ path_id: string; slug: string; title: string; description: string | null; duration_days: number | null }>('paths_current', { select: 'path_id,slug,title,description,duration_days', path_id: `in.(${next.join(',')})` }, { token: t })).rows
        .sort((a, b) => next.indexOf(a.path_id) - next.indexOf(b.path_id))
    : [];
  return { goals, paths };
}
