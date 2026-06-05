# Artsonia endpoint capture (parent/fan role)

Captured live 2026-06-05 from a signed-in parent session via Chrome.
**Shapes only — no cookies/tokens/PII committed.**

Artsonia is a **classic server-rendered jQuery `.asp` site** (jQuery 3.7.1,
jQuery UI, blockUI, sweetalert, js.cookie). No SPA framework, no JSON store,
no JSON API for these pages — **data lives in the server-rendered HTML**, so
the MCP parses HTML with `node-html-parser`. No Cloudflare interstitial
observed. Auth is the session cookie carried by the browser; **no CSRF /
`__VIEWSTATE` token** on any form.

## Authentication — username/password (verified live 2026-06-05)

Primary auth is a **server-side cookie-session login** — no browser bridge
needed (no Cloudflare wall). Verified by capturing a real login:

- Login form `LoginForm` at GET `/members/login.asp?url=<dest>&login=y` with
  inputs `Username` (email), `Password`, `TargetUrl` (hidden), `Action`
  (hidden). The `Username`/`Password` inputs are JS-injected (absent from the
  bare HTML), but the submit is a **plain synchronous form POST — no AJAX**:
  - **`POST /members/login.asp`**, `Content-Type: x-www-form-urlencoded`
  - Body: **`Username=<email>&Password=<password>&TargetUrl=/members/&Action=login`**
  - Response: **302 redirect** to `TargetUrl` + **`Set-Cookie` session cookie
    (HttpOnly)**. No CSRF token.
- The client stores ALL cookies from the login response in a cookie jar and
  sends them on every subsequent request. Session expiry is detected by a
  redirect back to `/members/login.asp` (→ re-login).
- A remembered-account **`restore`** flow exists (`Action=restore` with
  `UserToken`/`UserID`, no password) — not used by the MCP; we always do a
  fresh `Action=login`.
- `magic-link` (passwordless email) also exists — not used.

**fetchproxy is an optional fallback only** (kept available for any future
endpoint that needs the real browser); the default transport is direct
`fetch` with the cookie jar.

Identifiers:
- **artistId** (a child/student), e.g. `16011097` (Finn), `13447141` (Lucas).
  Source: `portfolio.asp?id=<artistId>` and `?artist=<artistId>` params.
- **artworkId** (numeric), e.g. `150567537`. Source: `art.asp?id=<artworkId>`.
  Thumbnail: `https://images.artsonia.com/art/small/<artworkId>.jpg`.

## Reads (GET, server-rendered HTML)

| Tool | Path | Parse target |
|------|------|--------------|
| list_students | `/members/` | `.artist-card` → artistId (from `portfolio.asp?id=`), name, school, grade, counts (artworks/fans/comments/feedback/awards) |
| get_activity / notifications | `/members/` | Notifications section (count + items) |
| get_portfolio | `/artists/portfolio.asp?id=<artistId>` | `.grid-item` → artworkId (from `art.asp?id=`), title, `private-art` flag, thumbnail |
| get_artwork | `/museum/art.asp?id=<artworkId>` | title (page `<title>`), artist screen-name, view count, keepsakes, comment link |
| list_comments | `/members/comments/?artist=<artistId>` | comments list (empty state when 0) |
| get_fans | `/members/fanclub/?artist=<artistId>` | `.fan-card` / `.fan-row` → fan name, relationship |
| get_feedback | `/members/feedback/?artist=<artistId>` | `.comment-row` → `.comment` (message), `.commenter` (who/when), `.comment-art a` (artwork), `.comment-options` "not been marked as read" (unread flag) |

## Writes (POST, `application/x-www-form-urlencoded`, session-cookie auth, no CSRF)

### post_comment — BUILD NOW ✅
- Form `CommentForm` (`#Form1`) served by GET
  `/members/comments/enter.asp?artist=<artistId>&art=<artworkId>`.
- Submits as a plain form POST (`$("#Form1").submit()`, no AJAX) to:
  - **`POST /museum/enter.asp?artist=<artistId>&art=<artworkId>`**
  - Body: **`Comment=<text>`** (single field). No hidden/token fields.

### invite_fan — verifiable ✅ (isolated form)
- Form `#TheForm` served by GET `/members/fanclub/add.asp?artist=<artistId>`.
- **`POST /members/fanclub/add.asp?artist=<artistId>`**
- Fields: `MemberType` (hidden), `RelationshipID` (select), `IsParent`
  (checkbox), `FirstName`, `LastName`, `EmailAddress`, `OwnerMode` (checkbox),
  `ArtistID` (hidden; plus per-artist checkboxes to invite to multiple kids'
  fan clubs). Sends an invite email — test only to `@example.com`.

### set_notifications — verifiable but RISKY ⚠️
- Opt-ins live inside the **master profile form** `ParentProfileForm`
  (`#TheForm`) at GET `/members/profile/`, posting to
  **`POST /members/profile/default.asp`**.
- Same form ALSO carries `FirstName`, `LastName`, `EmailAddress`,
  `EmailAddressPrev` (hidden), `OldPassword`/`NewPassword`/`NewPassword2`,
  `DidChangePassword` (hidden), `MobileCountryCode`/`MobileNumber`,
  `Action` (hidden), `VerificationCode` (hidden).
- Notification toggles: `OptInNews`, `OptInArtistActivity` (default checked),
  `OptInPromos` (checkboxes; HTML omits unchecked → presence = on).
- Toggling requires read-modify-write of the WHOLE profile (re-send all
  current values, flip only the opt-in, leave password fields blank /
  `DidChangePassword=0`). Bundles PII + email-change/password logic.
  **Design decision pending** (see spec) — may ship as read-only status
  instead.

### mark_feedback_read — verified form shape ✅ (live-executed: pending)
- Form `#TheForm` on `/members/feedback/?artist=<artistId>` with a single submit
  input `name="ConfirmAsRead"` value `"Mark as Read"`.
- **`POST /members/feedback/default.asp?artist=<artistId>`**, body
  **`ConfirmAsRead=Mark as Read`**. Marks ALL of the student's feedback as read
  (no per-item control). `get_feedback` is live-verified; this write's shape is
  captured but not yet live-executed (left to the user — marking consumes the
  unread state). As with all writes here, a 302 alone is not proof — re-read
  `get_feedback` to confirm `is_read` flips.

### star_artwork — NOT AVAILABLE ❌
- No star/applause/favorite control or endpoint exists on the artwork page
  for the parent role (`starInHtml: false`, no star endpoints). Dropped per
  the verify-then-ship rule.

## Real DOM structures (verified live 2026-06-05 — parser selectors)

Top-level selectors confirmed during recon; these are the **inner** structures
(initial synthetic fixtures guessed these wrong — corrected here).

### Dashboard `/members/`
- **Students:** `.artist-card` (one per child). Inside:
  - name → first `a.lightlink` (text, e.g. "Finn Hall").
  - school/grade → a child `<div>` whose text is `Currently at <School> (Grade <N>)`.
  - stats → `.stats-container .stat` divs, each text `"<n> <label>"` where label ∈
    {artworks, fans, comments, feedback, awards}; some `.stat` also carry
    `.stat-inactive`.
- **Notifications:** heading `.textSubhead` with text `Notifications (N)` (count in
  the parens). Items are `div.notice` (NOT `a.notice`). Inside a `.notice`:
  title → `a.lightlink` (text + href); body → the sibling `<div>` after the
  title block.

### Portfolio `/artists/portfolio.asp?id=<artistId>`
- Artwork tiles are `.grid-item` elements **that contain an `a[href*="art.asp"]`**
  (the first `.grid-item` is a non-artwork section header with the school name +
  count — it has no art link, so the "must contain an art.asp link" filter drops
  it). artwork_id from `art.asp?id=`.
- **No artwork title at the tile level** (link `title`/img `alt` are null; tile
  textLabels are just "grade N" and a comment count). Thumbnail is derivable:
  `https://images.artsonia.com/art/small/<artworkId>.jpg`.
- Private pieces: a `.textLabel.private-art` label (class contains `private-art`).

### Artwork detail `/museum/art.asp?id=<artworkId>`
- title + screen-name → from `<title>`: `... "<Title>" by <ScreenName>`.
- views → a `.textNormal` whose text is `"<n> artwork views"`.
- "created by <ScreenName> in Grade <N> at <School>" → a `.textNormal` block.
- project/assignment → a block `from school project "<Project>"` (closest thing
  to a description; these artworks have no free-text artist statement).
- comment entry link → `a[href*="comments/enter.asp"]`.
- **Comments list: UNVERIFIED.** Both this account's children have 0 comments, so
  no comment-list markup is observable here. When 0 comments, `[class*="comment"]`
  matches nothing (only the "Comment on …" link exists). The comment-item
  structure must be confirmed against an artwork that actually has comments before
  the comments parser is trusted.

### Fan club `/members/fanclub/?artist=<artistId>`
- `.fan-card` (one per fan). Inside: name → first `a.hiddenlink` (text);
  relationship → a `<div>` whose own-text is the relationship (e.g. "Father"); the
  card also contains a `<b>Registered</b>` marker and the fan's email — do NOT
  surface the email in tool output unless intended.

## Live write verification (executed 2026-06-05 against the real account)

- **`set_notifications` ✅ confirmed** — but only after a fix the live run forced:
  the opt-in checkboxes submit **`value="Y"`** (a literal `on` is silently
  ignored — the save 302s but persists nothing), and `DidChangePassword` is
  **`"N"`** (not `"0"`). The tool now captures each checkbox's real value and
  re-sends `DidChangePassword` verbatim. Verified: a toggle persists and
  re-reads back; FirstName/EmailAddress are untouched. **The 302 alone is NOT
  proof of success on this form** — re-read to confirm.
- **`invite_fan` ✅ confirmed** — POST created a real pending fan (showed up in
  the fan club with the test `@example.com` email). The assumed `MemberType=fan`
  is correct.
- **`post_comment` ⚠️ submitted, not positively confirmed** — the POST is
  accepted and 302s to a content page (`/schools/school.asp`), not a form bounce,
  but the comment does **not** appear on the public artwork page or the parent
  comments view. Most likely **held for teacher moderation** (standard for K-12
  parent comments). Could not be confirmed from the parent side. Treat
  `posted:true` as "submitted/pending," not "publicly visible."
