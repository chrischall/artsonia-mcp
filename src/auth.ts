import { readEnvVar, McpToolError } from '@chrischall/mcp-utils';
import { CookieSessionManager } from '@chrischall/mcp-utils/session';
import { CookieJar } from './cookies.js';
import type { ArtsoniaTransport } from './transport.js';

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

// Owns the username/password login and the resulting cookie session. Deferred
// config: constructing with no creds is fine; the error surfaces at ensureLogin.
//
// The single-flight login + invalidate/re-login machinery is delegated to the
// shared CookieSessionManager (direct/username+password mode only). The
// fetchproxy/browser-session path never touches this class — there the browser
// tab carries the session and server-side login is skipped entirely (see
// ArtsoniaClient).
export class AuthManager {
  private readonly username: string | null;
  private readonly password: string | null;
  private readonly configError: Error | null;
  private readonly session: CookieSessionManager<ArtsoniaSession>;

  constructor(private readonly transport: ArtsoniaTransport, opts: AuthOptions) {
    const username = opts.username ?? readEnvVar('ARTSONIA_USERNAME') ?? null;
    const password = opts.password ?? readEnvVar('ARTSONIA_PASSWORD') ?? null;
    this.username = username;
    this.password = password;
    this.configError = username && password ? null : new Error(
      'ARTSONIA_USERNAME and ARTSONIA_PASSWORD environment variables are required',
    );
    this.session = new CookieSessionManager<ArtsoniaSession>({
      login: () => this.doLogin(),
      // Expiry detection lives in the client (redirect-away-to-login), which
      // invalidates + re-logs-in explicitly. The manager-driven replay is not
      // used for the request path, so no response ever flows through here.
      isExpired: () => false,
      // A missing-creds config error can never recover without new config — cache
      // it permanently so concurrent/later ensure() calls rethrow it immediately.
      isPermanentError: (err) =>
        err instanceof Error && (err as { [CONFIG_ERROR_MARKER]?: true })[CONFIG_ERROR_MARKER] === true,
    });
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
    jar.setFromHeaders(res.setCookie);
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
    if (setCookie.length) this.session.current?.jar.setFromHeaders(setCookie);
  }

  /** Mark the session dead so the next ensureLogin re-authenticates. */
  invalidate(): void {
    this.session.invalidate();
  }
}
