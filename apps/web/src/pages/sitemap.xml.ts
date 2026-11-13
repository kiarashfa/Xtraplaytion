// sitemap.xml for search engines: every public page (not the embed, which is noindex).
import { LESSONS } from '../lib/lessons.ts';
import { url } from '../lib/url.ts';
import { SITE } from '../site.config.ts';

const PAGES = [
  '',
  'playground/',
  'lessons/',
  ...LESSONS.map((l) => `lessons/${l.slug}/`),
  'gallery/',
  'library/',
  'about/',
];

export function GET() {
  const body = PAGES.map((p) => `  <url><loc>${SITE.url}${url(p)}</loc></url>`).join('\n');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`,
    { headers: { 'Content-Type': 'application/xml' } },
  );
}
