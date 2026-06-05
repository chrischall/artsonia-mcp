# artsonia-mcp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `artsonia-mcp`, an MCP server that logs into a parent/fan's Artsonia account with a username/password and exposes read tools (students, portfolio, artwork, comments, fans, activity) plus three confirm-gated write tools (post comment, invite fan, set notifications).

**Architecture:** Cookie-session direct-fetch. An `AuthManager` POSTs the verified login form to `/members/login.asp` and holds an HttpOnly session cookie in a `CookieJar`; an `ArtsoniaClient` fetches server-rendered HTML over a pluggable `ArtsoniaTransport` (default: node `fetch`; optional `fetchproxy` fallback) and parses it with `node-html-parser`. Writes are form-urlencoded POSTs through the same session, gated by `confirm`. The deferred-config-error pattern lets the server boot without creds.

**Tech Stack:** TypeScript (ESM + NodeNext), `@chrischall/mcp-utils`, `@modelcontextprotocol/sdk`, `node-html-parser`, `zod` v4, `vitest`, `esbuild`. Node 26 in CI; mcpb runtime floor Node ≥22.5.

**Reference:** verified endpoints + login flow are in `docs/ARTSONIA-API.md`; design rationale in `docs/superpowers/specs/2026-06-05-artsonia-mcp-design.md`. Copy conventions from `~/git/splitwise-mcp` (client/index/tests) and `~/git/evite-mcp` (confirm-gated writes).

---

## File structure

```
src/
  version.ts              # single VERSION constant (x-release-please-version marker)
  cookies.ts              # CookieJar: parse Set-Cookie, serialize Cookie header
  transport.ts            # ArtsoniaTransport interface + makeTransport(env) factory
  transport-fetch.ts      # default: node fetch, base www.artsonia.com, per-request redirect mode
  transport-fetchproxy.ts # optional fallback (ARTSONIA_TRANSPORT=fetchproxy)
  auth.ts                 # AuthManager: env creds, login(), cookie session, re-login
  client.ts               # ArtsoniaClient.fetchHtml()/write() + module singleton
  parse.ts                # HTML parsers (students, portfolio, artwork, comments, fans, notifications)
  index.ts                # runMcp wiring
  tools/
    healthcheck.ts        # artsonia_healthcheck
    students.ts           # artsonia_list_students, artsonia_get_activity
    portfolio.ts          # artsonia_get_portfolio, artsonia_get_artwork, artsonia_list_comments
    fans.ts               # artsonia_get_fans
    writes.ts             # artsonia_post_comment, artsonia_invite_fan, artsonia_set_notifications
tests/
  helpers.ts              # re-export createTestHarness
  cookies.test.ts
  transport-fetch.test.ts
  auth.test.ts
  client.test.ts
  parse.test.ts
  tools/{healthcheck,students,portfolio,fans,writes}.test.ts
  version-sync.test.ts
  fixtures/*.html
packaging: package.json, tsconfig.json, vitest.config.ts, .gitignore, .env.example,
  manifest.json, server.json, .mcp.json, .mcpbignore,
  .claude-plugin/{plugin.json,marketplace.json}, skills/artsonia-mcp/SKILL.md,
  release-please-config.json, .release-please-manifest.json,
  .github/workflows/*, .github/dependabot.yml
```

Conventions: every relative import ends in `.js`. All tool handlers return `textResult(data)`. Errors are typed `McpToolError` subclasses with an actionable `hint`. Tests never hit the real network (inject a fake transport / spy on the client singleton).

---

## Phase 0 — Scaffold

### Task 1: Project scaffold and config

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `src/version.ts`, `tests/version-sync.test.ts`, `tests/helpers.ts`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "artsonia-mcp",
  "version": "0.1.0",
  "mcpName": "io.github.chrischall/artsonia-mcp",
  "description": "Artsonia MCP server for Claude — developed and maintained by AI (Claude Code)",
  "author": "Claude Code (AI) <https://www.anthropic.com/claude>",
  "repository": { "type": "git", "url": "git+https://github.com/chrischall/artsonia-mcp.git" },
  "license": "MIT",
  "keywords": ["mcp", "model-context-protocol", "claude", "ai", "artsonia", "student-art", "portfolio", "parent"],
  "type": "module",
  "bin": { "artsonia-mcp": "dist/index.js" },
  "files": ["dist", ".claude-plugin", "skills", ".mcp.json", "server.json", "manifest.json"],
  "scripts": {
    "build": "tsc && npm run bundle",
    "bundle": "esbuild src/index.ts --bundle --platform=node --format=esm --external:dotenv --external:@fetchproxy/server --outfile=dist/bundle.js",
    "dev": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  },
  "dependencies": {
    "@chrischall/mcp-utils": "^0.5.0",
    "@fetchproxy/server": "^1.2.0",
    "@modelcontextprotocol/sdk": "^1.29.0",
    "dotenv": "^17.4.0",
    "node-html-parser": "^7.0.1",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/node": "^25.9.1",
    "@vitest/coverage-v8": "^4.1.7",
    "esbuild": "^0.28.0",
    "typescript": "^6.0.3",
    "vitest": "^4.1.7"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
```

- [ ] **Step 4: Write `.gitignore` and `.env.example`**

`.gitignore`:
```
node_modules/
dist/
.env
.env.*
!.env.example
*.tgz
coverage/
```

`.env.example`:
```
ARTSONIA_USERNAME=you@example.com
ARTSONIA_PASSWORD=your-password
# ARTSONIA_TRANSPORT=fetch   # or "fetchproxy" (optional fallback)
# ARTSONIA_WS_PORT=37149     # only used when ARTSONIA_TRANSPORT=fetchproxy
```

- [ ] **Step 5: Write `src/version.ts`**

```ts
// Single source of truth for the server version. The marker is what
// release-please bumps; versionSyncTest asserts it equals package.json.
export const VERSION = '0.1.0'; // x-release-please-version
```

- [ ] **Step 6: Write `tests/helpers.ts` and `tests/version-sync.test.ts`**

`tests/helpers.ts`:
```ts
export { createTestHarness } from '@chrischall/mcp-utils/test';
```

`tests/version-sync.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { versionSyncTest } from '@chrischall/mcp-utils/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('version sync', () => {
  it('every `x-release-please-version` annotation matches package.json', () => {
    const mismatches = versionSyncTest({ srcDir: join(ROOT, 'src'), pkgPath: join(ROOT, 'package.json') });
    expect(mismatches, mismatches.join('\n')).toEqual([]);
  });
});
```

- [ ] **Step 7: Install deps and run the test**

Run: `npm install && npx vitest run tests/version-sync.test.ts`
Expected: PASS (1 test). If `@chrischall/mcp-utils@^0.5.0` is unpublished, temporarily use `file:../mcp-utils/<tarball>` per the skill, then revert before release.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold artsonia-mcp project config"
```

---

## Phase 1 — Cookie jar

### Task 2: CookieJar

**Files:**
- Create: `src/cookies.ts`, `tests/cookies.test.ts`

- [ ] **Step 1: Write the failing test** (`tests/cookies.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { CookieJar } from '../src/cookies.js';

describe('CookieJar', () => {
  it('parses name=value from Set-Cookie lines, ignoring attributes', () => {
    const jar = new CookieJar();
    jar.setFromHeaders([
      'ASPSESSIONID=abc123; path=/; HttpOnly',
      'AID=42; expires=Wed, 09 Jun 2027 10:18:14 GMT; path=/',
    ]);
    expect(jar.header()).toBe('ASPSESSIONID=abc123; AID=42');
    expect(jar.size).toBe(2);
  });

  it('later Set-Cookie for the same name overwrites the earlier value', () => {
    const jar = new CookieJar();
    jar.setFromHeaders(['SID=old; path=/']);
    jar.setFromHeaders(['SID=new; path=/']);
    expect(jar.header()).toBe('SID=new');
  });

  it('ignores blank / malformed lines and returns empty header when empty', () => {
    const jar = new CookieJar();
    jar.setFromHeaders(['', '   ', 'novalue']);
    expect(jar.header()).toBe('');
    expect(jar.size).toBe(0);
  });

  it('drops a cookie whose value is "deleted" with an expiry in the past', () => {
    const jar = new CookieJar();
    jar.setFromHeaders(['SID=real; path=/']);
    jar.setFromHeaders(['SID=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/']);
    expect(jar.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cookies.test.ts`
Expected: FAIL ("Cannot find module '../src/cookies.js'").

- [ ] **Step 3: Write `src/cookies.ts`**

```ts
// Minimal cookie jar for Artsonia's session cookies. We only need name=value
// pairs for the Cookie request header — attributes (path/expires/HttpOnly) are
// parsed only to detect deletion (empty value + past expiry).
export class CookieJar {
  private readonly jar = new Map<string, string>();

  setFromHeaders(setCookie: string[]): void {
    for (const line of setCookie) {
      const trimmed = (line ?? '').trim();
      if (!trimmed) continue;
      const [pair, ...attrs] = trimmed.split(';');
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!name) continue;
      const isDeletion = value === '' && attrs.some((a) => /expires=/i.test(a) && /1970/.test(a));
      if (isDeletion) { this.jar.delete(name); continue; }
      this.jar.set(name, value);
    }
  }

  header(): string {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  get size(): number {
    return this.jar.size;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cookies.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/cookies.ts tests/cookies.test.ts
git commit -m "feat: add CookieJar for session cookies"
```

---

## Phase 2 — Transport

### Task 3: Transport interface + node-fetch transport

**Files:**
- Create: `src/transport.ts`, `src/transport-fetch.ts`, `tests/transport-fetch.test.ts`

- [ ] **Step 1: Write `src/transport.ts` (interface + factory)**

```ts
import { readEnvVar } from '@chrischall/mcp-utils';

export interface ArtsoniaRequest {
  method: 'GET' | 'POST';
  /** Path-and-query relative to https://www.artsonia.com, or an absolute URL. */
  path: string;
  headers?: Record<string, string>;
  /** Serialized request body (form-urlencoded). Omitted for GET. */
  body?: string;
  /** 'follow' (default) for reads; 'manual' for the login POST so the 302's Set-Cookie is readable. */
  redirect?: 'follow' | 'manual';
}

export interface ArtsoniaResponse {
  status: number;
  body: string;
  /** Final URL after redirects (used to detect login redirects). */
  url: string;
  /** Set-Cookie header lines from this response. */
  setCookie: string[];
  /** Location header (present on a manual 3xx). */
  location?: string;
}

export interface ArtsoniaTransport {
  request(req: ArtsoniaRequest): Promise<ArtsoniaResponse>;
}

export const ARTSONIA_ORIGIN = 'https://www.artsonia.com';

export async function makeTransport(): Promise<ArtsoniaTransport> {
  const mode = readEnvVar('ARTSONIA_TRANSPORT') ?? 'fetch';
  if (mode === 'fetchproxy') {
    const { FetchproxyArtsoniaTransport } = await import('./transport-fetchproxy.js');
    return new FetchproxyArtsoniaTransport();
  }
  const { FetchArtsoniaTransport } = await import('./transport-fetch.js');
  return new FetchArtsoniaTransport();
}
```

- [ ] **Step 2: Write the failing test** (`tests/transport-fetch.test.ts`)

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { FetchArtsoniaTransport } from '../src/transport-fetch.js';

function mockFetch(impl: (url: string, init: any) => Response) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(((url: any, init: any) =>
    Promise.resolve(impl(String(url), init))) as any);
}

afterEach(() => vi.restoreAllMocks());

describe('FetchArtsoniaTransport', () => {
  it('prefixes relative paths with the artsonia origin and returns body+url', async () => {
    let seenUrl = '';
    mockFetch((url) => { seenUrl = url; return new Response('<html>ok</html>', { status: 200 }); });
    const t = new FetchArtsoniaTransport();
    const res = await t.request({ method: 'GET', path: '/members/' });
    expect(seenUrl).toBe('https://www.artsonia.com/members/');
    expect(res.status).toBe(200);
    expect(res.body).toContain('ok');
  });

  it('collects Set-Cookie lines and the Location header on a manual redirect', async () => {
    mockFetch(() => new Response('', {
      status: 302,
      headers: { 'set-cookie': 'SID=xyz; path=/; HttpOnly', location: '/members/' },
    }));
    const t = new FetchArtsoniaTransport();
    const res = await t.request({ method: 'POST', path: '/members/login.asp', body: 'a=b', redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.setCookie.some((c) => c.startsWith('SID=xyz'))).toBe(true);
    expect(res.location).toBe('/members/');
  });
});
```

> Note: `Response` in undici exposes `headers.getSetCookie()`. The single-line `set-cookie` above is read via that API in the implementation.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/transport-fetch.test.ts`
Expected: FAIL ("Cannot find module '../src/transport-fetch.js'").

- [ ] **Step 4: Write `src/transport-fetch.ts`**

```ts
import { ARTSONIA_ORIGIN, type ArtsoniaRequest, type ArtsoniaResponse, type ArtsoniaTransport } from './transport.js';

const DEFAULT_TIMEOUT_MS = 30_000;

// Default transport: node fetch against the user's cookie session. The login
// POST passes redirect:'manual' so its 302's Set-Cookie is readable; reads use
// redirect:'follow' and detect login-redirects by the final URL/body.
export class FetchArtsoniaTransport implements ArtsoniaTransport {
  async request(req: ArtsoniaRequest): Promise<ArtsoniaResponse> {
    const url = req.path.startsWith('http') ? req.path : `${ARTSONIA_ORIGIN}${req.path}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: req.method,
        headers: req.headers,
        body: req.body,
        redirect: req.redirect ?? 'follow',
        signal: ac.signal,
      });
      const body = await res.text();
      const setCookie = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
      const location = res.headers.get('location') ?? undefined;
      return { status: res.status, body, url: res.url || url, setCookie, location };
    } finally {
      clearTimeout(timer);
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/transport-fetch.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/transport.ts src/transport-fetch.ts tests/transport-fetch.test.ts
git commit -m "feat: add transport interface and node-fetch transport"
```

### Task 4: Optional fetchproxy transport (thin)

**Files:**
- Create: `src/transport-fetchproxy.ts`

- [ ] **Step 1: Write `src/transport-fetchproxy.ts`** (no test — exercised only when explicitly enabled; covered manually)

```ts
import { FetchproxyServer, type FetchproxyServerOpts } from '@fetchproxy/server';
import { ARTSONIA_ORIGIN, type ArtsoniaRequest, type ArtsoniaResponse, type ArtsoniaTransport } from './transport.js';
import { readEnvVar } from '@chrischall/mcp-utils';
import { VERSION } from './version.js';

const DEFAULT_PORT = 37_149; // shared fleet port — do NOT change

// Optional fallback transport: route requests through the user's signed-in
// browser tab via @fetchproxy/server. Engaged only when ARTSONIA_TRANSPORT=
// fetchproxy. Cookies are carried by the browser, so the AuthManager's jar is
// unused in this mode; login is whatever the browser already holds.
export class FetchproxyArtsoniaTransport implements ArtsoniaTransport {
  private readonly inner: FetchproxyServer;
  private started = false;

  constructor() {
    const portEnv = readEnvVar('ARTSONIA_WS_PORT');
    const opts: FetchproxyServerOpts = {
      port: portEnv ? Number(portEnv) : DEFAULT_PORT,
      serverName: 'artsonia-mcp',
      version: VERSION,
      domains: ['artsonia.com'],
      capabilities: ['fetch'] as const,
    };
    this.inner = new FetchproxyServer(opts);
  }

  private async ensureStarted(): Promise<void> {
    if (this.started) return;
    await this.inner.listen();
    this.started = true;
  }

  async request(req: ArtsoniaRequest): Promise<ArtsoniaResponse> {
    await this.ensureStarted();
    const url = req.path.startsWith('http') ? req.path : `${ARTSONIA_ORIGIN}${req.path}`;
    const r = await this.inner.request(req.method, url, { headers: req.headers, body: req.body });
    return { status: r.status, body: r.body, url: r.url, setCookie: [] };
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If `@fetchproxy/server`'s `request()` signature differs, adapt to match `~/git/musescore-mcp/src/transport-fetchproxy.ts`.)

- [ ] **Step 3: Commit**

```bash
git add src/transport-fetchproxy.ts
git commit -m "feat: add optional fetchproxy fallback transport"
```

---

## Phase 3 — Auth

### Task 5: AuthManager (login + session)

**Files:**
- Create: `src/auth.ts`, `tests/auth.test.ts`

- [ ] **Step 1: Write the failing test** (`tests/auth.test.ts`)

```ts
import { describe, it, expect, vi } from 'vitest';
import { AuthManager } from '../src/auth.js';
import type { ArtsoniaRequest, ArtsoniaResponse, ArtsoniaTransport } from '../src/transport.js';

function fakeTransport(handler: (req: ArtsoniaRequest) => ArtsoniaResponse): ArtsoniaTransport & { calls: ArtsoniaRequest[] } {
  const calls: ArtsoniaRequest[] = [];
  return { calls, request: async (req) => { calls.push(req); return handler(req); } };
}

const okLogin = (): ArtsoniaResponse => ({ status: 302, body: '', url: 'https://www.artsonia.com/members/login.asp', setCookie: ['SID=good; path=/; HttpOnly'], location: '/members/' });

describe('AuthManager', () => {
  it('throws a deferred config error when creds are missing', async () => {
    const t = fakeTransport(okLogin);
    const auth = new AuthManager(t, {}); // no username/password
    await expect(auth.ensureLogin()).rejects.toThrow(/ARTSONIA_USERNAME/);
  });

  it('posts the verified login form and captures the session cookie', async () => {
    const t = fakeTransport(okLogin);
    const auth = new AuthManager(t, { username: 'u@example.com', password: 'pw' });
    await auth.ensureLogin();
    const post = t.calls[0];
    expect(post.method).toBe('POST');
    expect(post.path).toBe('/members/login.asp');
    expect(post.redirect).toBe('manual');
    expect(post.headers?.['Content-Type']).toBe('application/x-www-form-urlencoded');
    // body carries the four verified fields, url-encoded
    expect(post.body).toContain('Username=u%40example.com');
    expect(post.body).toContain('Password=pw');
    expect(post.body).toContain('Action=login');
    expect(post.body).toContain('TargetUrl=%2Fmembers%2F');
    expect(auth.cookieHeader()).toBe('SID=good');
  });

  it('does not log in twice when already authenticated', async () => {
    const t = fakeTransport(okLogin);
    const auth = new AuthManager(t, { username: 'u@example.com', password: 'pw' });
    await auth.ensureLogin();
    await auth.ensureLogin();
    expect(t.calls.length).toBe(1);
  });

  it('throws SessionNotAuthenticatedError when login is rejected (200 re-render, no redirect)', async () => {
    const t = fakeTransport(() => ({ status: 200, body: 'Parent (or Fan) Login', url: 'https://www.artsonia.com/members/login.asp', setCookie: [] }));
    const auth = new AuthManager(t, { username: 'u@example.com', password: 'bad' });
    await expect(auth.ensureLogin()).rejects.toThrow(/credentials|sign in|log in/i);
  });

  it('forceRelogin() re-posts even if a session already exists', async () => {
    const t = fakeTransport(okLogin);
    const auth = new AuthManager(t, { username: 'u@example.com', password: 'pw' });
    await auth.ensureLogin();
    await auth.forceRelogin();
    expect(t.calls.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/auth.test.ts`
Expected: FAIL ("Cannot find module '../src/auth.js'").

- [ ] **Step 3: Write `src/auth.ts`**

```ts
import { readEnvVar, SessionNotAuthenticatedError } from '@chrischall/mcp-utils';
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
      throw new SessionNotAuthenticatedError(
        'Artsonia login failed — check ARTSONIA_USERNAME / ARTSONIA_PASSWORD. (Magic-link-only accounts are not supported.)',
      );
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
```

> If `SessionNotAuthenticatedError`'s constructor signature in `@chrischall/mcp-utils` doesn't accept a message string, check its export and adapt (e.g. construct then assign `.message`, or use `createHelpfulError`). Verify with `npx tsc --noEmit`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/auth.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/auth.ts tests/auth.test.ts
git commit -m "feat: add AuthManager username/password login"
```

---

## Phase 4 — Client

### Task 6: ArtsoniaClient

**Files:**
- Create: `src/client.ts`, `tests/client.test.ts`

- [ ] **Step 1: Write the failing test** (`tests/client.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { ArtsoniaClient } from '../src/client.js';
import { AuthManager } from '../src/auth.js';
import type { ArtsoniaRequest, ArtsoniaResponse, ArtsoniaTransport } from '../src/transport.js';

function scriptedTransport(steps: Array<(req: ArtsoniaRequest) => ArtsoniaResponse>): ArtsoniaTransport & { calls: ArtsoniaRequest[] } {
  const calls: ArtsoniaRequest[] = [];
  let i = 0;
  return { calls, request: async (req) => { calls.push(req); const step = steps[Math.min(i, steps.length - 1)]; i++; return step(req); } };
}

const loginOk = (): ArtsoniaResponse => ({ status: 302, body: '', url: 'https://www.artsonia.com/members/login.asp', setCookie: ['SID=good'], location: '/members/' });

function makeClient(t: ArtsoniaTransport) {
  const auth = new AuthManager(t, { username: 'u@example.com', password: 'pw' });
  return new ArtsoniaClient({ transport: t, auth });
}

describe('ArtsoniaClient.fetchHtml', () => {
  it('logs in first, then GETs the path with the session cookie', async () => {
    const t = scriptedTransport([loginOk, () => ({ status: 200, body: '<html>dash</html>', url: 'https://www.artsonia.com/members/', setCookie: [] })]);
    const html = await makeClient(t).fetchHtml('/members/');
    expect(html).toContain('dash');
    const get = t.calls[1];
    expect(get.method).toBe('GET');
    expect(get.headers?.Cookie).toBe('SID=good');
  });

  it('re-logs-in once and retries when a read redirects back to login', async () => {
    const t = scriptedTransport([
      loginOk,
      () => ({ status: 200, body: 'You need to log in to continue.', url: 'https://www.artsonia.com/members/login.asp', setCookie: [] }),
      loginOk,
      () => ({ status: 200, body: '<html>dash</html>', url: 'https://www.artsonia.com/members/', setCookie: [] }),
    ]);
    const html = await makeClient(t).fetchHtml('/members/');
    expect(html).toContain('dash');
    expect(t.calls.filter((c) => c.path === '/members/login.asp').length).toBe(2);
  });

  it('throws when still unauthenticated after one re-login', async () => {
    const t = scriptedTransport([loginOk, () => ({ status: 200, body: 'You need to log in', url: 'https://www.artsonia.com/members/login.asp', setCookie: [] })]);
    await expect(makeClient(t).fetchHtml('/members/')).rejects.toThrow(/log in|sign in|authenticated/i);
  });

  it('write() posts form-urlencoded with the session cookie', async () => {
    const t = scriptedTransport([loginOk, () => ({ status: 302, body: '', url: 'https://www.artsonia.com/members/', setCookie: [], location: '/members/' })]);
    const res = await makeClient(t).write('/museum/enter.asp?artist=1&art=2', 'Comment=hi');
    expect(res.status).toBe(302);
    const post = t.calls[1];
    expect(post.method).toBe('POST');
    expect(post.headers?.['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(post.headers?.Cookie).toBe('SID=good');
    expect(post.body).toBe('Comment=hi');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/client.test.ts`
Expected: FAIL ("Cannot find module '../src/client.js'").

- [ ] **Step 3: Write `src/client.ts`**

```ts
import { loadDotenvSafely, readEnvVar, SessionNotAuthenticatedError, McpToolError } from '@chrischall/mcp-utils';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthManager } from './auth.js';
import { makeTransport, type ArtsoniaResponse, type ArtsoniaTransport } from './transport.js';

const LOGIN_RE = /\/members\/login\.asp/i;
const LOGIN_BODY_RE = /You need to log in|Parent \(or Fan\) Login/i;

function looksUnauthenticated(res: ArtsoniaResponse): boolean {
  return LOGIN_RE.test(res.url) || LOGIN_BODY_RE.test(res.body);
}

export interface ArtsoniaClientOptions {
  transport: ArtsoniaTransport;
  auth: AuthManager;
}

// Thin, tool-facing API over a transport + AuthManager. Reads go through
// fetchHtml(); writes through write(). Both ensure a live session and retry
// once across a re-login if the response looks unauthenticated.
export class ArtsoniaClient {
  private readonly transport: ArtsoniaTransport;
  private readonly auth: AuthManager;

  constructor(opts: ArtsoniaClientOptions) {
    this.transport = opts.transport;
    this.auth = opts.auth;
  }

  async fetchHtml(path: string): Promise<string> {
    return (await this.requestWithSession('GET', path)).body;
  }

  async write(path: string, body: string): Promise<ArtsoniaResponse> {
    return this.requestWithSession('POST', path, body);
  }

  private async requestWithSession(method: 'GET' | 'POST', path: string, body?: string): Promise<ArtsoniaResponse> {
    await this.auth.ensureLogin();
    let res = await this.send(method, path, body);
    if (looksUnauthenticated(res)) {
      this.auth.invalidate();
      await this.auth.forceRelogin();
      res = await this.send(method, path, body);
      if (looksUnauthenticated(res)) {
        throw new SessionNotAuthenticatedError('Artsonia session could not be (re)established — check your credentials.');
      }
    }
    this.auth.absorb(res.setCookie);
    if (res.status >= 400) {
      throw new McpToolError(`Artsonia request failed: ${method} ${path} → HTTP ${res.status}`, { hint: 'Retry; if it persists the page may have moved or requires a different account.' });
    }
    return res;
  }

  private send(method: 'GET' | 'POST', path: string, body?: string): Promise<ArtsoniaResponse> {
    const headers: Record<string, string> = { Cookie: this.auth.cookieHeader() };
    if (method === 'POST') headers['Content-Type'] = 'application/x-www-form-urlencoded';
    return this.transport.request({ method, path, headers, body, redirect: method === 'POST' ? 'manual' : 'follow' });
  }
}

// Module singleton, constructed in this module (not index.ts) so the
// deferred-config-error pattern holds: the server boots and answers tools/list
// even with no creds; the config error surfaces on the first tool call.
const __dirname = dirname(fileURLToPath(import.meta.url));
await loadDotenvSafely({ path: join(__dirname, '..', '.env'), override: false });

const transport = await makeTransport();
export const client = new ArtsoniaClient({
  transport,
  auth: new AuthManager(transport, {
    username: readEnvVar('ARTSONIA_USERNAME'),
    password: readEnvVar('ARTSONIA_PASSWORD'),
  }),
});
```

> If `McpToolError`'s constructor signature differs (e.g. options shape), adjust per `@chrischall/mcp-utils` `errors`. Verify with `npx tsc --noEmit`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/client.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/client.ts tests/client.test.ts
git commit -m "feat: add ArtsoniaClient with session-aware fetch/write"
```

---

## Phase 5 — Parsers

### Task 7: HTML parsers

**Files:**
- Create: `src/parse.ts`, `tests/parse.test.ts`, `tests/fixtures/*.html`

Parsers operate on raw server-rendered HTML. Selectors are from `docs/ARTSONIA-API.md`: students `.artist-card` (portfolio link `portfolio.asp?id=<artistId>`); portfolio `.grid-item` with `art.asp?id=<artworkId>` links; fans `.fan-card`/`.fan-row`; notifications on `/members/`.

- [ ] **Step 1: Write the fixtures**

`tests/fixtures/dashboard.html` (minimal, mirrors verified structure):
```html
<!doctype html><html><body>
<section class="notifications">
  <h2>Notifications (2)</h2>
  <a class="notice" href="/members/comments/?artist=13447141"><span class="notice-title">View teacher feedback for Lucas</span><span class="notice-body">A new comment is waiting.</span></a>
  <a class="notice" href="/members/fanclub/add.asp?artist=16011097"><span class="notice-title">Add family to Finn's Fan Club</span><span class="notice-body">Invite more fans.</span></a>
</section>
<div class="family">
  <div class="artist-card">
    <a href="/artists/portfolio.asp?id=16011097">View Portfolio</a>
    <span class="artist-name">Finn Hall</span>
    <span class="artist-school">Metrolina Regional Scholars Academy (Grade 1)</span>
    <span class="stat-artworks">46 artworks</span><span class="stat-fans">2 fans</span>
  </div>
  <div class="artist-card">
    <a href="/artists/portfolio.asp?id=13447141">View Portfolio</a>
    <span class="artist-name">Lucas Hall</span>
    <span class="artist-school">Metrolina Regional Scholars Academy (Grade 6)</span>
    <span class="stat-artworks">54 artworks</span><span class="stat-fans">2 fans</span>
  </div>
</div>
</body></html>
```

`tests/fixtures/portfolio.html`:
```html
<!doctype html><html><body>
<div class="grid">
  <div class="grid-item"><a href="/museum/art.asp?id=150567537"><img class="grid-item-image" src="https://images.artsonia.com/art/small/150567537.jpg"><span class="textLabel">My silhouette still life</span></a></div>
  <div class="grid-item"><a href="/museum/art.asp?id=148945137"><img class="grid-item-image" src="https://images.artsonia.com/art/small/148945137.jpg"><span class="textLabel private-art">Hidden piece</span></a></div>
</div>
</body></html>
```

`tests/fixtures/artwork.html`:
```html
<!doctype html><html><head><title>Artsonia Art Museum :: "My silhouette still life" by Lucas26251</title></head><body>
<h1>Lucas26251's artwork</h1>
<span class="artwork-views">4 artwork views</span>
<div class="artwork-description">Still life with watering cans.</div>
<a class="lightlink" href="/members/comments/enter.asp?artist=13447141&art=150567537">Comment on Lucas26251</a>
<ul class="comments">
  <li class="comment"><span class="comment-author">Grandma</span><span class="comment-text">Beautiful!</span></li>
</ul>
</body></html>
```

`tests/fixtures/fans.html`:
```html
<!doctype html><html><body>
<div class="fan-group">
  <div class="card fan-card"><span class="fan-name">Chris Hall</span><span class="fan-relation">Father</span></div>
  <div class="card fan-card"><span class="fan-name">Grandma Jo</span><span class="fan-relation">Grandparent</span></div>
</div>
</body></html>
```

- [ ] **Step 2: Write the failing test** (`tests/parse.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStudents, parseNotifications, parsePortfolio, parseArtwork, parseFans } from '../src/parse.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fx = (name: string) => readFileSync(join(FIX, name), 'utf8');

describe('parseStudents', () => {
  it('extracts artistId, name, school, grade and counts from .artist-card', () => {
    const students = parseStudents(fx('dashboard.html'));
    expect(students).toHaveLength(2);
    expect(students[0]).toMatchObject({ artist_id: '16011097', name: 'Finn Hall', grade: '1', artwork_count: 46 });
    expect(students[1]).toMatchObject({ artist_id: '13447141', name: 'Lucas Hall', grade: '6' });
    expect(students[0].school).toContain('Metrolina');
  });
});

describe('parseNotifications', () => {
  it('extracts the count and notice items', () => {
    const n = parseNotifications(fx('dashboard.html'));
    expect(n.count).toBe(2);
    expect(n.items).toHaveLength(2);
    expect(n.items[0]).toMatchObject({ title: "View teacher feedback for Lucas", href: '/members/comments/?artist=13447141' });
  });
});

describe('parsePortfolio', () => {
  it('extracts artworkId, title, private flag, thumbnail from .grid-item', () => {
    const art = parsePortfolio(fx('portfolio.html'));
    expect(art).toHaveLength(2);
    expect(art[0]).toMatchObject({ artwork_id: '150567537', title: 'My silhouette still life', is_private: false, thumbnail: 'https://images.artsonia.com/art/small/150567537.jpg' });
    expect(art[1].is_private).toBe(true);
  });
});

describe('parseArtwork', () => {
  it('extracts title, artist screen-name, views, description, comment link and comments', () => {
    const a = parseArtwork(fx('artwork.html'));
    expect(a.title).toBe('My silhouette still life');
    expect(a.artist_screen_name).toBe('Lucas26251');
    expect(a.views).toBe(4);
    expect(a.comment_entry).toMatchObject({ artist_id: '13447141', artwork_id: '150567537' });
    expect(a.comments[0]).toMatchObject({ author: 'Grandma', text: 'Beautiful!' });
  });
});

describe('parseFans', () => {
  it('extracts fan name and relationship from .fan-card', () => {
    const fans = parseFans(fx('fans.html'));
    expect(fans).toHaveLength(2);
    expect(fans[1]).toMatchObject({ name: 'Grandma Jo', relationship: 'Grandparent' });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/parse.test.ts`
Expected: FAIL ("Cannot find module '../src/parse.js'").

- [ ] **Step 4: Write `src/parse.ts`**

```ts
import { parse, type HTMLElement } from 'node-html-parser';

const firstIntIn = (s: string | undefined): number | null => {
  const m = (s ?? '').match(/(\d[\d,]*)/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
};
const text = (el: HTMLElement | null): string => (el ? el.text.replace(/\s+/g, ' ').trim() : '');
const attrId = (href: string | undefined, key: string): string | null => {
  const m = (href ?? '').match(new RegExp(`[?&]${key}=(\\d+)`));
  return m ? m[1] : null;
};

export interface Student {
  artist_id: string; name: string; school: string; grade: string | null;
  artwork_count: number | null; fan_count: number | null; portfolio_path: string;
}

export function parseStudents(html: string): Student[] {
  const root = parse(html);
  return root.querySelectorAll('.artist-card').map((card): Student | null => {
    const link = card.querySelector('a[href*="portfolio.asp"]');
    const href = link?.getAttribute('href');
    const artist_id = attrId(href, 'id');
    if (!artist_id) return null;
    const school = text(card.querySelector('.artist-school'));
    const grade = school.match(/Grade\s+(\w+)/i)?.[1] ?? null;
    return {
      artist_id,
      name: text(card.querySelector('.artist-name')),
      school,
      grade,
      artwork_count: firstIntIn(text(card.querySelector('.stat-artworks'))),
      fan_count: firstIntIn(text(card.querySelector('.stat-fans'))),
      portfolio_path: href ?? `/artists/portfolio.asp?id=${artist_id}`,
    };
  }).filter((s): s is Student => s !== null);
}

export interface Notifications { count: number; items: Array<{ title: string; body: string; href: string }>; }

export function parseNotifications(html: string): Notifications {
  const root = parse(html);
  const section = root.querySelector('.notifications');
  const count = firstIntIn(text(section?.querySelector('h2') ?? null)) ?? 0;
  const items = (section?.querySelectorAll('a.notice') ?? []).map((a) => ({
    title: text(a.querySelector('.notice-title')),
    body: text(a.querySelector('.notice-body')),
    href: a.getAttribute('href') ?? '',
  }));
  return { count, items };
}

export interface Artwork { artwork_id: string; title: string; is_private: boolean; thumbnail: string | null; }

export function parsePortfolio(html: string): Artwork[] {
  const root = parse(html);
  return root.querySelectorAll('.grid-item').map((item): Artwork | null => {
    const link = item.querySelector('a[href*="art.asp"]');
    const artwork_id = attrId(link?.getAttribute('href'), 'id');
    if (!artwork_id) return null;
    const label = item.querySelector('.textLabel');
    return {
      artwork_id,
      title: text(label),
      is_private: (label?.getAttribute('class') ?? '').includes('private-art'),
      thumbnail: item.querySelector('img')?.getAttribute('src') ?? null,
    };
  }).filter((a): a is Artwork => a !== null);
}

export interface ArtworkDetail {
  title: string; artist_screen_name: string; views: number | null; description: string;
  comment_entry: { artist_id: string; artwork_id: string } | null;
  comments: Array<{ author: string; text: string }>;
}

export function parseArtwork(html: string): ArtworkDetail {
  const root = parse(html);
  const rawTitle = text(root.querySelector('title'));
  const title = rawTitle.match(/"([^"]+)"/)?.[1] ?? '';
  const screen = rawTitle.match(/by\s+([A-Za-z0-9_]+)/)?.[1] ?? '';
  const link = root.querySelector('a[href*="comments/enter.asp"]');
  const href = link?.getAttribute('href');
  const aId = attrId(href, 'artist');
  const wId = attrId(href, 'art');
  return {
    title,
    artist_screen_name: screen,
    views: firstIntIn(text(root.querySelector('.artwork-views'))),
    description: text(root.querySelector('.artwork-description')),
    comment_entry: aId && wId ? { artist_id: aId, artwork_id: wId } : null,
    comments: root.querySelectorAll('.comment').map((c) => ({
      author: text(c.querySelector('.comment-author')),
      text: text(c.querySelector('.comment-text')),
    })),
  };
}

export interface Fan { name: string; relationship: string; }

export function parseFans(html: string): Fan[] {
  const root = parse(html);
  return root.querySelectorAll('.fan-card').map((c) => ({
    name: text(c.querySelector('.fan-name')),
    relationship: text(c.querySelector('.fan-relation')),
  })).filter((f) => f.name);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/parse.test.ts`
Expected: PASS (5 describes). Adjust selectors only if a real fixture (captured live during verification) reveals different markup — see the verification note at the end.

- [ ] **Step 6: Commit**

```bash
git add src/parse.ts tests/parse.test.ts tests/fixtures
git commit -m "feat: add HTML parsers for students, portfolio, artwork, fans, notifications"
```

---

## Phase 6 — Read tools

### Task 8: Student + activity tools

**Files:**
- Create: `src/tools/students.ts`, `tests/tools/students.test.ts`

- [ ] **Step 1: Write the failing test** (`tests/tools/students.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { registerStudentTools } from '../../src/tools/students.js';
import { client } from '../../src/client.js';
import { createTestHarness } from '../helpers.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const dashboard = readFileSync(join(FIX, 'dashboard.html'), 'utf8');
const mockFetchHtml = vi.spyOn(client, 'fetchHtml');

let harness: Awaited<ReturnType<typeof createTestHarness>>;
beforeEach(() => mockFetchHtml.mockReset());
afterAll(async () => { if (harness) await harness.close(); });

function parse(res: any) { return JSON.parse(res.content[0].text); }

describe('student tools', () => {
  it('setup + registers both tools', async () => {
    harness = await createTestHarness((s) => registerStudentTools(s, client));
    const names = (await harness.listTools()).map((t) => t.name);
    expect(names).toContain('artsonia_list_students');
    expect(names).toContain('artsonia_get_activity');
  });

  it('artsonia_list_students fetches /members/ and returns parsed students', async () => {
    mockFetchHtml.mockResolvedValue(dashboard);
    const out = parse(await harness.callTool('artsonia_list_students'));
    expect(mockFetchHtml).toHaveBeenCalledWith('/members/');
    expect(out.students).toHaveLength(2);
    expect(out.students[0].artist_id).toBe('16011097');
  });

  it('artsonia_get_activity returns notifications', async () => {
    mockFetchHtml.mockResolvedValue(dashboard);
    const out = parse(await harness.callTool('artsonia_get_activity'));
    expect(out.count).toBe(2);
    expect(out.items).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/students.test.ts`
Expected: FAIL ("Cannot find module '../../src/tools/students.js'").

- [ ] **Step 3: Write `src/tools/students.ts`**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { textResult, toolAnnotations } from '@chrischall/mcp-utils';
import type { ArtsoniaClient } from '../client.js';
import { parseStudents, parseNotifications } from '../parse.js';

export function registerStudentTools(server: McpServer, client: ArtsoniaClient): void {
  server.registerTool(
    'artsonia_list_students',
    {
      title: 'List followed students',
      description: 'List the student(s) on your Artsonia parent/fan account with their artist_id, name, school, grade, and artwork/fan counts. The artist_id is the selector used by the portfolio, comments, and fan tools.',
      annotations: toolAnnotations({ title: 'List followed students', readOnlyHint: true, openWorldHint: true }),
      inputSchema: {},
    },
    async () => textResult({ students: parseStudents(await client.fetchHtml('/members/')) }),
  );

  server.registerTool(
    'artsonia_get_activity',
    {
      title: 'Get account notifications',
      description: 'Return the notification/activity feed on the parent dashboard (e.g. new teacher feedback, fan-club prompts), with a count and the list of notices.',
      annotations: toolAnnotations({ title: 'Get account notifications', readOnlyHint: true, openWorldHint: true }),
      inputSchema: {},
    },
    async () => textResult(parseNotifications(await client.fetchHtml('/members/'))),
  );
}
```

> If `toolAnnotations` rejects unknown keys or the signature differs, copy the exact call shape from `~/git/splitwise-mcp/src/tools/user.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tools/students.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/students.ts tests/tools/students.test.ts
git commit -m "feat: add list_students and get_activity tools"
```

### Task 9: Portfolio / artwork / comments tools

**Files:**
- Create: `src/tools/portfolio.ts`, `tests/tools/portfolio.test.ts`

- [ ] **Step 1: Write the failing test** (`tests/tools/portfolio.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { z } from 'zod';
import { registerPortfolioTools } from '../../src/tools/portfolio.js';
import { client } from '../../src/client.js';
import { createTestHarness } from '../helpers.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const portfolio = readFileSync(join(FIX, 'portfolio.html'), 'utf8');
const artwork = readFileSync(join(FIX, 'artwork.html'), 'utf8');
const mockFetchHtml = vi.spyOn(client, 'fetchHtml');

let harness: Awaited<ReturnType<typeof createTestHarness>>;
beforeEach(() => mockFetchHtml.mockReset());
afterAll(async () => { if (harness) await harness.close(); });
const parse = (res: any) => JSON.parse(res.content[0].text);

describe('portfolio tools', () => {
  it('setup + registers three tools', async () => {
    harness = await createTestHarness((s) => registerPortfolioTools(s, client));
    const names = (await harness.listTools()).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['artsonia_get_portfolio', 'artsonia_get_artwork', 'artsonia_list_comments']));
  });

  it('get_portfolio fetches /artists/portfolio.asp?id=<artist_id>', async () => {
    mockFetchHtml.mockResolvedValue(portfolio);
    const out = parse(await harness.callTool('artsonia_get_portfolio', { artist_id: '13447141' }));
    expect(mockFetchHtml).toHaveBeenCalledWith('/artists/portfolio.asp?id=13447141');
    expect(out.artworks).toHaveLength(2);
    expect(out.artworks[1].is_private).toBe(true);
  });

  it('get_artwork fetches /museum/art.asp?id=<artwork_id> and parses detail', async () => {
    mockFetchHtml.mockResolvedValue(artwork);
    const out = parse(await harness.callTool('artsonia_get_artwork', { artwork_id: '150567537' }));
    expect(mockFetchHtml).toHaveBeenCalledWith('/museum/art.asp?id=150567537');
    expect(out.title).toBe('My silhouette still life');
    expect(out.comment_entry.artist_id).toBe('13447141');
  });

  it('list_comments returns the comments array from the artwork page', async () => {
    mockFetchHtml.mockResolvedValue(artwork);
    const out = parse(await harness.callTool('artsonia_list_comments', { artwork_id: '150567537' }));
    expect(out.comments[0].author).toBe('Grandma');
  });

  it('get_portfolio rejects a non-numeric artist_id', async () => {
    await expect(harness.callTool('artsonia_get_portfolio', { artist_id: 'abc' })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/portfolio.test.ts`
Expected: FAIL ("Cannot find module '../../src/tools/portfolio.js'").

- [ ] **Step 3: Write `src/tools/portfolio.ts`**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, toolAnnotations } from '@chrischall/mcp-utils';
import type { ArtsoniaClient } from '../client.js';
import { parsePortfolio, parseArtwork } from '../parse.js';

const NumericId = z.string().regex(/^\d+$/, 'must be a numeric id');

export function registerPortfolioTools(server: McpServer, client: ArtsoniaClient): void {
  server.registerTool(
    'artsonia_get_portfolio',
    {
      title: "Get a student's portfolio",
      description: "List a student's artworks (artwork_id, title, private flag, thumbnail). Pass the artist_id from artsonia_list_students.",
      annotations: toolAnnotations({ title: "Get a student's portfolio", readOnlyHint: true, openWorldHint: true }),
      inputSchema: { artist_id: NumericId.describe('Student artist_id (from artsonia_list_students).') },
    },
    async ({ artist_id }) => textResult({ artist_id, artworks: parsePortfolio(await client.fetchHtml(`/artists/portfolio.asp?id=${artist_id}`)) }),
  );

  server.registerTool(
    'artsonia_get_artwork',
    {
      title: 'Get artwork detail',
      description: 'Get one artwork: title, artist screen-name, view count, description, and the comments on it. Pass an artwork_id from a portfolio.',
      annotations: toolAnnotations({ title: 'Get artwork detail', readOnlyHint: true, openWorldHint: true }),
      inputSchema: { artwork_id: NumericId.describe('Artwork id (from artsonia_get_portfolio).') },
    },
    async ({ artwork_id }) => textResult(parseArtwork(await client.fetchHtml(`/museum/art.asp?id=${artwork_id}`))),
  );

  server.registerTool(
    'artsonia_list_comments',
    {
      title: 'List comments on an artwork',
      description: 'List the comments on a given artwork (author + text). Pass an artwork_id from a portfolio.',
      annotations: toolAnnotations({ title: 'List comments on an artwork', readOnlyHint: true, openWorldHint: true }),
      inputSchema: { artwork_id: NumericId.describe('Artwork id (from artsonia_get_portfolio).') },
    },
    async ({ artwork_id }) => {
      const detail = parseArtwork(await client.fetchHtml(`/museum/art.asp?id=${artwork_id}`));
      return textResult({ artwork_id, comments: detail.comments });
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tools/portfolio.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/portfolio.ts tests/tools/portfolio.test.ts
git commit -m "feat: add portfolio, artwork, and comments read tools"
```

### Task 10: Fans tool

**Files:**
- Create: `src/tools/fans.ts`, `tests/tools/fans.test.ts`

- [ ] **Step 1: Write the failing test** (`tests/tools/fans.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { registerFanTools } from '../../src/tools/fans.js';
import { client } from '../../src/client.js';
import { createTestHarness } from '../helpers.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const fans = readFileSync(join(FIX, 'fans.html'), 'utf8');
const mockFetchHtml = vi.spyOn(client, 'fetchHtml');

let harness: Awaited<ReturnType<typeof createTestHarness>>;
beforeEach(() => mockFetchHtml.mockReset());
afterAll(async () => { if (harness) await harness.close(); });
const parse = (res: any) => JSON.parse(res.content[0].text);

describe('fan tools', () => {
  it('setup', async () => { harness = await createTestHarness((s) => registerFanTools(s, client)); });

  it('get_fans fetches /members/fanclub/?artist=<id> and returns fans', async () => {
    mockFetchHtml.mockResolvedValue(fans);
    const out = parse(await harness.callTool('artsonia_get_fans', { artist_id: '13447141' }));
    expect(mockFetchHtml).toHaveBeenCalledWith('/members/fanclub/?artist=13447141');
    expect(out.fans).toHaveLength(2);
    expect(out.fans[1].relationship).toBe('Grandparent');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/fans.test.ts`
Expected: FAIL ("Cannot find module '../../src/tools/fans.js'").

- [ ] **Step 3: Write `src/tools/fans.ts`**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, toolAnnotations } from '@chrischall/mcp-utils';
import type { ArtsoniaClient } from '../client.js';
import { parseFans } from '../parse.js';

export function registerFanTools(server: McpServer, client: ArtsoniaClient): void {
  server.registerTool(
    'artsonia_get_fans',
    {
      title: "Get a student's fan club",
      description: "List the fans (name + relationship) in a student's fan club. Pass the artist_id from artsonia_list_students.",
      annotations: toolAnnotations({ title: "Get a student's fan club", readOnlyHint: true, openWorldHint: true }),
      inputSchema: { artist_id: z.string().regex(/^\d+$/, 'must be a numeric id').describe('Student artist_id.') },
    },
    async ({ artist_id }) => textResult({ artist_id, fans: parseFans(await client.fetchHtml(`/members/fanclub/?artist=${artist_id}`)) }),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tools/fans.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/fans.ts tests/tools/fans.test.ts
git commit -m "feat: add get_fans tool"
```

---

## Phase 7 — Write tools (confirm-gated)

### Task 11: post_comment, invite_fan, set_notifications

**Files:**
- Create: `src/tools/writes.ts`, `tests/tools/writes.test.ts`, `tests/fixtures/profile.html`

The `set_notifications` write is a **read-modify-write** of the master profile form: GET `/members/profile/`, read all current field values, flip only the chosen opt-in, blank the password fields, set `DidChangePassword=0`, and POST to `/members/profile/default.asp`. So `writes.ts` needs a profile parser.

- [ ] **Step 1: Write the profile fixture** (`tests/fixtures/profile.html`)

```html
<!doctype html><html><body>
<form id="TheForm" name="ParentProfileForm" method="post" action="default.asp">
  <input type="text" name="FirstName" value="Chris">
  <input type="text" name="LastName" value="Hall">
  <input type="text" name="EmailAddress" value="chris@example.com">
  <input type="hidden" name="EmailAddressPrev" value="chris@example.com">
  <input type="password" name="OldPassword" value="">
  <input type="password" name="NewPassword" value="">
  <input type="password" name="NewPassword2" value="">
  <input type="hidden" name="DidChangePassword" value="0">
  <select name="MobileCountryCode"><option value="1" selected>1</option></select>
  <input type="text" name="MobileNumber" value="5550001234">
  <input type="checkbox" name="OptInNews">
  <input type="checkbox" name="OptInArtistActivity" checked>
  <input type="checkbox" name="OptInPromos">
  <input type="hidden" name="Action" value="save">
  <input type="hidden" name="VerificationCode" value="">
</form>
</body></html>
```

- [ ] **Step 2: Write the failing test** (`tests/tools/writes.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { registerWriteTools } from '../../src/tools/writes.js';
import { client } from '../../src/client.js';
import { createTestHarness } from '../helpers.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const profile = readFileSync(join(FIX, 'profile.html'), 'utf8');
const mockWrite = vi.spyOn(client, 'write');
const mockFetchHtml = vi.spyOn(client, 'fetchHtml');

let harness: Awaited<ReturnType<typeof createTestHarness>>;
beforeEach(() => { mockWrite.mockReset(); mockFetchHtml.mockReset(); });
afterAll(async () => { if (harness) await harness.close(); });
const parse = (res: any) => JSON.parse(res.content[0].text);

describe('write tools', () => {
  it('setup + registers three tools', async () => {
    harness = await createTestHarness((s) => registerWriteTools(s, client));
    const names = (await harness.listTools()).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['artsonia_post_comment', 'artsonia_invite_fan', 'artsonia_set_notifications']));
  });

  // post_comment
  it('post_comment without confirm is a dry run — no network call', async () => {
    const out = parse(await harness.callTool('artsonia_post_comment', { artist_id: '13447141', artwork_id: '150567537', comment: 'Great work!' }));
    expect(out.preview).toBe(true);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('post_comment with confirm posts Comment to /museum/enter.asp', async () => {
    mockWrite.mockResolvedValue({ status: 302, body: '', url: 'https://www.artsonia.com/members/', setCookie: [], location: '/members/' });
    const out = parse(await harness.callTool('artsonia_post_comment', { artist_id: '13447141', artwork_id: '150567537', comment: 'Great work!', confirm: true }));
    expect(mockWrite).toHaveBeenCalledWith('/museum/enter.asp?artist=13447141&art=150567537', 'Comment=Great+work%21');
    expect(out.posted).toBe(true);
  });

  // invite_fan
  it('invite_fan without confirm is a dry run', async () => {
    const out = parse(await harness.callTool('artsonia_invite_fan', { artist_id: '13447141', first_name: 'Test', last_name: 'Fan', email: 'test@example.com', relationship_id: '3' }));
    expect(out.preview).toBe(true);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('invite_fan with confirm posts to /members/fanclub/add.asp with the fan fields', async () => {
    mockWrite.mockResolvedValue({ status: 302, body: '', url: 'https://www.artsonia.com/members/fanclub/', setCookie: [], location: '/members/fanclub/' });
    await harness.callTool('artsonia_invite_fan', { artist_id: '13447141', first_name: 'Test', last_name: 'Fan', email: 'test@example.com', relationship_id: '3', confirm: true });
    const [path, body] = mockWrite.mock.calls[0];
    expect(path).toBe('/members/fanclub/add.asp?artist=13447141');
    expect(body).toContain('FirstName=Test');
    expect(body).toContain('EmailAddress=test%40example.com');
    expect(body).toContain('RelationshipID=3');
    expect(body).toContain('ArtistID=13447141');
  });

  // set_notifications (read-modify-write)
  it('set_notifications without confirm previews the resulting opt-in state without writing', async () => {
    mockFetchHtml.mockResolvedValue(profile);
    const out = parse(await harness.callTool('artsonia_set_notifications', { artist_activity: false }));
    expect(out.preview).toBe(true);
    expect(out.wouldSend.OptInArtistActivity).toBe(false);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('set_notifications with confirm re-sends the whole profile, flips only the chosen opt-in, blanks passwords', async () => {
    mockFetchHtml.mockResolvedValue(profile);
    mockWrite.mockResolvedValue({ status: 302, body: '', url: 'https://www.artsonia.com/members/profile/', setCookie: [], location: '/members/profile/' });
    await harness.callTool('artsonia_set_notifications', { news: true, confirm: true });
    const [path, body] = mockWrite.mock.calls[0];
    expect(path).toBe('/members/profile/default.asp');
    const params = new URLSearchParams(body);
    expect(params.get('FirstName')).toBe('Chris');         // preserved
    expect(params.get('OptInNews')).toBe('on');            // flipped on
    expect(params.get('OptInArtistActivity')).toBe('on');  // preserved (was checked)
    expect(params.has('OptInPromos')).toBe(false);         // unchecked → omitted
    expect(params.get('NewPassword')).toBe('');            // blanked
    expect(params.get('DidChangePassword')).toBe('0');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/tools/writes.test.ts`
Expected: FAIL ("Cannot find module '../../src/tools/writes.js'").

- [ ] **Step 4: Write `src/tools/writes.ts`**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { parse } from 'node-html-parser';
import { textResult, toolAnnotations, schemaConfirm } from '@chrischall/mcp-utils';
import type { ArtsoniaClient } from '../client.js';

const NumericId = z.string().regex(/^\d+$/, 'must be a numeric id');

function previewResult(action: string, wouldSend: Record<string, unknown>, caveat?: string) {
  return textResult({
    preview: true,
    action,
    note: `DRY RUN — nothing was sent. Re-run with confirm: true to perform this write.${caveat ? ` ${caveat}` : ''}`,
    wouldSend,
  });
}

// The notification opt-ins live inside the master profile form. To change one we
// must read the form, re-send every current value, and flip only the chosen
// checkbox — blanking password fields so we never trigger a password/email change.
const OPTIN_FIELDS = { news: 'OptInNews', artist_activity: 'OptInArtistActivity', promos: 'OptInPromos' } as const;
const PASSWORD_FIELDS = new Set(['OldPassword', 'NewPassword', 'NewPassword2']);

interface ProfileForm { fields: Record<string, string>; checkboxes: Record<string, boolean>; }

export function parseProfileForm(html: string): ProfileForm {
  const form = parse(html).querySelector('#TheForm');
  if (!form) throw new Error('Could not find the Artsonia profile form (#TheForm).');
  const fields: Record<string, string> = {};
  const checkboxes: Record<string, boolean> = {};
  for (const el of form.querySelectorAll('input, select')) {
    const name = el.getAttribute('name');
    if (!name) continue;
    const type = (el.getAttribute('type') ?? el.tagName.toLowerCase());
    if (type === 'checkbox') {
      checkboxes[name] = el.hasAttribute('checked');
    } else if (el.tagName.toLowerCase() === 'select') {
      const sel = el.querySelector('option[selected]') ?? el.querySelector('option');
      fields[name] = sel?.getAttribute('value') ?? '';
    } else {
      fields[name] = el.getAttribute('value') ?? '';
    }
  }
  return { fields, checkboxes };
}

export function registerWriteTools(server: McpServer, client: ArtsoniaClient): void {
  // ── post_comment ──────────────────────────────────────────────────────────
  server.registerTool(
    'artsonia_post_comment',
    {
      title: 'Post a comment on an artwork',
      description: "Post a comment on a student's artwork. Without confirm:true this is a DRY RUN that returns a preview and makes no network call.",
      annotations: toolAnnotations({ title: 'Post a comment on an artwork', readOnlyHint: false, destructiveHint: false, openWorldHint: true }),
      inputSchema: {
        artist_id: NumericId.describe('Student artist_id (from artsonia_list_students).'),
        artwork_id: NumericId.describe('Artwork id (from artsonia_get_portfolio).'),
        comment: z.string().min(1).describe('The comment text to post.'),
        confirm: schemaConfirm,
      },
    },
    async ({ artist_id, artwork_id, comment, confirm }) => {
      const path = `/museum/enter.asp?artist=${artist_id}&art=${artwork_id}`;
      if (confirm !== true) return previewResult('post_comment', { path, Comment: comment });
      const body = new URLSearchParams({ Comment: comment }).toString();
      const res = await client.write(path, body);
      return textResult({ posted: true, artist_id, artwork_id, status: res.status });
    },
  );

  // ── invite_fan ──────────────────────────────────────────────────────────────
  server.registerTool(
    'artsonia_invite_fan',
    {
      title: "Invite a fan to a student's fan club",
      description: "Invite someone (by name + email) to follow a student's Artsonia portfolio. Sends them an invite email. Without confirm:true this is a DRY RUN. Use only real addresses you're authorized to invite (test with @example.com).",
      annotations: toolAnnotations({ title: 'Invite a fan', readOnlyHint: false, destructiveHint: false, openWorldHint: true }),
      inputSchema: {
        artist_id: NumericId.describe('Student artist_id (from artsonia_list_students).'),
        first_name: z.string().min(1).describe("Fan's first name."),
        last_name: z.string().min(1).describe("Fan's last name."),
        email: z.string().email().describe("Fan's email address (they receive an invite)."),
        relationship_id: NumericId.describe('Relationship code (RelationshipID select value from the Add Fans form, e.g. grandparent/aunt/friend).'),
        is_parent: z.boolean().default(false).describe('Whether this fan is also a parent/guardian.'),
        confirm: schemaConfirm,
      },
    },
    async ({ artist_id, first_name, last_name, email, relationship_id, is_parent, confirm }) => {
      const path = `/members/fanclub/add.asp?artist=${artist_id}`;
      const params = new URLSearchParams({
        MemberType: 'fan',
        RelationshipID: relationship_id,
        FirstName: first_name,
        LastName: last_name,
        EmailAddress: email,
        ArtistID: artist_id,
      });
      if (is_parent) params.set('IsParent', 'on');
      if (confirm !== true) {
        return previewResult('invite_fan', { path, ...Object.fromEntries(params) }, 'Verify the RelationshipID against the live Add Fans form; MemberType is assumed "fan".');
      }
      const res = await client.write(path, params.toString());
      return textResult({ invited: true, artist_id, email, status: res.status });
    },
  );

  // ── set_notifications (read-modify-write) ────────────────────────────────────
  server.registerTool(
    'artsonia_set_notifications',
    {
      title: 'Set notification preferences',
      description: "Turn the account's email opt-ins on/off (news, artist activity, promos). Reads your profile, changes only the opt-in(s) you specify, and re-saves — leaving your name/email/password untouched. Without confirm:true this is a DRY RUN showing the resulting state.",
      annotations: toolAnnotations({ title: 'Set notification preferences', readOnlyHint: false, destructiveHint: false, openWorldHint: true }),
      inputSchema: {
        news: z.boolean().optional().describe('OptInNews — general Artsonia news emails.'),
        artist_activity: z.boolean().optional().describe('OptInArtistActivity — emails about your student(s) activity.'),
        promos: z.boolean().optional().describe('OptInPromos — promotional/keepsake emails.'),
        confirm: schemaConfirm,
      },
    },
    async ({ news, artist_activity, promos, confirm }) => {
      const desired: Record<string, boolean | undefined> = { news, artist_activity, promos };
      if (news === undefined && artist_activity === undefined && promos === undefined) {
        return textResult({ error: 'Specify at least one of news / artist_activity / promos.' });
      }
      const { fields, checkboxes } = parseProfileForm(await client.fetchHtml('/members/profile/'));
      // Apply desired opt-in changes onto the current checkbox state.
      const nextChecks = { ...checkboxes };
      for (const [key, fieldName] of Object.entries(OPTIN_FIELDS)) {
        const want = desired[key as keyof typeof desired];
        if (want !== undefined) nextChecks[fieldName] = want;
      }
      // Build the POST body: all non-password text/select fields verbatim,
      // password fields blanked, DidChangePassword=0, checked checkboxes as "on".
      const params = new URLSearchParams();
      for (const [name, value] of Object.entries(fields)) {
        if (PASSWORD_FIELDS.has(name)) { params.set(name, ''); continue; }
        if (name === 'DidChangePassword') { params.set(name, '0'); continue; }
        params.set(name, value);
      }
      for (const [name, on] of Object.entries(nextChecks)) {
        if (on) params.set(name, 'on'); // unchecked boxes are omitted, matching the HTML form
      }
      const resultingOptIns = {
        OptInNews: nextChecks['OptInNews'] ?? false,
        OptInArtistActivity: nextChecks['OptInArtistActivity'] ?? false,
        OptInPromos: nextChecks['OptInPromos'] ?? false,
      };
      if (confirm !== true) {
        return previewResult('set_notifications', { ...resultingOptIns }, 'Re-sends your full profile (name/email preserved, password blanked) to flip only the opt-in(s).');
      }
      const res = await client.write('/members/profile/default.asp', params.toString());
      return textResult({ updated: true, optIns: resultingOptIns, status: res.status });
    },
  );
}
```

> `URLSearchParams` encodes spaces as `+` and `!` as `%21`, matching the test's expected `Comment=Great+work%21`. If `schemaConfirm`/`toolAnnotations` shapes differ, mirror `~/git/evite-mcp/src/tools/writes.ts`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/tools/writes.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add src/tools/writes.ts tests/tools/writes.test.ts tests/fixtures/profile.html
git commit -m "feat: add confirm-gated post_comment, invite_fan, set_notifications writes"
```

---

## Phase 8 — Healthcheck + wiring

### Task 12: Healthcheck tool

**Files:**
- Create: `src/tools/healthcheck.ts`, `tests/tools/healthcheck.test.ts`

- [ ] **Step 1: Write the failing test** (`tests/tools/healthcheck.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { registerHealthcheckTools } from '../../src/tools/healthcheck.js';
import { client } from '../../src/client.js';
import { createTestHarness } from '../helpers.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const dashboard = readFileSync(join(FIX, 'dashboard.html'), 'utf8');
const mockFetchHtml = vi.spyOn(client, 'fetchHtml');

let harness: Awaited<ReturnType<typeof createTestHarness>>;
beforeEach(() => mockFetchHtml.mockReset());
afterAll(async () => { if (harness) await harness.close(); });
const parse = (res: any) => JSON.parse(res.content[0].text);

describe('artsonia_healthcheck', () => {
  it('setup', async () => { harness = await createTestHarness((s) => registerHealthcheckTools(s, client)); });

  it('reports authenticated + student_count on success', async () => {
    mockFetchHtml.mockResolvedValue(dashboard);
    const out = parse(await harness.callTool('artsonia_healthcheck'));
    expect(out.ok).toBe(true);
    expect(out.authenticated).toBe(true);
    expect(out.student_count).toBe(2);
  });

  it('reports a helpful hint when login fails', async () => {
    mockFetchHtml.mockRejectedValue(new Error('ARTSONIA_USERNAME and ARTSONIA_PASSWORD environment variables are required'));
    const out = parse(await harness.callTool('artsonia_healthcheck'));
    expect(out.ok).toBe(false);
    expect(out.hint).toMatch(/ARTSONIA_USERNAME|credentials/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/healthcheck.test.ts`
Expected: FAIL ("Cannot find module '../../src/tools/healthcheck.js'").

- [ ] **Step 3: Write `src/tools/healthcheck.ts`**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { textResult, toolAnnotations, readEnvVar, messageOf } from '@chrischall/mcp-utils';
import type { ArtsoniaClient } from '../client.js';
import { parseStudents } from '../parse.js';

export function registerHealthcheckTools(server: McpServer, client: ArtsoniaClient): void {
  server.registerTool(
    'artsonia_healthcheck',
    {
      title: 'Verify Artsonia auth + connectivity',
      description: 'Confirm credentials are configured, log in, fetch the dashboard, and report {authenticated, transport, student_count} with a plain-English hint distinguishing "no creds" vs "bad creds" vs "site error". Read-only.',
      annotations: toolAnnotations({ title: 'Verify Artsonia auth + connectivity', readOnlyHint: true, idempotentHint: true, openWorldHint: true }),
      inputSchema: {},
    },
    async () => {
      const transport = readEnvVar('ARTSONIA_TRANSPORT') ?? 'fetch';
      try {
        const students = parseStudents(await client.fetchHtml('/members/'));
        return textResult({
          ok: true,
          authenticated: true,
          transport,
          student_count: students.length,
          hint: students.length > 0 ? 'Logged in; dashboard parsed successfully.' : 'Logged in, but no students parsed — the dashboard markup may have changed.',
        });
      } catch (e) {
        const msg = messageOf(e);
        const noCreds = /ARTSONIA_USERNAME|ARTSONIA_PASSWORD/.test(msg);
        return textResult({
          ok: false,
          authenticated: false,
          transport,
          error: msg,
          hint: noCreds
            ? 'Set ARTSONIA_USERNAME and ARTSONIA_PASSWORD (in .env or the MCP host env), then retry.'
            : 'Login or fetch failed — check that your credentials are correct and the account is a parent/fan account (magic-link-only accounts are unsupported).',
        });
      }
    },
  );
}
```

> If `messageOf` isn't exported, use `e instanceof Error ? e.message : String(e)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tools/healthcheck.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/healthcheck.ts tests/tools/healthcheck.test.ts
git commit -m "feat: add artsonia_healthcheck tool"
```

### Task 13: index.ts wiring

**Files:**
- Create: `src/index.ts`, `tests/index.test.ts`

- [ ] **Step 1: Write the failing test** (`tests/index.test.ts`)

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { createTestHarness } from './helpers.js';
import { client } from '../src/client.js';
import { registerHealthcheckTools } from '../src/tools/healthcheck.js';
import { registerStudentTools } from '../src/tools/students.js';
import { registerPortfolioTools } from '../src/tools/portfolio.js';
import { registerFanTools } from '../src/tools/fans.js';
import { registerWriteTools } from '../src/tools/writes.js';

let harness: Awaited<ReturnType<typeof createTestHarness>>;
afterAll(async () => { if (harness) await harness.close(); });

describe('full tool surface', () => {
  it('registers all 10 tools', async () => {
    harness = await createTestHarness((s) => {
      registerHealthcheckTools(s, client);
      registerStudentTools(s, client);
      registerPortfolioTools(s, client);
      registerFanTools(s, client);
      registerWriteTools(s, client);
    });
    const names = (await harness.listTools()).map((t) => t.name).sort();
    expect(names).toEqual([
      'artsonia_get_activity',
      'artsonia_get_artwork',
      'artsonia_get_fans',
      'artsonia_get_portfolio',
      'artsonia_healthcheck',
      'artsonia_invite_fan',
      'artsonia_list_comments',
      'artsonia_list_students',
      'artsonia_post_comment',
      'artsonia_set_notifications',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/index.test.ts`
Expected: FAIL (assertion mismatch is fine; the point is wiring). Then implement.

- [ ] **Step 3: Write `src/index.ts`**

```ts
#!/usr/bin/env node
import { runMcp, type ToolRegistrar } from '@chrischall/mcp-utils';
import { VERSION } from './version.js';
import { client, type ArtsoniaClient } from './client.js';
import { registerHealthcheckTools } from './tools/healthcheck.js';
import { registerStudentTools } from './tools/students.js';
import { registerPortfolioTools } from './tools/portfolio.js';
import { registerFanTools } from './tools/fans.js';
import { registerWriteTools } from './tools/writes.js';

// The client is a module-level singleton (constructed in client.ts) so the
// deferred-config-error pattern holds: the server boots and answers the host's
// install-time tools/list probe even without ARTSONIA_USERNAME/PASSWORD — the
// config error only surfaces on the first tool call.
const tools: ToolRegistrar<ArtsoniaClient>[] = [
  (s) => registerHealthcheckTools(s, client),
  (s) => registerStudentTools(s, client),
  (s) => registerPortfolioTools(s, client),
  (s) => registerFanTools(s, client),
  (s) => registerWriteTools(s, client),
];

await runMcp({
  name: 'artsonia-mcp',
  version: VERSION,
  banner: `[artsonia-mcp] v${VERSION} — parent/fan access to Artsonia via username/password login. This project was developed and is maintained by AI (Claude). Use at your own discretion.`,
  tools,
});
```

> If `ToolRegistrar`'s generic param doesn't fit the `(s) => register...(s, client)` shape, drop the generic and type `tools` as `Array<(server: McpServer) => void>` (import `McpServer` type). Confirm against `~/git/musescore-mcp/src/index.ts`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/index.test.ts && npx tsc --noEmit`
Expected: PASS + no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: wire all tools into runMcp entrypoint"
```

### Task 14: Full build + test gate

- [ ] **Step 1: Run the whole suite + build**

Run: `npm test && npm run build`
Expected: all tests PASS; `dist/bundle.js` produced with no errors.

- [ ] **Step 2: Commit any fixups**

```bash
git add -A
git commit -m "chore: green build + full test suite" || echo "nothing to commit"
```

---

## Phase 9 — Packaging & release scaffold

### Task 15: Publish manifests

**Files:**
- Create: `manifest.json`, `server.json`, `.mcp.json`, `.mcpbignore`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `skills/artsonia-mcp/SKILL.md`

Copy each file from `~/git/splitwise-mcp` (or another public sibling) and adapt the name/description/IDs. Concrete requirements:

- [ ] **Step 1: `manifest.json`** (mcpb) — set `name: "artsonia-mcp"`, `version: "0.1.0"`, `runtimes.node: ">=22.5"` (LTS floor, NOT 26), declare the two required env vars (`ARTSONIA_USERNAME`, `ARTSONIA_PASSWORD`) as `user_config`. Mirror a sibling's structure exactly.

- [ ] **Step 2: `server.json`** (MCP registry) — `name`, `version: "0.1.0"`, `packages[*].version: "0.1.0"`, and a `description` **≤ 100 characters** (over → `mcp-publisher` 422s). Example description: `"Parent/fan access to Artsonia student-art portfolios, comments, and fans (AI-built)."` (84 chars).

- [ ] **Step 3: `.claude-plugin/plugin.json` + `marketplace.json`** — `version: "0.1.0"` in plugin.json; `plugins[*].version` and `metadata.version` in marketplace.json. Copy a sibling's shape.

- [ ] **Step 4: `.mcp.json`** — stdio launcher (`node dist/index.js` or the bundle), with the two env vars referenced. Copy a sibling.

- [ ] **Step 5: `.mcpbignore`** — ship only `dist/bundle.js` + `manifest.json` + `package.json`. Exclude `src/`, `tests/`, `docs/`, `node_modules/`, `.env*`, `server.json`, `.claude-plugin/`, `.mcp.json`, `release-please-config.json`, `.release-please-manifest.json`, `CHANGELOG.md`.

- [ ] **Step 6: `skills/artsonia-mcp/SKILL.md`** — short skill doc describing the tools + the `ARTSONIA_USERNAME`/`ARTSONIA_PASSWORD` setup. Mirror a sibling's front-matter.

- [ ] **Step 7: Verify version sync across manifests**

Run: `npm test` (the `version-sync` test only checks `src/`; manually grep the manifests)
Run: `grep -RInE '"version"|0\.1\.0' manifest.json server.json .claude-plugin .mcp.json | grep -v node_modules`
Expected: every version reads `0.1.0`.

- [ ] **Step 8: Commit**

```bash
git add manifest.json server.json .mcp.json .mcpbignore .claude-plugin skills
git commit -m "chore: add mcpb/registry/plugin packaging scaffold"
```

### Task 16: release-please + CI workflows

**Files:**
- Create: `release-please-config.json`, `.release-please-manifest.json`, `.github/workflows/{ci,pr-auto-review,claude,auto-merge,release-please}.yml`, `.github/dependabot.yml`

- [ ] **Step 1: `.release-please-manifest.json`**

```json
{ ".": "0.1.0" }
```

- [ ] **Step 2: `release-please-config.json`** — `release-type: node`, `package-name: artsonia-mcp`, `changelog-sections`, and **`extra-files` listing every version-carrying file**:
  - `manifest.json` (`$.version`)
  - `server.json` (`$.version` and `$.packages[*].version`)
  - `.claude-plugin/plugin.json` (`$.version`)
  - `.claude-plugin/marketplace.json` (`$.plugins[*].version`, `$.metadata.version`)
  - `src/version.ts` (the `// x-release-please-version` line — generic updater)

  Copy a public sibling's `release-please-config.json` and adjust paths/JSONPaths. **Only `src/version.ts` carries the source marker** (single source — there is no second `SERVER_VERSION`).

- [ ] **Step 3: Copy the five workflows + dependabot.yml** from a public sibling (`~/git/splitwise-mcp/.github/`), changing only repo-specific names. Keep `node-version: 26` in `ci.yml` and `release-please.yml`. Public repo → keep the `npm publish --provenance` step (works on public repos).

- [ ] **Step 4: Sanity-check CI locally**

Run: `npm ci && npm test && npm run build`
Expected: green (this mirrors `ci.yml`).

- [ ] **Step 5: Commit**

```bash
git add release-please-config.json .release-please-manifest.json .github
git commit -m "ci: add release-please config and GitHub workflows"
```

### Task 17: Repo bootstrap (human + agent split)

These are environment steps, not code. The **agent** does the `gh` commands it can; **credential-bearing steps are the human's**.

- [ ] **Step 1 (agent): create the GitHub repo (public) and push**

```bash
gh repo create chrischall/artsonia-mcp --public --source=. --remote=origin --push
```

- [ ] **Step 2 (agent): create labels**

```bash
for L in auto-review ready-to-merge review-with-opus "autorelease: pending" "autorelease: tagged" ci security test javascript github_actions ignore-for-release; do
  gh label create "$L" --repo chrischall/artsonia-mcp 2>/dev/null || echo "exists: $L"
done
```

- [ ] **Step 3 (agent): branch-protection rulesets** — two rulesets on the default branch: (1) block `deletion` + `non_fast_forward`; (2) require a PR + the `ci` status check. Apply via `gh api` mirroring a sibling's ruleset JSON.

- [ ] **Step 4 (HUMAN): set repo secrets** — `CLAUDE_CODE_OAUTH_TOKEN`, `RELEASE_PAT`, optional `CLAWHUB_TOKEN`, and configure npm **trusted publishing** for the package. **The agent must NOT set credential values.** Surface this as a checklist item for Chris.

- [ ] **Step 5: STOP — do not open a PR / merge.** Per house rules: never merge or arm `ready-to-merge`. The first PR is opened only when the whole change is complete and verified live (next task).

---

## Phase 10 — Live verification (human-in-the-loop)

### Task 18: End-to-end verification against the real account

The unit tests use synthetic fixtures. Before shipping, verify against the live site. The user (Chris) provides credentials via `.env`; the agent runs read-only checks and confirms the parsers against real markup.

- [ ] **Step 1: Configure `.env`** with real `ARTSONIA_USERNAME` / `ARTSONIA_PASSWORD` (gitignored).

- [ ] **Step 2: Read smoke test** — run a tiny script (or MCP host call) that invokes `artsonia_healthcheck`, then `artsonia_list_students`, `artsonia_get_portfolio`, `artsonia_get_artwork`, `artsonia_get_fans`, `artsonia_get_activity`. Confirm real data returns. **If any parser returns empty/garbled, capture the real HTML** (the agent can re-capture via Chrome from the signed-in tab), update the fixture + selector, and re-run the parser test. Commit fixes as `fix(parse): match live <page> markup`.

- [ ] **Step 3: Write verification** (careful, one at a time):
  - `artsonia_post_comment` with `confirm:true` on a real artwork → confirm it appears, then note it's user-visible (Chris approves the test comment).
  - `artsonia_invite_fan` with `confirm:true` to a **`@example.com`** address (blackholed) → confirm HTTP 302/success; verify the RelationshipID/MemberType against the live Add Fans form first.
  - `artsonia_set_notifications` with `confirm:true` flipping one opt-in, then re-read `/members/profile/` to confirm only that opt-in changed and name/email are intact.

- [ ] **Step 4: Secret-scan** before any commit: `git grep -nIE "ASPSESSION|Cookie:|password|ARTSONIA_PASSWORD=" -- ':!*.example' ':!docs/ARTSONIA-API.md'` — ensure no captured cookies/credentials are staged. `.env` stays gitignored.

- [ ] **Step 5: Open the first PR** — only now, with everything complete and verified, on a feature branch with ONE release-notes label. Let `pr-auto-review` + `auto-merge` ship it on a `pass`. **Do not add `ready-to-merge` or merge manually.** If the review returns `warn`/`fail`, surface findings to Chris and ask.

---

## Self-review checklist (completed by plan author)

- **Spec coverage:** auth (Tasks 5–6), transports incl. fetchproxy fallback (Tasks 3–4), parsers (Task 7), all 6 reads (Tasks 8–10) + healthcheck (Task 12), all 3 writes (Task 11), config/env (Task 1 `.env.example` + auth), packaging/release (Tasks 15–17), live verification (Task 18). `star_artwork` intentionally absent (dropped). ✓
- **No placeholders:** every code step contains real code; manifest tasks reference exact sibling files + concrete constraints (≤100-char description, LTS node floor, extra-files list). ✓
- **Type consistency:** `ArtsoniaTransport.request`/`ArtsoniaResponse`, `AuthManager.{ensureLogin,forceRelogin,cookieHeader,absorb,invalidate}`, `ArtsoniaClient.{fetchHtml,write}`, and parser names (`parseStudents`/`parseNotifications`/`parsePortfolio`/`parseArtwork`/`parseFans`/`parseProfileForm`) are used identically across tasks. Tool names match the Task 13 sorted list. ✓
```
