/** Storage key for the analytics consent choice. A choice is not a cookie: it stays in this browser. */
export const CONSENT_KEY = 'xp-consent';

export type Consent = 'granted' | 'denied';

export function readConsent(): Consent | null {
  try {
    const value = localStorage.getItem(CONSENT_KEY);
    return value === 'granted' || value === 'denied' ? value : null;
  } catch {
    return null;
  }
}
