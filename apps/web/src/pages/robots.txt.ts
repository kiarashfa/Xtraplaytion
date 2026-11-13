// robots.txt. On a GitHub project page this file lives under the base path, so crawlers that
// only read the domain root will not see it; the sitemap link and per-page meta still apply.
import { url } from '../lib/url.ts';
import { SITE } from '../site.config.ts';

export function GET() {
  return new Response(
    `User-agent: *\nAllow: /\nDisallow: ${url('embed/')}\n\nSitemap: ${SITE.url}${url('sitemap.xml')}\n`,
    { headers: { 'Content-Type': 'text/plain' } },
  );
}
