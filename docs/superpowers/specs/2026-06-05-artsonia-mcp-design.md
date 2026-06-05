# artsonia-mcp — Design

**Date:** 2026-06-05
**Status:** Approved; endpoints verified live (see `docs/ARTSONIA-API.md`)
**Archetype:** fetchproxy / browser-bridge (copy from `zillow-mcp`)

> **Verified 2026-06-05** against a signed-in parent session. Artsonia is a
> **classic server-rendered jQuery `.asp` site** — NOT an SPA/JSON-store site.
> Data lives in the server-rendered HTML, so parsing uses `node-html-parser`
> (not JSON-store decoding). No Cloudflare interstitial. Every form is authed
> by the session cookie alone — **no CSRF / `__VIEWSTATE` token**. Concrete
> paths/fields for every tool are in `docs/ARTSONIA-API.md`.

## Purpose

An MCP server that exposes a **parent/fan's** signed-in Artsonia
(`https://www.artsonia.com/members/`) account to an agent: view the
student(s) you follow, their portfolios and artwork, comments, activity, and
fan list — plus a small set of confirm-gated write actions (post a comment;
and, only once verified, star artwork / invite a fan / set notifications).

Artsonia has no public API and the members area is a signed-in SPA, so every
request rides the user's signed-in browser tab via `@fetchproxy/server`.

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

Fetchproxy archetype on the **shared fleet port `37149`** (`DEFAULT_PORT =
37_149`; env override `ARTSONIA_WS_PORT`). Copy `zillow-mcp`'s skeleton.

- `src/transport.ts` — `ArtsoniaTransport` interface (`{status, body, url}`
  round-trip; `BridgeStatus` alias of `@chrischall/mcp-utils/fetchproxy`
  `BridgeHealth`).
- `src/transport-fetchproxy.ts` — the **one** place that constructs
  `FetchproxyServer`. `domains: ['artsonia.com']` (apex-vs-`www` verified live
  during build), `capabilities: ['fetch']`. Direct import of
  `@fetchproxy/server` (so the transport spec can mock its constructor).
- `src/client.ts` — `ArtsoniaClient` over any `ArtsoniaTransport`:
  - `fetchHtml(path)` / `fetchJson(path)` for reads.
  - **One central `write()`** that attaches auth (browser carries the session
    cookie; CSRF token, if any, extracted from the page/store) — every mutation
    routes through it.
  - Deferred-config-error style: construct without throwing; surface bridge/auth
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
- `artsonia_healthcheck` — round-trip a small public artsonia.com URL through
  the bridge; returns role/port/version + a plain-English hint isolating
  bridge vs extension vs site failures. Read-only.
- `artsonia_sessions` — list/select the active signed-in account (meaningful
  only with >1 account).

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

tool → `client.fetchHtml/fetchJson(path)` → `ArtsoniaTransport.request` →
fetchproxy bridge → signed-in tab → SSR HTML/JSON → store parser →
`textResult(data)`. Writes prepend the `confirm` gate + `client.write()` auth.

## Error handling

Typed `McpToolError` subclasses with actionable `hint`:
- `SessionNotAuthenticatedError` — login-redirect / sign-in interstitial.
- `BotWallError` — via shared `classifyBotWall`. No Cloudflare interstitial
  was observed in recon, so this is defensive only; if one ever appears, detect
  by **definitive markers only** (`_cf_chl_opt`, `<title>Just a moment`) —
  never `cdn-cgi/challenge-platform` or body-size gating.
- Bridge failures surfaced via `artsonia_healthcheck` hints (bridge_down /
  timeout / protocol).
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

vitest, **no real network** (mock the transport/bridge). TDD throughout,
especially writes (failing test → minimal code → green). `versionSyncTest`
from `@chrischall/mcp-utils/test`. `createTestHarness` + `parseToolResult`.

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

## Dependencies

`@chrischall/mcp-utils@^0.5.0`, `@fetchproxy/server@^1.2.0`,
`@modelcontextprotocol/sdk@^1.29.0`, `zod@^4.4.3`. ESM + NodeNext (relative
imports end in `.js`); `"types": ["node"]` in tsconfig.

## Conventions reaffirmed

Never merge PRs or add `ready-to-merge` (open complete in one push; auto-merge
ships on `pass`). stdio logs to stderr only. `.env` gitignored. Throwaway test
writes only to `@example.com`; only the user's own account/data.
