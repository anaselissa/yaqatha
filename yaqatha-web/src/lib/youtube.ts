/** أدوات يوتيوب: استخراج معرّف المقطع، الرابط الموحّد، الصورة المصغّرة، وبيانات oEmbed العامة (بلا مفتاح) */

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
export function parseYoutubeId(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    const h = u.hostname.replace(/^www\.|^m\./, '');
    let id: string | null = null;
    if (h === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (h === 'youtube.com' || h === 'youtube-nocookie.com') {
      id = u.searchParams.get('v');
      const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/);
      if (!id && m) id = m[1];
    }
    return id && YT_ID.test(id) ? id : null;
  } catch { return null; }
}
export const youtubeUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
export const youtubeThumb = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

/** عنوان المقطع واسم القناة من oEmbed العام (بلا مفتاح). يُرجع null عند الفشل فيُكمل المحرر يدويًا. */
export async function youtubeInfo(id: string): Promise<{ title: string; channel: string; channelUrl: string } | null> {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(youtubeUrl(id))}`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { title?: string; author_name?: string; author_url?: string };
    return { title: (j.title ?? '').slice(0, 200), channel: (j.author_name ?? '').slice(0, 200), channelUrl: j.author_url ?? '' };
  } catch { return null; }
}

