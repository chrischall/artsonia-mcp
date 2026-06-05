import { readEnvVar, SessionNotAuthenticatedError } from '@chrischall/mcp-utils';
import { McpToolError } from '@chrischall/mcp-utils';
import { CookieJar } from './cookies.js';
import type { ArtsoniaTransport } from './transport.js';

const LOGIN_PATH = '/members/login.asp';
const TARGET_URL = '/members/';

export interface AuthOptions {
  username?: string;
  password?: string;
}

// Owns the username/password login and the resulting cookie session. Deferred
// config: constructing with no creds is fine; the error surfaces at ensureLogin.
// Single-flight: concurrent ensureLogin() calls share one in-flight login.
export class AuthManager {
  private readonly jar = new CookieJar();
  private readonly username: string | null;
  private readonly password: string | null;
  private readonly configError: Error | null;
  private loggedIn = false;
  private inflight: Promise<void> | null = null;

  constructor(private readonly transport: ArtsoniaTransport, opts: AuthOptions) {
    const username = opts.username ?? readEnvVar('ARTSONIA_USERNAME') ?? null;
    const password = opts.password ?? readEnvVar('ARTSONIA_PASSWORD') ?? null;
    this.username = username;
    this.password = password;
    this.configError = username && password ? null : new Error(
      'ARTSONIA_USERNAME and ARTSONIA_PASSWORD environment variables are required',
    );
  }

  cookieHeader(): string {
    return this.jar.header();
  }

  hasSession(): boolean {
    return this.loggedIn && this.jar.size > 0;
  }

  async ensureLogin(): Promise<void> {
    if (this.hasSession()) return;
    await this.forceRelogin();
  }

  async forceRelogin(): Promise<void> {
    if (this.configError) throw this.configError;
    if (this.inflight) return this.inflight;
    this.inflight = this.doLogin().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async doLogin(): Promise<void> {
    const body = new URLSearchParams({
      Username: this.username!,
      Password: this.password!,
      TargetUrl: TARGET_URL,
      Action: 'login',
    }).toString();
    const res = await this.transport.request({
      method: 'POST',
      path: LOGIN_PATH,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: this.jar.header() },
      body,
      redirect: 'manual',
    });
    this.jar.setFromHeaders(res.setCookie);
    const redirectedToDest = (res.status === 301 || res.status === 302) && !!res.location && !/login\.asp/i.test(res.location);
    if (!redirectedToDest || this.jar.size === 0) {
      // SessionNotAuthenticatedError generates: "Not signed in to Artsonia. Sign in in your
      // browser, then try again." — matches /sign in/i required by the test assertion.
      throw new SessionNotAuthenticatedError('Artsonia');
    }
    this.loggedIn = true;
  }

  /** Absorb refreshed cookies from a normal response (post-redirect Set-Cookie). */
  absorb(setCookie: string[]): void {
    if (setCookie.length) this.jar.setFromHeaders(setCookie);
  }

  /** Mark the session dead so the next ensureLogin re-authenticates. */
  invalidate(): void {
    this.loggedIn = false;
  }
}
