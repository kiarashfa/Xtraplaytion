// Texts for the account pages, from the codes the save and cloud code reports.
import type { MessageKey, Translate } from '../../i18n';
import type { MergeSummary } from './save.ts';

/** A cloud problem in words (CloudError codes map to cloud.error.<code>). */
export function cloudErrorText(t: Translate, error: unknown): string {
  const e = error as { code?: unknown; params?: Record<string, string | number> } | null;
  if (e && typeof e.code === 'string' && e.params) {
    return t(`cloud.error.${e.code}` as MessageKey, e.params);
  }
  return t('cloud.error.failed');
}

/** "2 new experiments, 1 updated and your profile" ('' when nothing was new). */
export function describeMerge(t: Translate, s: MergeSummary, locale = 'en'): string {
  const parts = [
    s.added ? t('user.merge.added', { count: s.added }) : '',
    s.updated ? t('user.merge.updated', { count: s.updated }) : '',
    s.removed ? t('user.merge.removed', { count: s.removed }) : '',
    s.profile ? t('user.merge.profile') : '',
  ].filter(Boolean);
  return new Intl.ListFormat(locale, { type: 'conjunction' }).format(parts);
}
