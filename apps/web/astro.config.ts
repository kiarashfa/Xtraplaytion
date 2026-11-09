import { createHash } from 'node:crypto';
import mdx from '@astrojs/mdx';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import { thirdPartyNotices } from './scripts/notices.ts';
import { THEME_INIT_SCRIPT } from './src/lib/theme.ts';
import { SITE } from './src/site.config.ts';

const sha256 = (s: string) =>
  `sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}` as const;

export default defineConfig({
  site: SITE.url,
  base: SITE.basePath,
  trailingSlash: 'ignore',
  integrations: [
    svelte(),
    mdx(),
    thirdPartyNotices({
      allow: [
        'MIT',
        'ISC',
        'BSD-2-Clause',
        'BSD-3-Clause',
        'Apache-2.0',
        '0BSD',
        'OFL-1.1',
        'MPL-2.0',
        'CC0-1.0',
      ],
      // Astro inlines its island loader into every page; Tailwind generates the base CSS.
      alwaysInclude: ['astro', 'tailwindcss'],
      labels: {
        astro: 'Astro (page framework, island loader)',
        svelte: 'Svelte (interactive components)',
        '@astrojs/svelte': 'Astro Svelte integration (client renderer)',
        tailwindcss: 'Tailwind CSS (base styles)',
        '@fontsource-variable/inter': 'Inter font (packaged by Fontsource)',
        '@fontsource/jetbrains-mono': 'JetBrains Mono font (packaged by Fontsource)',
      },
    }),
  ],
  devToolbar: { enabled: false },
  // Plain code blocks: highlighters add inline styles, which the Content-Security-Policy blocks.
  markdown: { syntaxHighlight: false },
  // Content-Security-Policy as a <meta> tag on every page (GitHub Pages cannot send headers).
  // Astro adds hashes for its own inline scripts and styles. Google Analytics hosts are only
  // contacted after the visitor accepts analytics in the consent bar.
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data: blob: https://*.google-analytics.com https://*.googletagmanager.com",
        "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
        "font-src 'self'",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ],
      scriptDirective: {
        resources: ["'self'", 'https://www.googletagmanager.com'],
        hashes: [sha256(THEME_INIT_SCRIPT)],
      },
    },
  },
  vite: {
    plugins: [tailwindcss()],
    build: {
      // Never inline fonts as data: URLs; the CSP only allows same-origin font files.
      assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/i.test(file) ? false : undefined),
    },
  },
});
