/** هندسة «الطريق والشمس»: قوس أفق يبدأ من اليمين (اتجاه القراءة)، والشمس عند نسبة التقدّم على طوله. */
export interface Pt { x: number; y: number }
const q = (a: Pt, c: Pt, b: Pt, t: number): Pt => ({
  x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t ** 2 * b.x,
  y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t ** 2 * b.y,
});
/** نقطة على منحنى تربيعي عند نسبة من طوله (لا من معامله)، كي تطابق الشمسُ نهايةَ الخط الملوّن */
export function pointAt(a: Pt, c: Pt, b: Pt, frac: number): Pt {
  const N = 120, pts: Pt[] = [], len: number[] = [0];
  for (let i = 0; i <= N; i++) pts.push(q(a, c, b, i / N));
  for (let i = 1; i <= N; i++) len.push(len[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const target = Math.max(0, Math.min(1, frac)) * len[N];
  let i = 1; while (i < N && len[i] < target) i++;
  const seg = len[i] - len[i - 1] || 1, r = (target - len[i - 1]) / seg;
  return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * r, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * r };
}
export const r1 = (n: number) => Math.round(n * 10) / 10;
