# Deploying the Artsonia remote connector

This is the operator runbook for standing up `artsonia-mcp` as a hosted
Cloudflare Worker — a "remote connector" that anyone you share the URL with can
add to claude.ai (web, desktop, or mobile), each logging in with their own
Artsonia parent/fan account. It's a manual, one-time (per operator) process;
there is no CI/CD path for it, and none of the steps below can be done by an
agent since they require your own Cloudflare account.

If you just want the server on your own machine talking only to your own
Artsonia account, you don't need any of this — see the main [README](../README.md)
for the local stdio / `.mcpb` install instead, which is the desktop-only
alternative to running a shared connector.

## Prerequisites

- A Cloudflare account (free tier is fine).
- Node and this repo checked out with dependencies installed (`npm install`).
- **No app-level Artsonia API keys are required.** Unlike some connectors,
  Artsonia has no operator-shared `client_id` / `client_secret`. Each user
  authenticates with their own Artsonia email + password, collected by the
  connector's own OAuth login page (step 4) — you never handle anyone's Artsonia
  credentials.

### How Artsonia auth works on the connector

Artsonia has no public API and no long-lived token: it's a classic
server-rendered site that authenticates a `POST /members/login.asp` form and
hands back a short-lived HttpOnly `SESSION` cookie. That login runs fine from a
serverless runtime — no browser, no extension — so the connector stores each
user's **email + password** (encrypted at rest in `OAUTH_KV`) and re-runs the
form login on their behalf whenever the session cookie expires. This is the same
direct login the stdio server uses; the optional `fetchproxy` browser-bridge
fallback is a **stdio-only** feature and is never bundled into the Worker.

> **Stateless — no cache Durable Object.** Artsonia reads always hit the live
> site, so unlike the OFW connector there is no per-user cache: the only Durable
> Object is `ArtsoniaMcpAgent` (the per-session MCP agent), declared in
> `wrangler.jsonc` with a `v1` SQLite migration applied automatically by
> `wrangler deploy`.
>
> **Downloads are inline on the Worker.** `artsonia_download_artwork` writes
> images to a local folder on the stdio server; the Worker has no filesystem, so
> it returns the downloaded image bytes as MCP image content blocks instead.

## Steps

### 1. Log in to Cloudflare

```sh
npx wrangler login
```

This opens a browser to authorize the CLI against your Cloudflare account. (A
token with **Workers Scripts:Edit + Workers KV Storage:Edit** — the "Edit
Cloudflare Workers" template — also works; a read-only / zone-only token fails
KV-create and deploy.)

### 2. Create the OAuth KV namespace

The connector stores OAuth state and per-user session data (including each user's
encrypted Artsonia credentials) in a KV namespace bound as `OAUTH_KV` (see
`wrangler.jsonc`). Give it a distinct title so it never cross-wires with another
connector's OAuth store:

```sh
npx wrangler kv namespace create artsonia-connector-oauth
```

The command prints something like:

```
{ "binding": "OAUTH_KV", "id": "abcd1234..." }
```

Copy the returned `id` into `wrangler.jsonc`, replacing the
`"REPLACE_WITH_OAUTH_KV_NAMESPACE_ID"` placeholder:

```jsonc
"kv_namespaces": [{ "binding": "OAUTH_KV", "id": "abcd1234..." }],
```

### 3. Deploy

```sh
npm run worker:deploy
```

This runs `wrangler deploy`, which builds and pushes `src/worker.ts` (plus the
`ArtsoniaMcpAgent` per-session agent Durable Object binding, and the `OAUTH_KV`
namespace from step 2). On success it prints the deployed URL:

```
https://artsonia-connector.<your-subdomain>.workers.dev
```

Because `wrangler.jsonc` also declares a custom-domain route
(`connector.artsonia.nullnet.app`, matching ofw-mcp's `connector.ofw.nullnet.app`
and zola-mcp's `connector.zola.nullnet.app`), the connector is additionally
served at:

```
https://connector.artsonia.nullnet.app
```

Use the custom domain as the stable production URL you share. (The zone must be
in the deploying Cloudflare account; if it isn't, remove the `routes` entry from
`wrangler.jsonc` and use the `*.workers.dev` URL instead. The edge TLS cert
provisions a few minutes after deploy — `https` may fail to connect meanwhile;
that self-heals.) Note whichever URL you use — it's what gets added as a
connector, with `/mcp` appended.

Before deploying to production, you can sanity-check the Worker locally with:

```sh
npm run worker:dev
```

confirm it bundles without deploying:

```sh
npx wrangler deploy --dry-run
```

and run the Worker-specific test suite (Miniflare / real Workers runtime) with:

```sh
npm run worker:test
```

### 4. Add it as a connector in claude.ai

1. Go to claude.ai → **Settings** → **Connectors** → **Add custom connector**.
2. Paste the deployed URL with `/mcp` appended — the custom domain
   `https://connector.artsonia.nullnet.app/mcp` (or, without a custom domain,
   `https://artsonia-connector.<your-subdomain>.workers.dev/mcp`).
3. Claude will open the connector's login page (served by the Worker at
   `/authorize`) and prompt for an **Artsonia email + password**. The credentials
   are verified by running the real `POST /members/login.asp` form login before
   the session is created — a wrong password (or a magic-link-only account) is
   rejected on the login page.

This connector is unlisted: it only shows up for people you've explicitly shared
the URL with, not in any public directory. Anyone with the URL who supplies their
own valid Artsonia credentials can use it under their own account.

### 5. Verify on the mobile Claude app

Connectors added on claude.ai sync to all clients for that account, including the
**mobile Claude app**. On mobile:

1. Confirm the connector appears (Settings → Connectors) and shows as connected.
2. Run a read, e.g. ask Claude to run `artsonia_list_students` or
   `artsonia_get_portfolio`.
3. Run a low-stakes action to confirm the write tools are wired up.

If both work, the deploy is verified end-to-end.

## How auth works

- There are **no operator-level Artsonia credentials.** Artsonia has no shared
  app `client_id` / `client_secret`; the connector authenticates each user
  individually.
- Each **user** who adds the connector logs in with their *own* Artsonia email +
  password, via the login page the Worker serves at `/authorize`. The
  credentials are verified (a real form login against `www.artsonia.com`) before
  the session is created.
- Those credentials are stored **encrypted at rest** in the OAuth provider's
  KV-backed "props" (`OAUTH_KV`), scoped to that user's session. Because Artsonia
  issues no long-lived token, the stored email + password are used to build a
  per-user `ArtsoniaClient` that re-runs the form login whenever its session
  cookie expires. They are used only to sign in to Artsonia on that user's
  behalf, never for anything else.

## Rotation / teardown

There are no operator secrets to rotate for Artsonia auth (users manage their own
accounts; a user rotates by re-adding the connector after changing their Artsonia
password).

Tear down the whole connector:

```sh
npx wrangler kv namespace delete --namespace-id <id-from-step-2>
```

then delete the Worker itself from the Cloudflare dashboard (Workers &
Pages → `artsonia-connector` → Settings → Delete), or via:

```sh
npx wrangler delete
```

Deleting the KV namespace invalidates every stored user session — everyone who
had added the connector will need to log in again with their credentials if it's
redeployed.
