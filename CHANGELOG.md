# Changelog

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
