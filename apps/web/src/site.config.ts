// Single source of truth for site-wide settings. Every page, the Astro config and the tests read from here.

export const SITE = {
  name: 'Xtraplaytion',
  /** Origin the site is served from (no trailing slash). */
  url: 'https://kiarashfa.github.io',
  /** Path prefix of the GitHub project page. Change to '/' for a custom domain. */
  basePath: '/Xtraplaytion/',
  repoUrl: 'https://github.com/kiarashfa/Xtraplaytion',
  /** Copyright year shown in the footer. */
  copyrightYear: 2026,
  analytics: {
    ga4MeasurementId: 'G-0RNZNZBMNC',
    /** GA loads only after the visitor accepts in the consent bar (components/ConsentBar.astro). */
    enabled: true,
  },
} as const;
