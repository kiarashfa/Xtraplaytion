// Signing out of this browser, from the header menu or the profile page. Loaded on demand.

import { CloudError, disconnect, loadGoogle, sync } from './cloud.ts';
import { cloudState, unsaved } from './local.ts';
import { clearBrowser } from './save.ts';

/** Loads Google's sign-in ahead of the click, so its window may open straight from it. */
export function warmUp(): void {
  if (cloudState()?.provider === 'google') loadGoogle().catch(() => {});
}

/**
 * Brings the cloud save up to date (if one is connected), disconnects it and removes the
 * profile and the library from this browser. Throws a CloudError, removing nothing, when the
 * cloud could not be saved first.
 */
export async function signOut(): Promise<void> {
  const cloud = cloudState();
  if (cloud) {
    if (unsaved(cloud) || cloud.problem) {
      try {
        await sync({ interactive: true });
      } catch (error) {
        throw error instanceof CloudError ? error : new CloudError('failed');
      }
    }
    await disconnect();
  }
  await clearBrowser();
}
