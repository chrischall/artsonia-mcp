# Changelog

## [0.7.0](https://github.com/chrischall/artsonia-mcp/compare/v0.6.2...v0.7.0) (2026-07-13)


### Features

* **skill:** add artsonia curl access skill ([#55](https://github.com/chrischall/artsonia-mcp/issues/55)) ([93e9e08](https://github.com/chrischall/artsonia-mcp/commit/93e9e081a77c2387dd57e77e004987b2ebd31e6f))


### Bug Fixes

* **skill:** harden artsonia-api SKILL.md setup and login curl ([#58](https://github.com/chrischall/artsonia-mcp/issues/58)) ([5affe36](https://github.com/chrischall/artsonia-mcp/commit/5affe36b1b94b3a2539e7f94def9ebc30974cef3)), closes [#56](https://github.com/chrischall/artsonia-mcp/issues/56)

## [0.6.2](https://github.com/chrischall/artsonia-mcp/compare/v0.6.1...v0.6.2) (2026-07-07)


### Bug Fixes

* bump @chrischall/mcp-utils to ^0.12.0 ([#49](https://github.com/chrischall/artsonia-mcp/issues/49)) ([a5da994](https://github.com/chrischall/artsonia-mcp/commit/a5da9942913f0236b7dbfe82ed1577b71cb5a253))


### Refactor

* shared CookieJar + createFetchproxyTransport; bump @fetchproxy/server to 1.3 ([#46](https://github.com/chrischall/artsonia-mcp/issues/46)) ([9a14e28](https://github.com/chrischall/artsonia-mcp/commit/9a14e280d687f581403e0f2fe3c337a051161fc5))


### Documentation

* document first-party dependency-bump label exception ([#50](https://github.com/chrischall/artsonia-mcp/issues/50)) ([88bd109](https://github.com/chrischall/artsonia-mcp/commit/88bd109e117bc17a4f3d0dd5c2a34af6095ce176))

## [0.6.1](https://github.com/chrischall/artsonia-mcp/compare/v0.6.0...v0.6.1) (2026-07-03)


### Documentation

* refresh version note and add auto-review follow-up convention ([#37](https://github.com/chrischall/artsonia-mcp/issues/37)) ([3d89264](https://github.com/chrischall/artsonia-mcp/commit/3d8926455440c1da4a5241c41692baad9a60bc7f))
* require Conventional Commit PR titles for release-please ([#35](https://github.com/chrischall/artsonia-mcp/issues/35)) ([af66251](https://github.com/chrischall/artsonia-mcp/commit/af6625129995c21db6b0bed2bde9f2ee4b73eeb0))

## [0.6.0](https://github.com/chrischall/artsonia-mcp/compare/v0.5.0...v0.6.0) (2026-06-13)


### Features

* download richer result + dry-run estimates + comments/feedback sidecars ([#30](https://github.com/chrischall/artsonia-mcp/issues/30)) ([d8cfcaf](https://github.com/chrischall/artsonia-mcp/commit/d8cfcaf9c52126d47848f2070e354d66288b7752))
* embed EXIF/IPTC metadata and folder templates for artwork downloads ([#31](https://github.com/chrischall/artsonia-mcp/issues/31)) ([e720c44](https://github.com/chrischall/artsonia-mcp/commit/e720c44de192b4484de6a7e6ad3fcb27656d7f08)), closes [#13](https://github.com/chrischall/artsonia-mcp/issues/13) [#14](https://github.com/chrischall/artsonia-mcp/issues/14)


### Bug Fixes

* bot PRs bypass the CI gate unconditionally ([#28](https://github.com/chrischall/artsonia-mcp/issues/28)) ([299f3c5](https://github.com/chrischall/artsonia-mcp/commit/299f3c53bf6cc8793016356af62696d839641e4b))


### Documentation

* add CLAUDE.md cohort guide ([#24](https://github.com/chrischall/artsonia-mcp/issues/24)) ([c9c9094](https://github.com/chrischall/artsonia-mcp/commit/c9c9094c8b77723760e9391eac9afe470cf1502a))
* add MIT LICENSE file and README badges ([#26](https://github.com/chrischall/artsonia-mcp/issues/26)) ([46a10e4](https://github.com/chrischall/artsonia-mcp/commit/46a10e411e6647009b997f457ef8691043552b60))

## [0.5.0](https://github.com/chrischall/artsonia-mcp/compare/v0.4.0...v0.5.0) (2026-06-10)


### Features

* portfolio include_details + download index.json manifest ([#22](https://github.com/chrischall/artsonia-mcp/issues/22)) ([33925b4](https://github.com/chrischall/artsonia-mcp/commit/33925b4e3315ad201457da2377653d18f508efce))


### Bug Fixes

* skip server login in fetchproxy mode + verify writes persisted ([#18](https://github.com/chrischall/artsonia-mcp/issues/18)) ([3959eab](https://github.com/chrischall/artsonia-mcp/commit/3959eab5f19bbd9c8e304cdfde4914a2a25ff141))


### Refactor

* adopt CookieSessionManager for direct-mode auth lifecycle ([#20](https://github.com/chrischall/artsonia-mcp/issues/20)) ([53212cf](https://github.com/chrischall/artsonia-mcp/commit/53212cfb9f963ff318bb6b18ece43fabf47af53c))
* adopt mcp-utils 0.9/0.10 atoms (NumericIdString, mapWithConcurrency) ([#23](https://github.com/chrischall/artsonia-mcp/issues/23)) ([96eca5a](https://github.com/chrischall/artsonia-mcp/commit/96eca5a3b9ee3c84e093f6e6dade78ded7089454))
* route direct-mode replay through CookieSessionManager.withSession ([#21](https://github.com/chrischall/artsonia-mcp/issues/21)) ([6902131](https://github.com/chrischall/artsonia-mcp/commit/690213186f91ab9f84c23e7a4d718f88f31822e6))

## [0.4.0](https://github.com/chrischall/artsonia-mcp/compare/v0.3.0...v0.4.0) (2026-06-05)


### Features

* **download:** descriptive filenames + source-accurate timestamps + idempotent re-runs ([#10](https://github.com/chrischall/artsonia-mcp/issues/10)) ([1a9115e](https://github.com/chrischall/artsonia-mcp/commit/1a9115e13176b16e1936477ea99f998734784cf2))

## [0.3.0](https://github.com/chrischall/artsonia-mcp/compare/v0.2.0...v0.3.0) (2026-06-05)


### Features

* add get_awards and get_profile reads ([#9](https://github.com/chrischall/artsonia-mcp/issues/9)) ([651458c](https://github.com/chrischall/artsonia-mcp/commit/651458cc214240bfd922ab956eda6dc0cfa28559))
* add teacher feedback tools (get_feedback + mark_feedback_read) ([#6](https://github.com/chrischall/artsonia-mcp/issues/6)) ([bfc5015](https://github.com/chrischall/artsonia-mcp/commit/bfc50156255a4d851ab578b3e7854dbb5e06baa1))
* download artwork (by student / class / grade / most-recent N) ([#8](https://github.com/chrischall/artsonia-mcp/issues/8)) ([0e2fe61](https://github.com/chrischall/artsonia-mcp/commit/0e2fe6114ec0acc108bcd8a1cf61711f9cb56f2a))


### Bug Fixes

* server crashed on launch (eager fetchproxy import + wrong bin path) ([#5](https://github.com/chrischall/artsonia-mcp/issues/5)) ([c38f173](https://github.com/chrischall/artsonia-mcp/commit/c38f173b8424f204328fd4a5ec044b461c88bdf0))

## [0.2.0](https://github.com/chrischall/artsonia-mcp/compare/v0.1.0...v0.2.0) (2026-06-05)


### Features

* add artsonia_healthcheck tool (Task 12) ([8ac65a9](https://github.com/chrischall/artsonia-mcp/commit/8ac65a9470e8c4c23e2553d30e8ba2084c989899))
* add ArtsoniaClient with session-aware fetch/write ([cdde30a](https://github.com/chrischall/artsonia-mcp/commit/cdde30abb974e7753dfec67710932c23b2be2fcd))
* add AuthManager username/password login ([307737b](https://github.com/chrischall/artsonia-mcp/commit/307737bac71d7f357b57d73562a6bbc98bc3b182))
* add confirm-gated post_comment, invite_fan, set_notifications writes ([a5f85c6](https://github.com/chrischall/artsonia-mcp/commit/a5f85c644dc2f4e7419ada292ad26a09730b0587))
* add CookieJar for session cookies ([9f88807](https://github.com/chrischall/artsonia-mcp/commit/9f8880728124775a44ff3be524c4eef8cd3fa5aa))
* add get_fans tool ([c6f4bd9](https://github.com/chrischall/artsonia-mcp/commit/c6f4bd91e982910ffdd020a487c83179aec1b6c5))
* add HTML parsers for students, portfolio, artwork, fans, notifications ([45bd7eb](https://github.com/chrischall/artsonia-mcp/commit/45bd7eb457752b0f4a821d389b584af43559ab3a))
* add list_students and get_activity tools ([8da62a9](https://github.com/chrischall/artsonia-mcp/commit/8da62a9a6b492d9a00f03bff35c8f5ffb6732d47))
* add optional fetchproxy fallback transport ([f88763e](https://github.com/chrischall/artsonia-mcp/commit/f88763ec23ef11ac9f786637ef91e14b3572cd60))
* add portfolio, artwork, and comments read tools ([23efa67](https://github.com/chrischall/artsonia-mcp/commit/23efa67dbb64e485e80b10642d08b875b6c19e40))
* add transport interface and node-fetch transport ([d7d1482](https://github.com/chrischall/artsonia-mcp/commit/d7d1482a5d520d5b69cebd095f4300e5b57a8749))
* initial artsonia-mcp implementation (parent/fan, username+password) ([6081208](https://github.com/chrischall/artsonia-mcp/commit/6081208eca5c163477fcd605e348d52a416841f5))
* wire all tools into runMcp entrypoint (Task 13) ([14bfae1](https://github.com/chrischall/artsonia-mcp/commit/14bfae19983533a5bcf19fab515aff48dab647d5))


### Bug Fixes

* credential-centric error on failed Artsonia login ([e970fed](https://github.com/chrischall/artsonia-mcp/commit/e970fedc4e4eb5b94dfb4207b82670a4b233cbc5))
* detect write session-expiry via Location; distinguish bad-creds from no-creds in healthcheck ([44e5974](https://github.com/chrischall/artsonia-mcp/commit/44e5974219c76f987bed63697d309057e13156af))
* **parse:** rewrite parsers against live-verified Artsonia markup ([f628fbd](https://github.com/chrischall/artsonia-mcp/commit/f628fbd0f7ac3ab823d39e8ec322e4fd19aa8759))
* **writes:** submit opt-in checkboxes as value=Y, preserve DidChangePassword ([5af82c1](https://github.com/chrischall/artsonia-mcp/commit/5af82c1ff69dda0e295dd18aefc599d06a9b8be2))


### Documentation

* add artsonia-mcp design spec ([f64d2d0](https://github.com/chrischall/artsonia-mcp/commit/f64d2d08b9129255a6e043ccbc097572c8bd75a0))
* add artsonia-mcp implementation plan ([b4da03e](https://github.com/chrischall/artsonia-mcp/commit/b4da03e01bd9c3b19e86cc1e01a02e823db2c9a7))
* pivot to cookie-session username/password auth ([e0851ab](https://github.com/chrischall/artsonia-mcp/commit/e0851ab601d851cec4eba6fd21557b02b9c0e8c5))
* record live write-verification results (checkbox value=Y, comment moderation) ([07b0af6](https://github.com/chrischall/artsonia-mcp/commit/07b0af68395edce49269560922a6089f8e7b18d7))
* record real DOM structures for parser selectors (live-verified) ([483ed7b](https://github.com/chrischall/artsonia-mcp/commit/483ed7bd3f6a36d33beffc8481535838c84855f8))
* record verified Artsonia endpoints and update spec ([ba17ae4](https://github.com/chrischall/artsonia-mcp/commit/ba17ae4e4b251b10a98527ae76e7e536c35f917d))
