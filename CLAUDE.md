# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## TL;DR

MCP server for **Artsonia** (artsonia.com — kids' artwork portfolios). Cookie-session archetype: there is no public API, so the server logs into the parent/fan website with a username + password, harvests the resulting HttpOnly session cookie, and scrapes/POSTs the member pages. 15 tools across students, portfolio/artwork, comments, fans, teacher feedback, awards, account profile, image downloads, and a small set of confirm-gated writes.

Two transport modes, selected by `ARTSONIA_TRANSPORT`:

1. **`fetch` (default, direct)** — Node `fetch` against the site. The server owns the session: `AuthManager` runs the username/password login (POST `/members/login.asp`), keeps the cookie jar, and re-logs-in once on expiry.
2. **`fetchproxy` (optional, browser-session)** — requests ride the user's already-signed-in browser tab via `@fetchproxy/server`. The browser carries the session, so the server-side login is **skipped entirely** (`usesBrowserSession = true`). No `ARTSONIA_USERNAME/PASSWORD` needed in this mode.

## Auth resolution

`src/auth.ts` owns the username/password login and the cookie session. It delegates the single-flight login + invalidate/re-login + one-replay-on-expiry to the shared `CookieSessionManager` from `@chrischall/mcp-utils/session`, typed over `ArtsoniaResponse` so the custom transport's response flows through `withSession()` untouched.

- **Env vars:** `ARTSONIA_USERNAME` + `ARTSONIA_PASSWORD` (required in direct mode), `ARTSONIA_TRANSPORT` (`fetch` default | `fetchproxy`), `ARTSONIA_WS_PORT` (fetchproxy WebSocket port override; default `37149` — a shared fleet port, do NOT change), `ARTSONIA_INLINE_DOWNLOADS` (`1`/`true`/`yes`/`on` ⇒ inline image downloads; unset/false ⇒ disk — see "Download I/O" below).
- **Deferred config error:** the `client` is a module singleton constructed in `src/client.ts` (NOT `index.ts`), so the server boots and answers the host's install-time `tools/list` probe even with no creds. The missing-creds error is cached as a *permanent* error (`CONFIG_ERROR_MARKER`) and only surfaces on the first tool call — every later `ensure()` rethrows it rather than retrying a login that can never succeed.
- **Login success marker:** `doLogin()` POSTs `Username`/`Password`/`TargetUrl=/members/`/`Action=login` with `redirect: 'manual'` and treats a 301/302 whose `Location` is NOT `login.asp` (plus a non-empty cookie jar) as success. Magic-link-only accounts are unsupported.
- **Expiry heuristic (`looksUnauthenticated`):** Artsonia expires by redirecting/rendering back to the login page (NOT a 401). Detected from the final URL, login-page body markers (`You need to log in` / `Parent (or Fan) Login`), or a manual 3xx `Location` pointing at `login.asp`.

### The two-mode split (in `src/client.ts`)

- **Browser-session mode** (`transport.usesBrowserSession === true`): the request is sent straight through — no server jar, no `Cookie` header override, no `withSession()`. If the response looks unauthenticated, the client throws a browser-specific hint ("Open www.artsonia.com in the bridged browser tab and sign in").
- **Direct mode:** every authed request goes through `auth.withSession()`, which ensures a live session, runs the request, and on an `isExpired` signal invalidates + single-flight re-logs-in + replays **exactly once**. A still-login-looking final response surfaces as a clean sign-in error.

## Architecture

```
src/
  index.ts                # Entry — runMcp({name,version,banner,tools}); wires the 8 register*Tools modules over the client singleton
  client.ts               # ArtsoniaClient: fetchHtml() (GET) / write() (POST). Owns the two-mode split + dotenv load + client/AuthManager singleton
  auth.ts                 # AuthManager: username/password login + looksUnauthenticated(); delegates session lifecycle to CookieSessionManager; jar is the shared CookieJar from @chrischall/mcp-utils (absorb()/header(); deletion = Max-Age<=0 or pre-2000 Expires)
  transport.ts            # ArtsoniaRequest/Response/Transport types, ARTSONIA_ORIGIN, makeTransport() (picks fetch vs fetchproxy by env)
  transport-fetch.ts      # FetchArtsoniaTransport: default Node fetch; manual redirect on login POST, follow on reads; 30s timeout
  transport-fetchproxy.ts # FetchproxyArtsoniaTransport: usesBrowserSession=true; thin adapter over createFetchproxyTransport (@chrischall/mcp-utils/fetchproxy), lazy-imported + memoized one-time start on the shared port
  parse.ts                # node-html-parser scrapers: parseStudents, parseNotifications, parsePortfolio, parseArtwork, parseFans, parseFeedback, parseAwards, parseProfile + artworkImageUrl()
  version.ts              # VERSION constant (x-release-please-version marker)
  tools/
    healthcheck.ts        # artsonia_healthcheck
    students.ts           # artsonia_list_students, artsonia_get_activity
    portfolio.ts          # artsonia_get_portfolio, artsonia_get_artwork, artsonia_list_comments
    fans.ts               # artsonia_get_fans
    feedback.ts           # artsonia_get_feedback, artsonia_mark_feedback_read
    account.ts            # artsonia_get_awards, artsonia_get_profile
    download.ts           # artsonia_download_artwork + buildFilename()/buildRelPath() + FETCH_CONCURRENCY + the DownloadIO/DownloadContentBlock interface (imports NO node:fs)
    download-io.ts        # NodeDownloadIO: disk-backed IO (persistsFiles=true). The ONLY module in the download path that touches node:fs
    download-io-inline.ts # InlineDownloadIO: filesystem-free IO (persistsFiles=false) — accumulates image bytes and returns them as base64 MCP image blocks, capped at MAX_INLINE_BYTES (24 MiB); extraContent() DRAINS on read
    make-download-io.ts   # makeDownloadIO(): env-driven IO selector (ARTSONIA_INLINE_DOWNLOADS) — the sibling of make-transport.ts
    embed.ts              # embedJpegMetadata(): EXIF (piexif-ts) + hand-rolled IPTC APP13; lazily imported by download.ts
    writes.ts             # artsonia_post_comment, artsonia_invite_fan, artsonia_set_notifications + parseProfileForm()
```

`src/index.ts` builds an array of `(server) => register<Domain>Tools(server, client)` closures and hands them to `runMcp` from `@chrischall/mcp-utils`. Each `tools/*.ts` exports a `register<Domain>Tools(server, client)` that calls `server.registerTool(...)`.

### Download I/O (disk vs inline)

`artsonia_download_artwork` is the one tool that produces bytes rather than JSON, so **where those bytes go depends on who owns the filesystem**. `download.ts` never imports `node:fs`; it takes a `DownloadIO` and `makeDownloadIO()` picks one from the env (the same shape as `makeTransport()`):

- **Disk (default, `NodeDownloadIO`)** — a local stdio install: the server's filesystem *is* the user's, so writing `dest` is exactly right. `persistsFiles:true`; `extraContent()` returns `[]`, so the tool result is pure JSON.
- **Inline (`ARTSONIA_INLINE_DOWNLOADS=1`, `InlineDownloadIO`)** — a hosted deployment (e.g. mcp-host), where the "filesystem" is the runner's disk and the user can never reach it. Image bytes come back as base64 MCP image blocks appended to the JSON summary; `persistsFiles:false`, so the tool **omits** `index_file`/`metadata_count` rather than advertise sidecars/manifests nobody can fetch (honesty contract), `exists()` is always false (`skip_existing` never skips), and `mkdirp`/`setMtime` are no-ops.

Two traps live here:

- **One IO per invocation, and `extraContent()` drains on read.** `registerDownloadTools` takes a *factory* and calls it per tool call — a shared instance let two concurrent calls drain each other's buffers. Drain-on-read is the second half of that guarantee: any call site must read it exactly once.
- **`MAX_INLINE_BYTES` (24 MiB raw, ~32 MiB base64) is a real ceiling.** An unbounded pull (no `limit`, `resolution: full`) would otherwise blow a host's response-size limit. Over-cap images are dropped and reported in a text block — never silently truncated.

## Tool surface

All tools are `artsonia_*`-prefixed. R = read-only, W = write (confirm-gated). Reads/writes route through `ArtsoniaClient.fetchHtml()` / `.write()`.

| Tool | File | Endpoint(s) | R/W |
| --- | --- | --- | --- |
| `artsonia_healthcheck` | healthcheck.ts | GET `/members/` | R |
| `artsonia_list_students` | students.ts | GET `/members/` | R |
| `artsonia_get_activity` | students.ts | GET `/members/` (notifications) | R |
| `artsonia_get_portfolio` | portfolio.ts | GET `/artists/portfolio.asp?id=` (+ `/museum/art.asp?id=` per tile when `include_details:true`) | R |
| `artsonia_get_artwork` | portfolio.ts | GET `/museum/art.asp?id=` | R |
| `artsonia_list_comments` | portfolio.ts | GET `/museum/art.asp?id=` | R |
| `artsonia_get_fans` | fans.ts | GET `/members/fanclub/?artist=` | R |
| `artsonia_get_feedback` | feedback.ts | GET `/members/feedback/?artist=` | R |
| `artsonia_mark_feedback_read` | feedback.ts | POST `/members/feedback/default.asp?artist=` (`ConfirmAsRead`) | W |
| `artsonia_get_awards` | account.ts | GET `/artists/awards.asp?id=` | R |
| `artsonia_get_profile` | account.ts | GET `/members/profile/` | R |
| `artsonia_download_artwork` | download.ts | GET portfolio (+ detail pages) → `images.artsonia.com/art/<res>/<id>.jpg`; optional `write_index` → `index.json`; optional `write_metadata` → per-artwork `.json` sidecars (+ GET `/members/feedback/?artist=`) | W |
| `artsonia_post_comment` | writes.ts | POST `/museum/enter.asp?artist=&art=` (`Comment`) | W |
| `artsonia_invite_fan` | writes.ts | POST `/members/fanclub/add.asp?artist=` | W |
| `artsonia_set_notifications` | writes.ts | GET `/members/profile/` (read) → POST `/members/profile/default.asp` (read-modify-write) | W |

Notable args:
- `get_portfolio` `include_details:true` fetches each artwork's detail page concurrently (slower) and merges the scalar fields (drops the heavy per-artwork `comments`); off by default returns lean tiles in one request.
- `download_artwork` `write_index:true` writes an `index.json` manifest (artwork_id, title, file, grade, project, date) of what's on disk (downloaded + skipped); returned as `index_file`. Image CDN is public — no auth needed.
- `download_artwork` `write_metadata:true` writes a per-artwork `<image-name>.json` sidecar next to each image (downloaded + skipped) carrying the artwork's comments (same source as `list_comments`) and the student's teacher feedback for it (same source as `get_feedback`); count returned as `metadata_count`. `path_template` (e.g. `"{grade}/{project}"` or `"{school_year}"`) lays downloads out into subfolders composed with `filename_template` — same tokens + slugification, empty segments collapse, deterministic paths keep `skip_existing` idempotent; `{school_year}` (July–June) derives from the image's `Last-Modified`. `embed_metadata:true` embeds title/project/grade + the source date into each JPEG's EXIF/IPTC via a lazily-imported `embed.ts` (piexif-ts + hand-rolled IPTC APP13) — best-effort (a failed embed writes the original bytes), applies to freshly downloaded files only, count returned as `embedded_count`. `include_private:false` excludes private pieces (`private_excluded_count`). The result reports `total_bytes` + `private_count` and per-file `is_private`; the dry run adds `estimated_bytes`/`estimated_total_bytes` via HEAD probes of the public CDN (read-only). Unfiltered confirmed runs also re-read `/members/` and report a `count_check` (+ `warning`) when `downloaded+skipped` ≠ the student's `artwork_count`, so partial pulls don't pass silently.
- `download_artwork` under `ARTSONIA_INLINE_DOWNLOADS=1` returns the images themselves as base64 blocks and drops the on-disk extras — see "Download I/O (disk vs inline)" above for what changes.

## Conventions

- **TDD.** Write the failing test first; tests live under `tests/` (`vitest.config.ts` includes `tests/**/*.test.ts`) and mock at the `ArtsoniaClient` / transport level — no real network.
- **Confirm-gating.** Every write takes `confirm` (`schemaConfirm`). Without `confirm:true` the tool is a DRY RUN: it returns a preview (`preview:true`, `wouldSend`/resolved filenames) and makes **no mutating network call**. (Some previews still make READ calls to resolve their state — `set_notifications` reads `/members/profile/`, `download_artwork` reads the portfolio/detail pages for filenames — but never a write.)
- **Write-verification contract.** Writes report `verified:true/false` **honestly**. A 302/redirect is NOT proof a write persisted — Artsonia 302s even on payloads it silently drops. Where a cheap re-read exists (`set_notifications`, `mark_feedback_read`), the tool re-reads and only claims success when the change is observed; where it doesn't (`post_comment`, `invite_fan`), it reports `verified:false` with a "check the page to confirm" note.
- **stderr-only stdio.** stdout is reserved for JSON-RPC; logging/banners go to stderr (handled by `runMcp` / `loadDotenvSafely`).
- **ESM `.js` extensions** on relative imports even from `.ts` sources.

## Quirks

- **A 302 is not proof of persistence.** Artsonia accepts a POST (302s) even when the payload is subtly wrong and persists nothing. Re-read to verify (see write-verification contract above).
- **Submit a checkbox's real value, not `"on"`.** Artsonia opt-in checkboxes submit `value="Y"` when checked; a literal `"on"` is silently ignored (the save 302s but persists nothing). `parseProfileForm` captures each checkbox's real `value` and `set_notifications` re-sends it.
- **One field in a master form ⇒ read-modify-write.** The profile page is a single `#TheForm` carrying name/email/password/opt-ins. `set_notifications` reads the whole form, flips only the requested opt-in(s), and re-sends every other field verbatim (preserving `DidChangePassword="N"`). **Password fields (`OldPassword`/`NewPassword`/`NewPassword2`) are always blanked — never send a password.**
- **JS-driven login.** The login flow / form field names (`Username`/`Password`/`Action=login`, checkbox `Y` values, etc.) were captured by instrumentation against the live site, not from a documented API — scraping selectors and field names are empirical and can break if the markup changes.
- **CookieSessionManager single-flight + browser-session skip.** Direct mode delegates concurrent-login de-duplication and the one-replay-on-expiry to the shared manager. The fetchproxy/browser-session path never touches `AuthManager`/`withSession` — the browser tab carries the session and server-side login is skipped (`usesBrowserSession`), so `doLogin`'s 302+Location success marker (which never appears when the browser follows the redirect itself) is irrelevant there.
- **Lazy fetchproxy import.** The fetchproxy stack is reached only via a lazy `import('@chrischall/mcp-utils/fetchproxy')` inside the fetchproxy transport (and `import type` elsewhere, erased at build). The bundled `.mcpb` externalizes BOTH `@fetchproxy/server` and the `@chrischall/mcp-utils/fetchproxy` subpath — the subpath eagerly imports `@fetchproxy/server`, so bundling it would hoist that import to the bundle's top level and crash the server at load in the default `fetch` transport.
- **Comment-item markup is UNVERIFIED** (see note in `parse.ts`): 0-comment pages show no comment elements, so the `.comment` selector degrades to `[]` without throwing but hasn't been confirmed against an artwork that has comments.

## Versioning

Versioning is automated by **release-please** (`.github/workflows/release-please.yml`, `release-please-config.json`, `.release-please-manifest.json`). On every push to `main` it scans Conventional-Commit messages and opens/updates a `chore(main): release X.Y.Z` PR that bumps every registered file. Merging that release PR creates the `v<VERSION>` tag + GitHub Release, and the `publish` job packs `.mcpb` + `.skill`, publishes to npm (with provenance), the MCP Registry, and ClawHub.

The version string (currently `0.6.0`) is mirrored across these files — release-please owns all of them via `extra-files`; **do NOT bump manually**:

- `package.json` (`version`) + `package-lock.json`
- `src/version.ts` (`VERSION`, the `x-release-please-version` marker)
- `manifest.json` (`$.version`)
- `server.json` (`$.version` AND `$.packages[*].version`)
- `.claude-plugin/plugin.json` (`$.version`)
- `.claude-plugin/marketplace.json` (`$.plugins[*].version` AND `$.metadata.version`)
- `.release-please-manifest.json`

`tests/` includes a version-sync test asserting `src/version.ts` equals `package.json`.

## Publishing constraints

The MCP Registry's [server.schema.json](https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json) caps `server.json`'s `description` at **100 characters**. Values over that fail `mcp-publisher publish` with HTTP 422. Sanity-check before committing a description change:

```bash
jq -r '.description | length' server.json
```

<!-- pr-workflow:v3 -->
## Pull requests & release notes

Fleet policy — Conventional-Commit PR titles, labels, the auto-review /
auto-merge ladder, auto-review follow-up issues, PR timing, and release PRs —
lives in `~/.claude/CLAUDE.md`. Don't restate it here; the copies drifted.

Shared technical conventions (publishing, bundling, versioning guards,
write-verification, transport archetypes, testing traps) live in
[`chrischall/workflows`](https://github.com/chrischall/workflows):
`docs/fleet-conventions.md`, plus `README.md` for the CI pipeline contract.

## What to *not* do

- **Don't bump versions or create tags by hand** — release-please owns every version file listed above.
- **Don't claim a write succeeded on a 302.** Honor the write-verification contract: re-read where possible, report `verified:false` otherwise.
- **Don't send a password.** `set_notifications` blanks all password fields; auth lives in env vars (direct) or the browser session (fetchproxy), never inline.
- **Don't paste real cookies or credentials into tests.** Mock at the `ArtsoniaClient` / transport boundary; the live login was instrumented, not embedded.
- **Don't break the "no env vars set" smoke path.** The server must boot cleanly so MCP hosts can complete install-time `tools/list` — the missing-creds error is deferred to the first tool call.
- **Don't eager-import `@fetchproxy/server` or `@chrischall/mcp-utils/fetchproxy`.** Keep them behind the lazy `import()` (and keep both in the bundle script's `--external` list) so the default `fetch` transport (and the externalized `.mcpb` bundle) never touch them.
- **Don't change the shared fetchproxy port** (`37149`, `ARTSONIA_WS_PORT` default).
- **Don't import `node:fs` into `download.ts`** (or make the disk IO the unconditional default). The `DownloadIO` seam is what lets a hosted deployment return artwork inline; `node:fs` belongs only in `download-io.ts`.
- **Don't make `extraContent()` non-draining**, don't call it twice per invocation, and don't hoist the IO back out to a shared instance. Either change lets one call's images surface in another's result.
