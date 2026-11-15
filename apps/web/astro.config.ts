import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import mdx from '@astrojs/mdx';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import { thirdPartyNotices } from './scripts/notices.ts';
import { AVATAR_INIT_SCRIPT } from './src/lib/account/local.ts';
import { THEME_INIT_SCRIPT } from './src/lib/theme.ts';
import { SITE } from './src/site.config.ts';

const sha256 = (s: string) =>
  `sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}` as const;

// Cloud save ids (public by design: an OAuth client id and a PKCE app key are not secrets) come
// from the repository's .env locally and from the repository variables in CI. Without them the
// build simply offers no cloud save.
const ENV_FILE = new URL('../../.env', import.meta.url);
const ROOT_ENV = existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, 'utf8')) : {};
for (const name of ['GOOGLE_CLIENT_ID', 'DROPBOX_APP_KEY']) {
  const value = process.env[name] || ROOT_ENV[name];
  if (value) process.env[`PUBLIC_${name}`] = value;
}

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
        katex: 'KaTeX (formula rendering, with its fonts)',
      },
      // Algorithms ported into packages/dmath.
      extras: [
        {
          name: 'fdlibm',
          label: 'fdlibm math library (ported in packages/dmath)',
          license: 'fdlibm notice',
          homepage: 'https://www.netlib.org/fdlibm/',
          text: 'Copyright (C) 1993-2004 by Sun Microsystems, Inc. All rights reserved.\n\nDeveloped at SunPro, a Sun Microsystems, Inc. business.\nPermission to use, copy, modify, and distribute this\nsoftware is freely granted, provided that this notice\nis preserved.',
        },
        {
          name: 'musl',
          label: 'musl libc math routines (argument reduction, ported in packages/dmath)',
          license: 'MIT',
          homepage: 'https://musl.libc.org',
          text: 'Copyright © 2005-2020 Rich Felker, et al.\n\nPermission is hereby granted, free of charge, to any person obtaining\na copy of this software and associated documentation files (the\n"Software"), to deal in the Software without restriction, including\nwithout limitation the rights to use, copy, modify, merge, publish,\ndistribute, sublicense, and/or sell copies of the Software, and to\npermit persons to whom the Software is furnished to do so, subject to\nthe following conditions:\n\nThe above copyright notice and this permission notice shall be\nincluded in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,\nEXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF\nMERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.\nIN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY\nCLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,\nTORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE\nSOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.',
        },
      ],
    }),
  ],
  devToolbar: { enabled: false },
  // Plain code blocks: highlighters add inline styles, which the Content-Security-Policy blocks.
  markdown: { syntaxHighlight: false },
  // Content-Security-Policy as a <meta> tag on every page (GitHub Pages cannot send headers).
  // Astro adds hashes for its own inline scripts and styles. Google Analytics hosts are only
  // contacted after the visitor accepts analytics in the consent bar. Google sign-in, Drive and
  // Dropbox are only contacted after the visitor turns on cloud save in the profile.
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data: blob: https://*.google-analytics.com https://*.googletagmanager.com",
        "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com https://api.dropboxapi.com https://content.dropboxapi.com",
        'frame-src https://accounts.google.com',
        "font-src 'self'",
        "worker-src 'self' blob:",
        "media-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ],
      scriptDirective: {
        resources: [
          "'self'",
          'https://www.googletagmanager.com',
          'https://accounts.google.com/gsi/client',
        ],
        hashes: [sha256(THEME_INIT_SCRIPT), sha256(AVATAR_INIT_SCRIPT)],
      },
      styleDirective: {
        resources: ["'self'", 'https://accounts.google.com/gsi/style'],
        // The small <style> element Google's sign-in script adds when it loads.
        hashes: ['sha256-CKpDAHgt50xplerdFjzFkBTR0zNybnIsrm/NFRbtzFQ='],
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
