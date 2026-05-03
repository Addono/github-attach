## [1.6.1](https://github.com/Addono/gh-attach/compare/v1.6.0...v1.6.1) (2026-05-03)


### Bug Fixes

* resolve eslint breaking change for v10.3.0 ([272a841](https://github.com/Addono/gh-attach/commit/272a8415c9fc3a2504ad0e2a67bcdf12ae32999d))

# [1.6.0](https://github.com/Addono/gh-attach/compare/v1.5.8...v1.6.0) (2026-04-27)


### Features

* **auth:** fall back to GitHub CLI token when env vars are unset ([#82](https://github.com/Addono/gh-attach/issues/82)) ([f6d834c](https://github.com/Addono/gh-attach/commit/f6d834cc9be662967ad1e1eda6d898a413bd4872))

## [1.5.8](https://github.com/Addono/gh-attach/compare/v1.5.7...v1.5.8) (2026-04-22)


### Bug Fixes

* match npm registry URL for OIDC publishing ([5e4edf1](https://github.com/Addono/gh-attach/commit/5e4edf1e20947d18b24f58aabc785af7cf546468))
* resolve release version without npm auth ([9c364d0](https://github.com/Addono/gh-attach/commit/9c364d0d268996d5bb35f50541963d57f59920b6))
* use supported toolchain for trusted publishing ([99368f3](https://github.com/Addono/gh-attach/commit/99368f3f26f3b97356fb50099b87f1d8e38b3f9e))

## [1.5.7](https://github.com/Addono/gh-attach/compare/v1.5.6...v1.5.7) (2026-03-30)


### Bug Fixes

* fall back to gh auth in MCP server ([#60](https://github.com/Addono/gh-attach/issues/60)) ([7a6289c](https://github.com/Addono/gh-attach/commit/7a6289c9c45deb9cf9a94e1eee9529fd445006b8))

## [1.5.6](https://github.com/Addono/gh-attach/compare/v1.5.5...v1.5.6) (2026-03-30)


### Bug Fixes

* improve MCP upload fallback and setup docs ([#58](https://github.com/Addono/gh-attach/issues/58)) ([58e74b7](https://github.com/Addono/gh-attach/commit/58e74b7d0b1807f688828ed5ff4e48de6c57cfdd))

## [1.5.5](https://github.com/Addono/gh-attach/compare/v1.5.4...v1.5.5) (2026-03-30)


### Bug Fixes

* align release tests with computed build version ([#51](https://github.com/Addono/gh-attach/issues/51)) ([f2bd3d6](https://github.com/Addono/gh-attach/commit/f2bd3d6f005515db55fed5b186e6e690ddcdc135))
* inject release version during binary build ([#50](https://github.com/Addono/gh-attach/issues/50)) ([6496db2](https://github.com/Addono/gh-attach/commit/6496db2ff3f1aec626654f934d38a60027b7dd8f))
* validate releases before publishing ([#52](https://github.com/Addono/gh-attach/issues/52)) ([dc6b449](https://github.com/Addono/gh-attach/commit/dc6b449d83e85ab590eb9538042be89c99bc7721))

## [1.5.4](https://github.com/Addono/gh-attach/compare/v1.5.3...v1.5.4) (2026-03-30)


### Bug Fixes

* build gh extension binaries on native runners ([#46](https://github.com/Addono/gh-attach/issues/46)) ([2240c52](https://github.com/Addono/gh-attach/commit/2240c52c7dbfa0bb3d96be661fa0d513da43735c))
* restore release artifact execute bits ([#49](https://github.com/Addono/gh-attach/issues/49)) ([2fc46f7](https://github.com/Addono/gh-attach/commit/2fc46f797b886c931730a915d21b29cd8bed0ac3))
* run pkg through the Windows shell ([#48](https://github.com/Addono/gh-attach/issues/48)) ([5c92f00](https://github.com/Addono/gh-attach/commit/5c92f00707a75c8e06ae01a864bae22ccc60ec93))
* use supported macOS runner for release builds ([#47](https://github.com/Addono/gh-attach/issues/47)) ([7c9d5a4](https://github.com/Addono/gh-attach/commit/7c9d5a43dde65139173fab213e571540afd63cb6))

## [1.5.3](https://github.com/Addono/gh-attach/compare/v1.5.2...v1.5.3) (2026-03-30)


### Bug Fixes

* handle string chunks from stdin ([fe23f32](https://github.com/Addono/gh-attach/commit/fe23f32c68b9f4016daf6a08ef60bb20c496473a))

## [1.5.2](https://github.com/Addono/gh-attach/compare/v1.5.1...v1.5.2) (2026-03-23)


### Bug Fixes

* harden gh extension installs ([#33](https://github.com/Addono/gh-attach/issues/33)) ([964776b](https://github.com/Addono/gh-attach/commit/964776b52ac8b5586a55f77e2548d37d6828f314))

## [1.5.1](https://github.com/Addono/gh-attach/compare/v1.5.0...v1.5.1) (2026-03-02)


### Bug Fixes

* bake version at build time and remove Playwright from login flow ([e6be1d5](https://github.com/Addono/gh-attach/commit/e6be1d58c74664a8c2c4f37ea0d7794561047ec3))
* replace Playwright browser login with gh auth token ([77f2dee](https://github.com/Addono/gh-attach/commit/77f2dee4406054937164cea2fb16b6ddea90f656))

# [1.5.0](https://github.com/Addono/gh-attach/compare/v1.4.0...v1.5.0) (2026-03-02)


### Bug Fixes

* throw on missing download URL; suppress ExperimentalWarning ([b7936da](https://github.com/Addono/gh-attach/commit/b7936da4a909c9fc21fc37fbbb7f91811a9d93b3)), closes [owner/repo#N](https://github.com/owner/repo/issues/N)


### Features

* add title and description to gh-attach-assets release ([9cc2590](https://github.com/Addono/gh-attach/commit/9cc25902e6da642faed9683807b84ce513d72fb0)), closes [#attach-assets](https://github.com/Addono/gh-attach/issues/attach-assets) [#attach](https://github.com/Addono/gh-attach/issues/attach)

# [1.4.0](https://github.com/Addono/gh-attach/compare/v1.3.0...v1.4.0) (2026-03-02)


### Bug Fixes

* remove playwright auto-install to prevent CI timeout ([32fe560](https://github.com/Addono/gh-attach/commit/32fe5605afce65e12322a9b12984055ff0831d03))


### Features

* **config:** default to list when no action is given ([1b5d4da](https://github.com/Addono/gh-attach/commit/1b5d4da179f3a1476fa1221a4460d05d41da300e)), closes [#attach](https://github.com/Addono/gh-attach/issues/attach) [#attach](https://github.com/Addono/gh-attach/issues/attach)

# [1.3.0](https://github.com/Addono/gh-attach/compare/v1.2.0...v1.3.0) (2026-03-02)


### Bug Fixes

* build CJS bundle for pkg binary to fix gh extension ESM error ([e6362e9](https://github.com/Addono/gh-attach/commit/e6362e941e1869d3b65060189fac0c90e8b85ab2))
* increase login test timeout for Playwright auto-install in CI ([7763bf2](https://github.com/Addono/gh-attach/commit/7763bf2f989b5c24aad726ebe1cdad56e85a8ed5))


### Features

* auto-install Playwright browsers and improve strategy help text ([47a85dc](https://github.com/Addono/gh-attach/commit/47a85dc875b261fe61efdff4fefaaf63a1827497))

# [1.2.0](https://github.com/Addono/gh-attach/compare/v1.1.0...v1.2.0) (2026-03-02)


### Features

* include source maps and gh-extension manifest in releases ([4164a00](https://github.com/Addono/gh-attach/commit/4164a0047e7b7dfc630e284e2061c65fe4c85a85)), closes [#extension](https://github.com/Addono/gh-attach/issues/extension) [#extension](https://github.com/Addono/gh-attach/issues/extension) [#18](https://github.com/Addono/gh-attach/issues/18)

# [1.1.0](https://github.com/Addono/gh-attach/compare/v1.0.6...v1.1.0) (2026-03-02)


### Features

* configure npm publishing to GitHub Packages registry ([dd8e9b2](https://github.com/Addono/gh-attach/commit/dd8e9b2ffe5dde115caa58c92b5face18c71647a)), closes [addono/#attach](https://github.com/Addono/gh-attach/issues/attach) [#17](https://github.com/Addono/gh-attach/issues/17)

## [1.0.6](https://github.com/Addono/gh-attach/compare/v1.0.5...v1.0.6) (2026-03-02)


### Bug Fixes

* correct upload data encoding and 404 detection in strategies ([68247d7](https://github.com/Addono/gh-attach/commit/68247d7cc65d613ca3685cc7f136ff711ea9d180))

## [1.0.5](https://github.com/Addono/gh-attach/compare/v1.0.4...v1.0.5) (2026-03-02)


### Bug Fixes

* renames repo to gh-attach ([9d8dc1f](https://github.com/Addono/gh-attach/commit/9d8dc1fc02c47c1fda156153919e7b40d882cdda)), closes [#attach](https://github.com/Addono/gh-attach/issues/attach)

## [1.0.4](https://github.com/Addono/gh-attach/compare/v1.0.3...v1.0.4) (2026-02-28)


### Bug Fixes

* disable coverage thresholds for E2E test runs ([795e3c7](https://github.com/Addono/gh-attach/commit/795e3c70ac0fbb5660f76829eec768df221b2fe3))

## [1.0.3](https://github.com/Addono/gh-attach/compare/v1.0.2...v1.0.3) (2026-02-28)


### Bug Fixes

* skip E2E tests when GITHUB_TOKEN is not configured ([60763b6](https://github.com/Addono/gh-attach/commit/60763b60f428d348d638c416f23cb5c368f472e4))

## [1.0.2](https://github.com/Addono/gh-attach/compare/v1.0.1...v1.0.2) (2026-02-28)


### Bug Fixes

* format CHANGELOG.md and ignore it in prettier checks ([98fe411](https://github.com/Addono/gh-attach/commit/98fe411b56e664419750f9497b65af100a493340))

## [1.0.1](https://github.com/Addono/gh-attach/compare/v1.0.0...v1.0.1) (2026-02-28)


### Bug Fixes

* make gh-extension entrypoint test cross-platform ([50556ee](https://github.com/Addono/gh-attach/commit/50556eee8c86711bfe894dbce0ffbd29288a73d9)), closes [#extension](https://github.com/Addono/gh-attach/issues/extension)

# 1.0.0 (2026-02-28)

### Bug Fixes

- add gh extension entrypoint ([19a85c5](https://github.com/Addono/gh-attach/commit/19a85c5e5e892b44a3d01848838f7f526c35a1e9))
- align MCP upload format contract ([7d9b221](https://github.com/Addono/gh-attach/commit/7d9b2214cd62811d7fa8306a0015fcec990df933))
- align release binary names with gh extension convention ([7af4c94](https://github.com/Addono/gh-attach/commit/7af4c9460ec6d2cfea44c609efc99831e216e3ed)), closes [bin/#attach-linux](https://github.com/Addono/gh-attach/issues/attach-linux) [#attach-linux-x64](https://github.com/Addono/gh-attach/issues/attach-linux-x64) [#attach](https://github.com/Addono/gh-attach/issues/attach)
- clarify evaluation prompt scoring instructions ([b3047b6](https://github.com/Addono/gh-attach/commit/b3047b656799391953d1a1d91eebd66e6fc62b79))
- clarify evaluation prompt structure ([3fd5871](https://github.com/Addono/gh-attach/commit/3fd5871d38160faefdb20adf7095f46782a77404))
- correct CopilotClient session API usage ([5fe7bd3](https://github.com/Addono/gh-attach/commit/5fe7bd37f1dc6bdfbd1339804f3cc04f856da2b2)), closes [#1](https://github.com/Addono/gh-attach/issues/1)
- correct MCP streamable HTTP sessions ([faee118](https://github.com/Addono/gh-attach/commit/faee118ddfc3945cc63d9e8d706c0a3df4025412))
- fix CI test failure on macOS and release pipeline ([98ba834](https://github.com/Addono/gh-attach/commit/98ba834a5c3bb5735dae0fbc65541473b8f2f6ae))
- honor login state path and reuse saved session ([c2f000a](https://github.com/Addono/gh-attach/commit/c2f000a74d17c87b10f7249297f48f08a12ebe71))
- improve fallback fitness scoring and evaluation evidence ([cb22834](https://github.com/Addono/gh-attach/commit/cb22834a3295f7c8844846825ad60bde2aa32c75))
- **logging:** reapply verbose per-tool logging (was overwritten by loop) ([22508f4](https://github.com/Addono/gh-attach/commit/22508f42ea4de39daf7287b9bb1bb03dbc534673))
- **logging:** restore logging spec content ([ef69956](https://github.com/Addono/gh-attach/commit/ef69956fee4e1a94a93282faf18a1218f87efc8c))
- **logging:** verbose per-tool logging with smart argument extraction ([c792ae1](https://github.com/Addono/gh-attach/commit/c792ae1256e1f770dfa89b0edc0b858fa35b672c))
- make auth error assertions resilient to strategy-order config ([aa2b535](https://github.com/Addono/gh-attach/commit/aa2b535539c3dcb8d19c20e9d286cd5f2c7103b9))
- preserve typed errors in CLI for correct exit codes, fix test failures ([792e9a6](https://github.com/Addono/gh-attach/commit/792e9a69fdbd52b53a183391cdf4046e489be72d))
- remove model "claude-opus-4.6-fast" from premiumModels ([72a87fa](https://github.com/Addono/gh-attach/commit/72a87fa11059f3a2f36ffa846714f4019764bf74))
- resolve all 41 lint warnings in test files ([ee4e240](https://github.com/Addono/gh-attach/commit/ee4e240a82260885842ff050403c1aef2acecfa0))
- resolve formatting failures and improve test coverage to 95% ([1c42711](https://github.com/Addono/gh-attach/commit/1c42711fa33b44d47de596aa87eaa079fb654ddd))
- ship gh-extension entrypoint ([dc6fa77](https://github.com/Addono/gh-attach/commit/dc6fa7740c94f39a2a14b0185c9bceeca51dbb45)), closes [#extension](https://github.com/Addono/gh-attach/issues/extension) [#extension](https://github.com/Addono/gh-attach/issues/extension) [#attach](https://github.com/Addono/gh-attach/issues/attach) [#extension](https://github.com/Addono/gh-attach/issues/extension) [#extension](https://github.com/Addono/gh-attach/issues/extension) [#attach](https://github.com/Addono/gh-attach/issues/attach)
- support stdin-only upload invocation ([f48ea79](https://github.com/Addono/gh-attach/commit/f48ea79c602d2734c789694b97ced901324f9393))
- update snapshot tests and resolve lint warnings ([ae1c549](https://github.com/Addono/gh-attach/commit/ae1c549a8c9ab175c3c24c8d84b80cc4e2b5f2c5))

### Features

- add .releaserc.json, changelog/git plugins, and E2E skip message ([edc3d92](https://github.com/Addono/gh-attach/commit/edc3d92de39b8908f53078db30b96a0db3beb9c4))
- add commitlint and comprehensive JSDoc documentation ([d5b5cc3](https://github.com/Addono/gh-attach/commit/d5b5cc3f6b8e8aea44ad4a0dc0de0752075f7ef5))
- add evaluation evidence for config command, loop log, and PROMPT files ([e4a22eb](https://github.com/Addono/gh-attach/commit/e4a22eba91482d2a6c07e4fabf8886ea839b5c2d))
- add missing source evidence slices for low-scoring spec items ([d0ee7e5](https://github.com/Addono/gh-attach/commit/d0ee7e59bf8b9ab82bc8aee62202c671390a6bb2))
- **cli:** enhance config and upload commands with improved error handling and strategy resolution ([187dea1](https://github.com/Addono/gh-attach/commit/187dea1fdfdd460d677ebbf62d7ead2b2fed260f))
- **cli:** implement interactive browser login with Playwright ([369c583](https://github.com/Addono/gh-attach/commit/369c583a34f62eb98a5440a0e25dd817d116ac54))
- **cli:** implement structured exit codes per spec ([9ae6448](https://github.com/Addono/gh-attach/commit/9ae6448b5d45a2d24313148d7b9b9bd1441cbaa4))
- complete global CLI options support ([ab92101](https://github.com/Addono/gh-attach/commit/ab921016445ec6c27c0e07ba82efbc1bfe762037))
- complete library public API exports and migrate vitest config ([1b133eb](https://github.com/Addono/gh-attach/commit/1b133eb4906aac15517fb76e174e0102df81ff2a))
- extract graceful shutdown handler into testable module ([465168b](https://github.com/Addono/gh-attach/commit/465168be8da03aa2b42d7cd456e510695ac267ee))
- extract runFitnessEvaluation to testable module and fix comment spec compliance ([2a477a1](https://github.com/Addono/gh-attach/commit/2a477a1e01f21754b288bbeee0a5a89e75b60577))
- extract tool logging module and add login elicitation flow ([b18250a](https://github.com/Addono/gh-attach/commit/b18250aa3f585a80050e0c2e335d46b83ccd0176))
- implement all upload strategies (browser-session, cookie-extraction, repo-branch) ([7c2dd54](https://github.com/Addono/gh-attach/commit/7c2dd541cf52d44544421d21f5bc4d33d1e50443))
- implement CLI upload command with multi-strategy support ([bcb70f0](https://github.com/Addono/gh-attach/commit/bcb70f09fa7e656e96535d9d399ea02525b573e6)), closes [#attach](https://github.com/Addono/gh-attach/issues/attach) [owner/repo#42](https://github.com/owner/repo/issues/42) [#attach](https://github.com/Addono/gh-attach/issues/attach) [#42](https://github.com/Addono/gh-attach/issues/42) [#attach](https://github.com/Addono/gh-attach/issues/attach) [#42](https://github.com/Addono/gh-attach/issues/42)
- implement file validation and target parsing utilities ([d8777d3](https://github.com/Addono/gh-attach/commit/d8777d358a00919017cbfcc84a6fe35f2c5c9c7e)), closes [owner/repo#42](https://github.com/owner/repo/issues/42) [#42](https://github.com/Addono/gh-attach/issues/42)
- implement MCP server with stdio and HTTP transports ([51a1b4d](https://github.com/Addono/gh-attach/commit/51a1b4d1c993fd925f5473bd8e8980da125f9cdb))
- implement release asset generation with pkg ([944263a](https://github.com/Addono/gh-attach/commit/944263a75291fc3f141a5ce9e4ec54b5f26cac32)), closes [#extension](https://github.com/Addono/gh-attach/issues/extension)
- improve evaluation evidence and branch protection docs ([507e2b1](https://github.com/Addono/gh-attach/commit/507e2b1eef5b5d1ffd656cfd3204f2dfad74deef))
- improve evaluation evidence quality and logging spec compliance ([70fcee9](https://github.com/Addono/gh-attach/commit/70fcee9ba9b04e53d91f2be4fb36aeb8332bfc50))
- improve evaluation evidence quality with spec-named test index and larger output capture ([69ae71f](https://github.com/Addono/gh-attach/commit/69ae71fb4dcdbf39e2b2b05ea126047f95f8036c))
- improve fitness scores with testability, coverage, and quality ([96e3b0d](https://github.com/Addono/gh-attach/commit/96e3b0d9248458c833799045e2129f6fe06a48d8))
- refactor loop core + model tracking + PROMPT file tests + shutdown labels ([b40e026](https://github.com/Addono/gh-attach/commit/b40e0260c621073b6aba9dccce434495d36591f7))
