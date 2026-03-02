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
- correct ralph loop iteration bounds ([ab899ac](https://github.com/Addono/gh-attach/commit/ab899ac8ad7b884999127108ee8785fe85f703c9))
- enforce ralph quiet-mode debug filtering ([f8997ba](https://github.com/Addono/gh-attach/commit/f8997bab37cdaa5b298051c9fcf89fb05663eec9))
- fix CI test failure on macOS and release pipeline ([98ba834](https://github.com/Addono/gh-attach/commit/98ba834a5c3bb5735dae0fbc65541473b8f2f6ae))
- harden ralph evaluation json parsing ([3d8574e](https://github.com/Addono/gh-attach/commit/3d8574efd3401e1e8687ae1ba87c61ffcf26b679))
- harden ralph evaluation timeout detection ([6e004e0](https://github.com/Addono/gh-attach/commit/6e004e04649258302f04699fd48e14a48c6f5ccb))
- harden ralph fitness evaluation timeouts ([002e4f6](https://github.com/Addono/gh-attach/commit/002e4f61cc19cad94a4b9fae17c8ab071c7ba0e1))
- honor login state path and reuse saved session ([c2f000a](https://github.com/Addono/gh-attach/commit/c2f000a74d17c87b10f7249297f48f08a12ebe71))
- improve fallback fitness scoring and evaluation evidence ([cb22834](https://github.com/Addono/gh-attach/commit/cb22834a3295f7c8844846825ad60bde2aa32c75))
- **logging:** reapply verbose per-tool logging (was overwritten by loop) ([22508f4](https://github.com/Addono/gh-attach/commit/22508f42ea4de39daf7287b9bb1bb03dbc534673))
- **logging:** restore logging spec content ([ef69956](https://github.com/Addono/gh-attach/commit/ef69956fee4e1a94a93282faf18a1218f87efc8c))
- **logging:** verbose per-tool logging with smart argument extraction ([c792ae1](https://github.com/Addono/gh-attach/commit/c792ae1256e1f770dfa89b0edc0b858fa35b672c))
- make auth error assertions resilient to strategy-order config ([aa2b535](https://github.com/Addono/gh-attach/commit/aa2b535539c3dcb8d19c20e9d286cd5f2c7103b9))
- preserve typed errors in CLI for correct exit codes, fix test failures ([792e9a6](https://github.com/Addono/gh-attach/commit/792e9a69fdbd52b53a183391cdf4046e489be72d))
- **ralph-loop:** correct log file line break escaping ([827a27c](https://github.com/Addono/gh-attach/commit/827a27c869f415496f6846d2a466f574821488dc))
- **ralph-loop:** fix GitHub issue body newlines, add premium models, git push ([e7bec4e](https://github.com/Addono/gh-attach/commit/e7bec4e829f62c7a19a16ccb9cfaa22c38917d06))
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
- add ralph loop core tests and expand CI gating coverage ([937c1d2](https://github.com/Addono/gh-attach/commit/937c1d2685edd7db2ce8a8c775485d6d633409fb))
- add spec compliance tests and ralph loop evidence for score improvement ([97a838f](https://github.com/Addono/gh-attach/commit/97a838faec84ccce705a8d166b05370b5d927f73))
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
- implement ralph loop CI gating ([021f58a](https://github.com/Addono/gh-attach/commit/021f58af9d6a5a81ced46d21fb9dffe89e1fd504))
- implement release asset generation with pkg ([944263a](https://github.com/Addono/gh-attach/commit/944263a75291fc3f141a5ce9e4ec54b5f26cac32)), closes [#extension](https://github.com/Addono/gh-attach/issues/extension)
- improve evaluation evidence and branch protection docs ([507e2b1](https://github.com/Addono/gh-attach/commit/507e2b1eef5b5d1ffd656cfd3204f2dfad74deef))
- improve evaluation evidence quality and logging spec compliance ([70fcee9](https://github.com/Addono/gh-attach/commit/70fcee9ba9b04e53d91f2be4fb36aeb8332bfc50))
- improve evaluation evidence quality with spec-named test index and larger output capture ([69ae71f](https://github.com/Addono/gh-attach/commit/69ae71fb4dcdbf39e2b2b05ea126047f95f8036c))
- improve fitness scores with testability, coverage, and quality ([96e3b0d](https://github.com/Addono/gh-attach/commit/96e3b0d9248458c833799045e2129f6fe06a48d8))
- initialize project with OpenSpec specs and Ralph Loop ([9ecdedc](https://github.com/Addono/gh-attach/commit/9ecdedc127cc34366f02547d4af6bf621e0accf8))
- **ralph-loop:** add dependency health scoring and rewards ([a909722](https://github.com/Addono/gh-attach/commit/a9097220146ef9a9055e3b81e9029cf0d10c80f0))
- **ralph-loop:** add evaluation scoring card + harden loop ([1cc2ba9](https://github.com/Addono/gh-attach/commit/1cc2ba911157972f39491f69560f002dcc93c5df))
- **ralph-loop:** harden loop with score-maximising guidance + richer logging ([66067c3](https://github.com/Addono/gh-attach/commit/66067c32e400e7528cad2def2af3feed54a63b8c))
- refactor loop core + model tracking + PROMPT file tests + shutdown labels ([b40e026](https://github.com/Addono/gh-attach/commit/b40e0260c621073b6aba9dccce434495d36591f7))
