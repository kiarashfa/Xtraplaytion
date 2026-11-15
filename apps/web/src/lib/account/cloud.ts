// Cloud save: the save file kept as one file in the visitor's own Google Drive (the hidden
// app-data folder, scope drive.appdata) or Dropbox (the app's own folder), read and written
// straight from the browser with OAuth. There is no server in between; tokens stay in this
// browser (local.ts).
//
// A sync first checks the cloud file's version: when another device saved since this browser
// last did, that file is merged in (newer edits win) before the union is written back, so two
// devices never overwrite each other. Dropbox stays connected with a refresh token; Google gives
// a browser one-hour tokens only, so after that a save needs a click.

import { url } from '../url.ts';
import {
  CHANGED_EVENT,
  CLOUD_EVENT,
  CLOUD_KEY,
  cloudState,
  PROVIDERS,
  unsaved,
  writeJson,
  type CloudState,
  type Provider,
} from './local.ts';
import {
  exportSave,
  importSave,
  MAX_SAVE,
  nothingNew,
  parseSave,
  SAVE_FILE_NAME,
  type MergeSummary,
} from './save.ts';

const FILE = SAVE_FILE_NAME;
const GOOGLE_ID = import.meta.env.PUBLIC_GOOGLE_CLIENT_ID ?? '';
const DROPBOX_KEY = import.meta.env.PUBLIC_DROPBOX_APP_KEY ?? '';
/** Which providers this build can offer (their ids come from the build environment). */
export const AVAILABLE: Record<Provider, boolean> = { google: !!GOOGLE_ID, dropbox: !!DROPBOX_KEY };

/** Problems, as codes the pages translate (cloud.error.<code>). */
export type CloudCode =
  | 'gisLoad'
  | 'gisStart'
  | 'googleUnfinished'
  | 'googleScope'
  | 'popupClosed'
  | 'popupBlocked'
  | 'googleAgain'
  | 'googleClick'
  | 'dropboxAgain'
  | 'http'
  | 'offline'
  | 'conflict'
  | 'storage'
  | 'denied'
  | 'dropboxUnfinished'
  | 'foreign'
  | 'unreadable'
  | 'tooBig'
  | 'failed';

export class CloudError extends Error {
  readonly code: CloudCode;
  readonly params: Record<string, string | number>;
  /** The provider wants the visitor to sign in again. */
  readonly auth: boolean;
  constructor(
    code: CloudCode,
    {
      auth = false,
      params = {},
    }: { auth?: boolean; params?: Record<string, string | number> } = {},
  ) {
    super(code);
    this.code = code;
    this.auth = auth;
    this.params = params;
  }
}

export type SyncStatus =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved'; at: number }
  | { state: 'auth' | 'error'; error: CloudError };

let status: SyncStatus = { state: 'idle' };
function announce(next?: SyncStatus): void {
  if (next) status = next;
  dispatchEvent(new CustomEvent(CLOUD_EVENT, { detail: status }));
}
export const syncStatus = (): SyncStatus => status;

function persist(s: CloudState): void {
  writeJson(CLOUD_KEY, s);
  announce();
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const expiresAt = (seconds: unknown) =>
  Date.now() + Math.max(60, (Number(seconds) || 3600) - 120) * 1000;

/** fetch, with a lost connection turned into a CloudError. */
async function send(provider: Provider, input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, { ...init, referrerPolicy: 'no-referrer' });
  } catch {
    throw new CloudError('offline', { params: { where: PROVIDERS[provider] } });
  }
}
const failed = (provider: Provider, res: Response) =>
  new CloudError('http', { params: { where: PROVIDERS[provider], status: res.status } });

interface Remote {
  id?: string;
  rev: string;
}

interface Api {
  access(s: CloudState, interactive: boolean): Promise<CloudState>;
  account(s: CloudState): Promise<CloudState['account']>;
  stat(s: CloudState): Promise<Remote | null>;
  download(s: CloudState, remote: Remote): Promise<string>;
  upload(s: CloudState, body: string, remote: Remote | null): Promise<Remote>;
  revoke(s: CloudState): Promise<void>;
}

/* Google Drive ------------------------------------------------------------------------------ */

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

interface TokenResponse {
  access_token: string;
  expires_in: number;
  error?: string;
}
interface GoogleOAuth {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    prompt: string;
    callback: (response: TokenResponse) => void;
    error_callback: (error: { type?: string }) => void;
  }): { requestAccessToken(): void };
  hasGrantedAllScopes(response: TokenResponse, scope: string): boolean;
  revoke(token: string, done: () => void): void;
}
declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth } };
  }
}

// Google's sign-in script, loaded on first need. Load it before the click that asks for a token,
// or the browser may block the sign-in window.
let gis: Promise<GoogleOAuth> | null = null;
export function loadGoogle(): Promise<GoogleOAuth> {
  gis ??= new Promise((resolve, reject) => {
    const ready = window.google?.accounts?.oauth2;
    if (ready) return resolve(ready);
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => {
      const oauth2 = window.google?.accounts?.oauth2;
      if (oauth2) resolve(oauth2);
      else reject(new CloudError('gisStart'));
    };
    script.onerror = () => {
      gis = null;
      script.remove();
      reject(new CloudError('gisLoad'));
    };
    document.head.append(script);
  });
  return gis;
}

// A one-hour access token. `prompt` '' lets Google skip screens the visitor already agreed to;
// 'select_account' asks which account to use.
async function googleToken(prompt: string): Promise<CloudState['token']> {
  const oauth2 = await loadGoogle();
  return new Promise((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: GOOGLE_ID,
      scope: GOOGLE_SCOPE,
      prompt,
      callback: (r) => {
        if (r.error) return reject(new CloudError('googleUnfinished', { auth: true }));
        if (!oauth2.hasGrantedAllScopes(r, GOOGLE_SCOPE)) {
          return reject(new CloudError('googleScope', { auth: true }));
        }
        resolve({ access: r.access_token, expires: expiresAt(r.expires_in) });
      },
      error_callback: (e) =>
        reject(
          new CloudError(e?.type === 'popup_closed' ? 'popupClosed' : 'popupBlocked', {
            auth: true,
          }),
        ),
    });
    client.requestAccessToken();
  });
}

async function gfetch(s: CloudState, input: string, init: RequestInit = {}): Promise<Response> {
  const res = await send('google', input, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string>),
      Authorization: `Bearer ${s.token?.access}`,
    },
  });
  if (res.status === 401) throw new CloudError('googleAgain', { auth: true });
  if (!res.ok) throw failed('google', res);
  return res;
}

const google: Api = {
  async access(s, interactive) {
    if (s.token?.access && s.token.expires > Date.now()) return s;
    if (!interactive) throw new CloudError('googleClick', { auth: true });
    return { ...s, token: await googleToken('') };
  },
  async account(s) {
    const r = (await (
      await gfetch(s, `${DRIVE}/about?fields=user(displayName,emailAddress)`)
    ).json()) as { user?: { displayName?: string; emailAddress?: string } };
    return { name: r.user?.displayName ?? '', email: r.user?.emailAddress ?? '' };
  },
  async stat(s) {
    const q = encodeURIComponent(`name='${FILE}' and trashed=false`);
    const r = (await (
      await gfetch(
        s,
        `${DRIVE}/files?spaces=appDataFolder&q=${q}&fields=files(id,version)&pageSize=1`,
      )
    ).json()) as { files?: { id: string; version: string }[] };
    const f = r.files?.[0];
    return f ? { id: f.id, rev: String(f.version) } : null;
  },
  async download(s, remote) {
    return (await gfetch(s, `${DRIVE}/files/${remote.id}?alt=media`)).text();
  },
  async upload(s, body, remote) {
    let res: Response;
    if (remote) {
      res = await gfetch(
        s,
        `${DRIVE_UPLOAD}/files/${remote.id}?uploadType=media&fields=id,version`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body },
      );
    } else {
      const boundary = `xtraplaytion-${b64url(crypto.getRandomValues(new Uint8Array(12)))}`;
      const meta = JSON.stringify({
        name: FILE,
        parents: ['appDataFolder'],
        mimeType: 'application/json',
      });
      res = await gfetch(s, `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,version`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`,
      });
    }
    const r = (await res.json()) as { id: string; version: string };
    return { id: r.id, rev: String(r.version) };
  },
  async revoke(s) {
    const token = s.token;
    if (!token?.access || token.expires <= Date.now()) return;
    const oauth2 = await loadGoogle();
    await new Promise<void>((done) => oauth2.revoke(token.access, done));
  },
};

/* Dropbox ----------------------------------------------------------------------------------- */
// OAuth with PKCE (no app secret in a static site): the visitor goes to Dropbox and comes back to
// /user/ with a code, which finishDropbox() trades for a refresh token.

const DBX_AUTHORIZE = 'https://www.dropbox.com/oauth2/authorize';
const DBX_TOKEN = 'https://api.dropboxapi.com/oauth2/token';
const DBX_API = 'https://api.dropboxapi.com/2';
const DBX_CONTENT = 'https://content.dropboxapi.com/2';
const DBX_PATH = `/${FILE}`;
const PKCE_KEY = 'xp-dropbox-pkce';
// Must match a redirect URI registered with the Dropbox app exactly.
export const redirectUri = () => new URL(url('user/'), location.origin).href;

interface DropboxToken {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

async function dropboxToken(
  params: Record<string, string>,
): Promise<Required<Pick<DropboxToken, 'access_token'>> & DropboxToken> {
  const res = await send('dropbox', DBX_TOKEN, {
    method: 'POST',
    body: new URLSearchParams({ client_id: DROPBOX_KEY, ...params }),
  });
  const r = (await res.json().catch(() => ({}))) as DropboxToken;
  if (!res.ok || !r.access_token) throw new CloudError('dropboxAgain', { auth: true });
  return { ...r, access_token: r.access_token };
}

async function dfetch(
  s: CloudState,
  input: string,
  { arg, body, json }: { arg?: unknown; body?: string; json?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${s.token?.access}` };
  // Dropbox-API-Arg must be ASCII: escape everything else as \uXXXX.
  if (arg)
    headers['Dropbox-API-Arg'] = JSON.stringify(arg).replace(
      /[\u007f-￿]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  else if (body !== undefined) headers['Content-Type'] = 'application/octet-stream';
  const res = await send('dropbox', input, {
    method: 'POST',
    headers,
    body: json !== undefined ? JSON.stringify(json) : (body ?? null),
  });
  if (res.status === 401) throw new CloudError('dropboxAgain', { auth: true });
  return res;
}

const dropbox: Api = {
  async access(s) {
    if (s.token?.access && s.token.expires > Date.now()) return s;
    if (!s.refresh) throw new CloudError('dropboxAgain', { auth: true });
    const r = await dropboxToken({ grant_type: 'refresh_token', refresh_token: s.refresh });
    return { ...s, token: { access: r.access_token, expires: expiresAt(r.expires_in) } };
  },
  async account(s) {
    const res = await dfetch(s, `${DBX_API}/users/get_current_account`);
    if (!res.ok) return null;
    const r = (await res.json()) as { name?: { display_name?: string }; email?: string };
    return { name: r.name?.display_name ?? '', email: r.email ?? '' };
  },
  async stat(s) {
    const res = await dfetch(s, `${DBX_API}/files/get_metadata`, { json: { path: DBX_PATH } });
    if (res.status === 409) return null; // not there yet
    if (!res.ok) throw failed('dropbox', res);
    return { rev: ((await res.json()) as { rev: string }).rev };
  },
  async download(s) {
    const res = await dfetch(s, `${DBX_CONTENT}/files/download`, { arg: { path: DBX_PATH } });
    if (!res.ok) throw failed('dropbox', res);
    return res.text();
  },
  async upload(s, body, remote) {
    // "update" only writes over the version this browser saw; anything newer answers 409 and the
    // sync starts over with that version merged in.
    const mode = remote ? { '.tag': 'update', update: remote.rev } : { '.tag': 'add' };
    const res = await dfetch(s, `${DBX_CONTENT}/files/upload`, {
      arg: { path: DBX_PATH, mode, autorename: false, mute: true },
      body,
    });
    if (res.status === 409) throw new CloudError('conflict');
    if (!res.ok) throw failed('dropbox', res);
    return { rev: ((await res.json()) as { rev: string }).rev };
  },
  async revoke(s) {
    if (s.token?.access && s.token.expires > Date.now())
      await dfetch(s, `${DBX_API}/auth/token/revoke`);
  },
};

const API: Record<Provider, Api> = { google, dropbox };

/* Connecting -------------------------------------------------------------------------------- */

/** Starts the Dropbox round trip (this page is left for Dropbox's). */
export async function connectDropbox(): Promise<void> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  );
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  try {
    sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));
  } catch {
    throw new CloudError('storage');
  }
  const q = new URLSearchParams({
    client_id: DROPBOX_KEY,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    redirect_uri: redirectUri(),
    token_access_type: 'offline',
    state,
  });
  location.assign(`${DBX_AUTHORIZE}?${q}`);
}

/** True when this page's address is Dropbox's answer to connectDropbox(). */
export function isDropboxReturn(): boolean {
  const params = new URLSearchParams(location.search);
  return params.has('state') && (params.has('code') || params.has('error'));
}

/** The PKCE secret kept for this round trip (read once), or null. */
function takePkce(): { verifier: string; state: string } | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(PKCE_KEY) ?? 'null') as {
      verifier: string;
      state: string;
    } | null;
    sessionStorage.removeItem(PKCE_KEY);
    return value;
  } catch {
    return null;
  }
}

/** On /user/: finishes connecting Dropbox from its answer in the address, then syncs. */
export async function finishDropbox(): Promise<SyncResult> {
  const params = new URLSearchParams(location.search);
  const pkce = takePkce();
  // The code must not stay in the address (history, bookmarks).
  history.replaceState(history.state, '', location.pathname + location.hash);
  if (params.has('error')) {
    throw new CloudError(params.get('error') === 'access_denied' ? 'denied' : 'dropboxUnfinished');
  }
  if (!pkce || pkce.state !== params.get('state')) throw new CloudError('foreign');
  const r = await dropboxToken({
    grant_type: 'authorization_code',
    code: params.get('code') ?? '',
    code_verifier: pkce.verifier,
    redirect_uri: redirectUri(),
  });
  return connected({
    provider: 'dropbox',
    refresh: r.refresh_token ?? null,
    token: { access: r.access_token, expires: expiresAt(r.expires_in) },
  });
}

export async function connectGoogle(): Promise<SyncResult> {
  const token = await googleToken('select_account');
  return connected({ provider: 'google', token });
}

async function connected(
  base: Pick<CloudState, 'provider' | 'token'> & Partial<CloudState>,
): Promise<SyncResult> {
  const prev = cloudState();
  if (prev && prev.provider !== base.provider) await disconnect();
  const s: CloudState = {
    account: null,
    savedAt: null,
    rev: null,
    file: null,
    refresh: null,
    problem: null,
    ...base,
  };
  s.account = await API[s.provider].account(s).catch(() => null);
  persist(s);
  return sync({ interactive: true });
}

/** Forgets the connection here and asks the provider to revoke the token. The cloud file stays. */
export async function disconnect(): Promise<void> {
  const s = cloudState();
  writeJson(CLOUD_KEY, null);
  announce({ state: 'idle' });
  if (s) await API[s.provider].revoke(s).catch(() => {});
}

/* Saving ------------------------------------------------------------------------------------ */

/** What a sync brought in from the cloud (null when nothing was new). */
export interface SyncResult {
  imported: MergeSummary | null;
}

let running: Promise<SyncResult> | null = null;

/** Brings the cloud file and this browser together: merges the file in when another device saved
 * since this browser last did, then writes everything back if anything here is new. */
export function sync(options?: { interactive?: boolean }): Promise<SyncResult> {
  running ??= run(options).finally(() => (running = null));
  return running;
}

async function run({ interactive = false, retry = true } = {}): Promise<SyncResult> {
  let s = cloudState();
  if (!s) return { imported: null };
  // Google's hour is over: changes wait (amber dot) for a click instead of showing an error.
  if (!interactive && s.provider === 'google' && !(s.token && s.token.expires > Date.now())) {
    announce({ state: 'idle' });
    return { imported: null };
  }
  const provider = s.provider;
  const api = API[provider];
  const where = PROVIDERS[provider];
  announce({ state: 'saving' });
  try {
    s = await api.access(s, interactive);
    const remote = await api.stat(s);
    let imported: MergeSummary | null = null;
    if (remote && remote.rev !== s.rev) {
      const parsed = parseSave(await api.download(s, remote));
      if (typeof parsed === 'string') {
        throw new CloudError('unreadable', { params: { where, file: FILE } });
      }
      const summary = await importSave(parsed.save);
      if (!nothingNew(summary)) imported = summary;
    }
    if (!remote || remote.rev !== s.rev || unsaved(s)) {
      const gatheredAt = new Date().toISOString();
      const { text } = await exportSave();
      if (text.length > MAX_SAVE) {
        throw new CloudError('tooBig', { params: { size: `${Math.round(text.length / 1e6)} MB` } });
      }
      const saved = await api.upload(s, text, remote);
      s = { ...s, rev: saved.rev, file: saved.id ?? s.file, savedAt: gatheredAt };
    }
    persist({ ...s, problem: null });
    announce({ state: 'saved', at: Date.now() });
    return { imported };
  } catch (error) {
    const err = error instanceof CloudError ? error : new CloudError('failed');
    if (err.code === 'conflict' && retry) return run({ interactive, retry: false });
    // Keep a refreshed token even when the save itself failed.
    const latest = cloudState();
    if (latest)
      persist({ ...latest, token: s?.token ?? latest.token, problem: err.auth ? 'auth' : 'error' });
    announce({ state: err.auth ? 'auth' : 'error', error: err });
    throw err;
  }
}

/** Saves a few seconds after each change, and when the page is hidden. Google past its hour
 * leaves the changes waiting (amber dot) until a click. */
let started = false;
export function startAutoSave(): void {
  if (started) return;
  started = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const kick = (delay: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const s = cloudState();
      if (s && (unsaved(s) || s.problem === 'error') && s.problem !== 'auth')
        sync().catch(() => {});
    }, delay);
  };
  addEventListener(CHANGED_EVENT, () => kick(4000));
  addEventListener('online', () => kick(1000));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') kick(0);
  });
  // A save from another device shows up when a page opens (checked at most every two minutes
  // while browsing, at once when something here waits to be saved).
  const s = cloudState();
  if (!s || s.problem === 'auth') return;
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(CHECKED_KEY)) || 0;
    sessionStorage.setItem(CHECKED_KEY, String(Date.now()));
  } catch {
    // Without session storage every page checks.
  }
  if (unsaved(s) || s.problem === 'error' || Date.now() - last > 120_000) sync().catch(() => {});
}
const CHECKED_KEY = 'xp-cloud-checked';
