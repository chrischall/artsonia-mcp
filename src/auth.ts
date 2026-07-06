import { readEnvVar, McpToolError, CookieJar } from '@chrischall/mcp-utils';
import { CookieSessionManager } from '@chrischall/mcp-utils/session';
import type { ArtsoniaResponse, ArtsoniaTransport } from './transport.js';

const LOGIN_PATH = '/members/login.asp';
const TARGET_URL = '/members/';

export interface AuthOptions {
  username?: string;
  password?: string;
}

/** The cookie session the manager mints and hands back to callers: the live jar. */
interface ArtsoniaSession {
  jar: CookieJar;
}

// Sentinel marking the deferred config error (missing creds) so the manager
// caches it as *permanent* — every later ensure() rethrows it rather than
// retrying a login that can never succeed without new config.
const CONFIG_ERROR_MARKER = '__artsonia_missing_creds__';

// Decide whether a direct-mode response means the session expired and a re-login
// is warranted: Artsonia expires by redirecting (or rendering) back to the login
// page rather than returning a 401. Detected from the final URL, the login-page
// body markers, or a manual 3xx Location pointing at login.asp. This is the
// `isExpired` heuristic the CookieSessionManager replays on (direct mode only).
const LOGIN_RE = /\/members\/login\.asp/i;
const LOGIN_BODY_RE = /You need to log in|Parent \(or Fan\) Login/i;
export function looksUnauthenticated(res: ArtsoniaResponse): boolean {
  return LOGIN_RE.test(res.url) || LOGIN_BODY_RE.test(res.body) || (res.location ? LOGIN_RE.test(res.location) : false);
}

// Owns the username/password login and the resulting cookie session. Deferred
// config: constructing with no creds is fine; the error surfaces at ensureLogin.
//
// The single-flight login + invalidate/re-login machinery AND the one-replay-on-
// expiry for the request path are both delegated to the shared
// CookieSessionManager (direct/username+password mode only), typed over
// ArtsoniaResponse so the custom transport's response flows through withSession
// untouched. The fetchproxy/browser-session path never touches this class — there
// the browser tab carries the session and server-side login is skipped entirely
// (see ArtsoniaClient), so it never routes through withSession.
export class AuthManager {
  private readonly username: string | null;
  private readonly password: string | null;
  private readonly configError: Error | null;
  private readonly session: CookieSessionManager<ArtsoniaSession, ArtsoniaResponse>;

  constructor(private readonly transport: ArtsoniaTransport, opts: AuthOptions) {
    const username = opts.username ?? readEnvVar('ARTSONIA_USERNAME') ?? null;
    const password = opts.password ?? readEnvVar('ARTSONIA_PASSWORD') ?? null;
    this.username = username;
    this.password = password;
    this.configError = username && password ? null : new Error(
      'ARTSONIA_USERNAME and ARTSONIA_PASSWORD environment variables are required',
    );
    this.session = new CookieSessionManager<ArtsoniaSession, ArtsoniaResponse>({
      login: () => this.doLogin(),
      // Direct-mode expiry detection: Artsonia redirects/renders back to the login
      // page. The manager invalidates, single-flight re-logs-in, and replays the
      // request EXACTLY once on this signal (see withSession).
      isExpired: looksUnauthenticated,
      // A missing-creds config error can never recover without new config — cache
      // it permanently so concurrent/later ensure() calls rethrow it immediately.
      isPermanentError: (err) =>
        err instanceof Error && (err as { [CONFIG_ERROR_MARKER]?: true })[CONFIG_ERROR_MARKER] === true,
    });
  }

  /**
   * Run a direct-mode authed request through the manager's expiry-replay: the
   * manager ensures a live session, runs `call`, and on a redirect-away-to-login
   * (isExpired) invalidates + re-logs-in + replays `call` EXACTLY once. A
   * persistent expiry surfaces the (still-login-looking) second response rather
   * than looping, and a failed re-login returns the original expired-looking
   * response — both cases let the client surface a clean sign-in error.
   */
  withSession(call: (session: ArtsoniaSession) => Promise<ArtsoniaResponse>): Promise<ArtsoniaResponse> {
    return this.session.withSession(call);
  }

  cookieHeader(): string {
    return this.session.current?.jar.header() ?? '';
  }

  hasSession(): boolean {
    const jar = this.session.current?.jar;
    return jar !== undefined && jar.size > 0;
  }

  async ensureLogin(): Promise<void> {
    await this.session.ensure();
  }

  async forceRelogin(): Promise<void> {
    this.session.invalidate();
    await this.session.ensure();
  }

  private async doLogin(): Promise<ArtsoniaSession> {
    if (this.configError) {
      (this.configError as { [CONFIG_ERROR_MARKER]?: true })[CONFIG_ERROR_MARKER] = true;
      throw this.configError;
    }
    const jar = new CookieJar();
    const body = new URLSearchParams({
      Username: this.username!,
      Password: this.password!,
      TargetUrl: TARGET_URL,
      Action: 'login',
    }).toString();
    const res = await this.transport.request({
      method: 'POST',
      path: LOGIN_PATH,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: jar.header() },
      body,
      redirect: 'manual',
    });
    jar.absorb(res.setCookie);
    const redirectedToDest = (res.status === 301 || res.status === 302) && !!res.location && !/login\.asp/i.test(res.location);
    if (!redirectedToDest || jar.size === 0) {
      throw new McpToolError(
        'Artsonia login failed — check your ARTSONIA_USERNAME / ARTSONIA_PASSWORD credentials.',
        { hint: 'Verify the email/password are correct. Magic-link-only accounts are not supported by this server.' },
      );
    }
    return { jar };
  }

  /** Absorb refreshed cookies from a normal response (post-redirect Set-Cookie). */
  absorb(setCookie: string[]): void {
    if (setCookie.length) this.session.current?.jar.absorb(setCookie);
  }

  /** Mark the session dead so the next ensureLogin re-authenticates. */
  invalidate(): void {
    this.session.invalidate();
  }
}
