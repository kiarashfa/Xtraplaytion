/** Storage key for the theme preference ('light' | 'dark'; absent means system). */
export const THEME_KEY = 'xp-theme';

/**
 * Inline script that sets <html data-theme> before first paint. Kept as a
 * single string so astro.config.ts can hash exactly these bytes for the CSP.
 */
export const THEME_INIT_SCRIPT =
  "(function(){var p='system';try{p=localStorage.getItem('" +
  THEME_KEY +
  "')||'system'}catch(e){}var d=p==='dark'||(p!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light'})();";
