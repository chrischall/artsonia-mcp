# artsonia-mcp — Design

**Date:** 2026-06-05
**Status:** Approved; auth + endpoints verified live (see `docs/ARTSONIA-API.md`)
**Archetype:** cookie-session direct-fetch (bearer-like), **fetchproxy optional fallback**

> **Verified 2026-06-05** against a real login + signed-in parent session.
> Artsonia is a **classic server-rendered jQuery `.asp` site** — NOT an
> SPA/JSON-store site. Data lives in the server-rendered HTML, so parsing uses
> `node-html-parser` (not JSON-store decoding). No Cloudflare interstitial.
> **Auth is a username/password form POST that returns an HttpOnly session
> cookie** (`POST /members/login.asp`, `Username/Password/TargetUrl/Action=login`)
> — so the MCP logs in directly and rides a server-side cookie jar; **the
> browser bridge is not needed** for the common case. Every form is authed by
> the session cookie alone — **no CSRF / `__VIEWSTATE` token**. Concrete
> paths/fields for every tool (and the login flow) are in `docs/ARTSONIA-API.md`.

## Purpose

An MCP server that exposes a **parent/fan's** signed-in Artsonia
(`https://www.artsonia.com/members/`) account to an agent: view the
student(s) you follow, their portfolios and artwork, comments, activity, and
fan list — plus a small set of confirm-gated write actions (post a comment,
invite a fan, set notification preferences).

Artsonia has no public API, but it does accept a direct username/password
login that yields an HttpOnly session cookie — so the MCP logs in server-side
(credentials from env) and talks to the site with a cookie jar over plain
`fetch`, parsing the server-rendered HTML. The browser bridge (`@fetchproxy/
server`) is retained only as an optional fallback.

## Scope

- **Account:** parent/fan.
- **Reads:** followed students, portfolio, artwork detail, comments, activity
  feed/notifications, fan list.
- **Writes (confirm-gated, dry-run `preview()` by default)** — all verified:
  - `artsonia_post_comment` — `POST /museum/enter.asp?artist=&art=`, body
    `Comment=<text>`.
  - `artsonia_invite_fan` — `POST /members/fanclub/add.asp?artist=`, isolated
    form (`FirstName/LastName/EmailAddress/RelationshipID/…`). Test only to
    `@example.com`.
  - `artsonia_set_notifications` — **read-modify-write** of the master profile
    form (`POST /members/profile/default.asp`): GET profile, re-send all
    current values verbatim, flip ONLY the chosen opt-in
    (`OptInNews`/`OptInArtistActivity`/`OptInPromos`), leave password fields
    blank / `DidChangePassword=0`. Bundles PII — handled carefully, confirm-gated.
  - `artsonia_star_artwork` — **DROPPED**: no star/favorite control exists for
    the parent role (verified absent).
- **Out of scope (YAGNI):** teacher/student roles, product/keepsake purchasing,
  artwork upload.

## Architecture

**Cookie-session direct-fetch** (closest fleet archetype: the bearer/direct-API
cohort like splitwise, but with a cookie jar instead of a bearer header).
fetchproxy is retained as an **optional fallback transport**, not the default.

- `src/transport.ts` — `ArtsoniaTransport` interface: `request({method, path,
  headers, body})` → `{status, body, url, setCookie}`. Two implementations:
  - `src/transport-fetch.ts` (**default**) — node `fetch` with
    `redirect: 'manual'` (so login 302s and session-expiry redirects are
    observable), attaching the cookie jar; base `https://www.artsonia.com`.
  - `src/transport-fetchproxy.ts` (**optional**) — wraps `FetchproxyServer` on
    the shared port `37149` (`DEFAULT_PORT = 37_149`, env `ARTSONIA_WS_PORT`),
    `domains: ['artsonia.com']`. Only engaged when `ARTSONIA_TRANSPORT=fetchproxy`
    (or a future wall forces it). Direct import of `@fetchproxy/server` so the
    transport spec can mock its constructor.
- `src/auth.ts` — `AuthManager`: reads `ARTSONIA_USERNAME` / `ARTSONIA_PASSWORD`
  (deferred-config-error). `login()` POSTs the verified form to
  `/members/login.asp`, captures all `Set-Cookie`s into a `CookieJar`, persists
  via `SessionStore` (`@chrischall/mcp-utils/session`, 0600). Race-safe
  single-flight re-login (`TokenManager`) on session expiry. **Never logs
  credentials or cookie values.** Carries a `SERVER_VERSION`
  `// x-release-please-version` marker (release-please extra-file).
- `src/cookies.ts` — minimal cookie jar (parse `Set-Cookie`, serialize `Cookie`
  header). Reuse `parseCookieJar` from `@chrischall/mcp-utils/http` where it fits.
- `src/client.ts` — `ArtsoniaClient` over any `ArtsoniaTransport` + `AuthManager`:
  - `fetchHtml(path)` for reads (auto re-login on login-redirect, one retry).
  - **One central `write()`** that ensures a live session and POSTs
    form-urlencoded bodies — every mutation routes through it.
  - Deferred-config-error style: construct without throwing; surface auth/config
    errors at first tool call. Constructed in the **caller** (`index.ts`).
  - Error mapping lives here (see Error handling).
- `src/parse.ts` — parse the **server-rendered HTML** with `node-html-parser`
  (via `@chrischall/mcp-utils/html` helpers where they fit). Selectors are
  pinned from live captures: `.artist-card`, `.grid-item`, `.fan-card`/
  `.fan-row`, notifications section. Parsers are unit-tested against
  **raw-fetched HTML fixtures** (not the live DOM). No JSON-store decoding.
- `src/index.ts` — `runMcp({ name, version, banner, deps: client, tools })`;
  transport + client + session registry constructed in the caller.

## Tools

**Infra**
- `artsonia_healthcheck` — verify auth + connectivity end-to-end: confirm
  credentials are configured, perform/refresh login, fetch `/members/`, and
  report `{authenticated, transport: fetch|fetchproxy, student_count}` with a
  plain-English hint isolating "no creds" vs "bad creds / login failed" vs
  "site/transport error". Read-only.

**Reads**
- `artsonia_list_students` — the followed student(s) → ids + portfolio handles
  (the selector other read tools take).
- `artsonia_get_portfolio` — a student's artwork list (ids, titles, dates,
  thumbnails).
- `artsonia_get_artwork` — one artwork detail (title, description, medium,
  image URL, star/comment counts).
- `artsonia_list_comments` — comments on an artwork.
- `artsonia_get_activity` — activity feed / notifications for followed
  student(s).
- `artsonia_get_fans` — the student's fan-club list.

**Writes** (all `confirm`-gated via `schemaConfirm`; no `confirm:true` →
no network call, return dry-run `preview()`; all via `client.write()`):
- `artsonia_post_comment`
- `artsonia_invite_fan`
- `artsonia_set_notifications` (read-modify-write of the master profile form)

## Data flow

tool → `client.fetchHtml(path)` → `AuthManager` ensures a live cookie session
(login if needed) → `ArtsoniaTransport.request` (default: node `fetch` + cookie
jar) → server-rendered HTML → `parse.ts` → `textResult(data)`. On a login
redirect the client re-logs-in once and retries. Writes prepend the `confirm`
gate + `client.write()` (form-urlencoded POST through the same session).

## Error handling

Typed `McpToolError` subclasses with actionable `hint`:
- config missing → deferred-config error: "set `ARTSONIA_USERNAME` /
  `ARTSONIA_PASSWORD`".
- `SessionNotAuthenticatedError` — login POST failed (bad creds) or a
  mid-session redirect back to `/members/login.asp` that re-login didn't clear.
- `BotWallError` — via shared `classifyBotWall`. No Cloudflare interstitial was
  observed; defensive only. If one ever appears, detect by **definitive markers
  only** (`_cf_chl_opt`, `<title>Just a moment`) — never
  `cdn-cgi/challenge-platform` or body-size gating — and that's the signal to
  flip `ARTSONIA_TRANSPORT=fetchproxy`.
- All error bodies through `truncateErrorMessage` (redacts Bearer/JWT, caps).

## Endpoint verification

**Done** — endpoints captured live via Chrome from a signed-in parent session
and pinned (shapes only) in `docs/ARTSONIA-API.md`. No write was coded against
an assumed body. During implementation, the first real execution of each write
is verified end-to-end: `post_comment` confirmed by the user on a real artwork;
`invite_fan` test-sent to an `@example.com` address; `set_notifications`
round-tripped by reading the opt-in back. Never commit cookies/tokens/PII —
secret-scan before every commit.

## Testing

vitest, **no real network** (inject a fake `ArtsoniaTransport`; assert the
login POST body/shape and parser output against raw-HTML fixtures). TDD
throughout, especially auth + writes (failing test → minimal code → green).
`versionSyncTest` from `@chrischall/mcp-utils/test` (covers `src/index.ts` AND
`src/auth.ts` `SERVER_VERSION`). `createTestHarness` + `parseToolResult`.

## Packaging & release

- **Public repo + npm `--provenance`** (full fleet default): MCP registry +
  ClawHub + `.mcpb` GitHub release. Repo holds code only — no data/creds.
- Workflows copied from a public sibling: ci, pr-auto-review, claude,
  auto-merge, release-please, dependabot. CI/publish Node 26.
- Per-repo labels: `auto-review`, `ready-to-merge`, `review-with-opus`,
  `autorelease: pending`/`tagged`, dependabot categories.
- Two branch-protection rulesets on the default branch (block
  deletion/non-fast-forward; require PR + `ci` check).
- release-please `extra-files` must list **every** version-carrying file
  (`manifest.json`, `server.json` incl. `packages[*]`, `.claude-plugin/*`,
  `.mcp.json` if versioned, and every `src/*.ts` with `// x-release-please-version`).
- `manifest.json` `runtimes.node` floor stays at an LTS (`>=22.5`).
- `server.json` description ≤ 100 chars.
- `.mcpbignore` ships only `dist/bundle.js` + `manifest.json` + `package.json`.
- mcp-publisher via the shared pinned `install-mcp-publisher` action.

**Secrets are set by the human** (`CLAUDE_CODE_OAUTH_TOKEN`, `RELEASE_PAT`,
optional `CLAWHUB_TOKEN`, npm trusted publishing) — never by the agent.

## Configuration (env)

- `ARTSONIA_USERNAME`, `ARTSONIA_PASSWORD` — **required** (parent/fan login).
  Read via `readEnvVar`; missing → deferred-config error at first tool call.
- `ARTSONIA_TRANSPORT` — `fetch` (default) | `fetchproxy`.
- `ARTSONIA_WS_PORT` — fetchproxy port override (default `37149`); only used
  when transport is `fetchproxy`.
- `.env` gitignored; real creds live in `.env` (local) or the host's
  `mcp_config.env`. Session cookie jar persisted via `SessionStore` (0600).

## Dependencies

`@chrischall/mcp-utils@^0.5.0`, `@fetchproxy/server@^1.2.0`,
`@modelcontextprotocol/sdk@^1.29.0`, `node-html-parser@^7`, `zod@^4.4.3`.
ESM + NodeNext (relative imports end in `.js`); `"types": ["node"]` in tsconfig.
`@fetchproxy/server` stays a dependency (optional-fallback transport), so the
`@chrischall/mcp-utils/fetchproxy` subpath remains available.

## Conventions reaffirmed

Never merge PRs or add `ready-to-merge` (open complete in one push; auto-merge
ships on `pass`). stdio logs to stderr only. `.env` gitignored. Throwaway test
writes only to `@example.com`; only the user's own account/data.
