# Changelog

## [0.4.0](https://github.com/buildagenta/sdk/compare/react-v0.3.0...react-v0.4.0) (2026-10-15)


### Features

* **react:** add feedback and scheduled chat hooks ([#5](https://github.com/buildagenta/sdk/issues/5)) ([1f2a314](https://github.com/buildagenta/sdk/commit/1f2a31498f31d578ef3bce88b3c5e390cb9383a2))

## [0.3.0](https://github.com/buildagenta/sdk/compare/react-v0.2.0...react-v0.3.0) (2026-09-23)


### Features

* **react:** preserve A2A thread types ([a17dfe1](https://github.com/buildagenta/sdk/commit/a17dfe183456945a716a39f93211edeeec5d40d0))

## [0.2.0](https://github.com/buildagenta/sdk/compare/react-v0.1.0...react-v0.2.0) (2026-08-20)


### ⚠ BREAKING CHANGES

* rename ensureCredentials and drop the refresh timer
* `AgentaCredentials` no longer carries `runtimeUrl`. Return `{ token, expiresAt, agentId }` from your token endpoint; pass `runtimeUrl` to `AgentaProvider` if you need to point at a runtime of your own.

### Features

* add a website/app example for @buildagenta/react ([cb30d4a](https://github.com/buildagenta/sdk/commit/cb30d4accc9a6e63a7e8a16593556477cbb584f2))
* drop runtimeUrl from the credential the browser is handed ([a9888b6](https://github.com/buildagenta/sdk/commit/a9888b6c49e425e328b6dbd7f4c400211f69db84))
* mount the website/app token endpoint at /api/token ([0fa38ff](https://github.com/buildagenta/sdk/commit/0fa38fff26a11c839544c045a4135f9dba61288b))
* rename ensureCredentials and drop the refresh timer ([ed65230](https://github.com/buildagenta/sdk/commit/ed65230c0df9095d83957a9033e33a1cee650600))


### Bug Fixes

* keep the ensureCredentials identity stable ([c7358c3](https://github.com/buildagenta/sdk/commit/c7358c3e931792d06e18fe44937d72e6ed6daa24))
* mint credentials on demand instead of on a timer alone ([2b61b4a](https://github.com/buildagenta/sdk/commit/2b61b4a112ff343e978043cea8d347db91e9d101))

## 0.1.0 (2026-08-11)


### Features

* **react:** add Agenta integration SDK ([#2](https://github.com/buildagenta/sdk/issues/2)) ([f778cf3](https://github.com/buildagenta/sdk/commit/f778cf3059f12228d7d485f39efd85de48584173))
* set up React SDK workspace ([f5039ff](https://github.com/buildagenta/sdk/commit/f5039ff86629696d1cae19b0e1d923dc48af9aa4))


### Bug Fixes

* configure initial React release ([85398fc](https://github.com/buildagenta/sdk/commit/85398fcd5c011623e7b4c71281fe99a27f2ea663))
