import MarkdownIt from 'markdown-it';

// html:false يمنع HTML الخام، وmarkdown-it يرفض روابط javascript: افتراضيًا.
const md = new MarkdownIt({ html: false, linkify: false, breaks: false });

// عنوان الصفحة h1، فتبدأ عناوين المحتوى من h2
const level = (tag: string) => Math.max(2, Math.min(6, Number(tag.slice(1))));
md.renderer.rules.heading_open = (tokens, idx) => `<h${level(tokens[idx].tag)}>`;
md.renderer.rules.heading_close = (tokens, idx) => `</h${level(tokens[idx].tag)}>\n`;
md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  tokens[idx].attrSet('rel', 'noopener nofollow ugc');
  tokens[idx].attrSet('target', '_blank');
  return self.renderToken(tokens, idx, options);
};

export function renderMarkdown(src: string | null | undefined): string {
  return src ? md.render(src) : '';
}

export function youtubeId(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1) || null;
    if (/(^|\.)youtube\.com$/.test(u.hostname)) {
      const v = u.searchParams.get('v');
      if (v) return v;
      const m = u.pathname.match(/^\/(embed|shorts)\/([\w-]{6,})/);
      if (m) return m[2];
    }
  } catch { /* رابط غير صالح */ }
  return null;
}
