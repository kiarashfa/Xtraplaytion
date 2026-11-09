import { SITE } from '../site.config.ts';

/** Resolve a site path against the deploy base (e.g. `/Xtraplaytion/`). */
export function url(path = ''): string {
  return SITE.basePath + path.replace(/^\/+/, '');
}

/** Link to a file in the repository on GitHub. */
export function repoFile(path: string): string {
  return `${SITE.repoUrl}/blob/main/${path}`;
}
