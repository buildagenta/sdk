# Agenta SDKs

JavaScript and TypeScript SDKs for [Agenta](https://buildagenta.com), which hosts agents your
product can put in front of its own customers.

This repository is a [Bun](https://bun.sh/) workspace. It is set up to publish the React
SDK, while leaving room for other JavaScript framework packages.

## Packages

| Package                             | Description           |
| ----------------------------------- | --------------------- |
| [`@buildagenta/react`](./packages/react) | React SDK for Agenta |

An example app that uses the React SDK end to end is in
[`examples/website-app`](./examples/website-app).

Framework-neutral code should remain in the package that needs it until another package has
a concrete reason to share it. At that point, it can be extracted into `packages/core`.

SDKs for other languages should live in their own repositories so they can follow their
ecosystems' packaging and release conventions independently.

## Development

Install [Bun](https://bun.sh/) and then run:

```bash
make install
make install-hooks
make ci
```

Run `make fix` to apply safe formatting and lint fixes.

## Releases

This repository uses [Release Please](https://github.com/googleapis/release-please) and
[Conventional Commits](https://www.conventionalcommits.org/) to version each package
independently. Below 1.0 a breaking change bumps the minor version rather than the major,
so an early package does not spend its 1.0 on one.

Merging a package's Release Please pull request tags the release and publishes it to npm
from the `npm` GitHub environment, using Trusted Publishing rather than a stored token.
