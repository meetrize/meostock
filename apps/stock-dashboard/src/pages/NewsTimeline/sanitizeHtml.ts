/**
 * 轻量清洗资讯摘要 HTML（去 script/事件，禁 javascript:）
 * 参考 feedgen article-reader sanitizeArticleHtml
 */
export function sanitizeArticleHtml(value: string | null | undefined): string {
  if (value == null) return '';
  const raw = String(value);
  if (!raw.trim()) return '';

  if (typeof document === 'undefined') {
    return raw
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '');
  }

  const template = document.createElement('template');
  template.innerHTML = raw;

  template.content
    .querySelectorAll('script,style,iframe,object,embed,link,meta')
    .forEach((el) => el.remove());

  template.content.querySelectorAll('*').forEach((el) => {
    Array.from(el.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      const val = String(attr.value || '').trim().toLowerCase();
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
        return;
      }
      if ((name === 'href' || name === 'src') && val.startsWith('javascript:')) {
        el.removeAttribute(attr.name);
      }
    });
  });

  return template.innerHTML;
}

/** 是否像 HTML 片段（含标签） */
export function looksLikeHtml(value: string | null | undefined): boolean {
  const s = String(value || '');
  return /<[a-z][\s\S]*>/i.test(s);
}
