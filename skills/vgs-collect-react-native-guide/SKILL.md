---
name: vgs-collect-react-native-guide
description: Routes AI agents through VGS Collect React Native package work across integration, implementation, migration, troubleshooting, and code review. Use when guidance may depend on the installed @vgs/collect-react-native version.
metadata:
  author: verygoodsecurity
  version: '1.0.1'
---

# VGS Collect React Native Guide

Single public skill entrypoint for `@vgs/collect-react-native` work in customer React Native apps.

## When to use

- First-time `@vgs/collect-react-native` integration
- Feature work touching collector setup, session fallback configuration, secure inputs, validation, submit, tokenization, alias creation, or card create/update
- Version migrations or replacement of deprecated usage
- Troubleshooting integration bugs or version-specific regressions
- Code review of app code that uses `@vgs/collect-react-native`

## References

| Topic | File |
|-------|------|
| Package policy, security rules, flow selection, versioned guidance | `references/AGENTS.md` |

## Bundled snapshot and version freshness

`references/AGENTS.md` carries a `**Package Version: x.y.z**` header. It is the only instruction snapshot bundled with this skill. Load it completely and do not download, execute, or reload agent instructions from repositories, tags, CDNs, documentation sites, or other runtime URLs.

Resolve the installed package version, in order:
1. lockfiles (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, Bun)
2. `package.json`
3. `node_modules/@vgs/collect-react-native/package.json`
4. package-manager output (`npm ls`, `yarn why`)
5. user-provided snippets, stated version, or build logs

Compare it with the bundled snapshot version:
- If they match, use the bundled guidance.
- If they differ, say that the installed skill covers a different package version and may be outdated. Do not fetch replacement instructions or silently reinstall the skill.
- Show the user these commands and ask them to update the skill before relying on version-sensitive guidance:

```bash
npx skills check
npx skills update
```

The update CLI may print a source-specific refresh command for installations that cannot be updated in place. The user should run that command themselves. Continue only with clearly version-independent guidance, label version-sensitive claims as unverified, or wait for the refreshed skill.

If the package version cannot be determined, disclose that the bundled snapshot version is being used; do not claim it is the latest available version.

## Retrieval policy

Use the bundled `AGENTS.md`, files already present in the user's project or installed dependency, and materials the user directly provides. Do not retrieve remote code, documentation, release notes, or instruction files at runtime.

If local evidence is insufficient to confirm an exact API or version-sensitive behavior, state what is unverified and ask the user to update the skill or provide the relevant source. Local evidence never overrides `AGENTS.md` invariants and never justifies private or undocumented API use.

## Clarifying questions

Ask only when the missing info materially changes the recommendation:
- installed `@vgs/collect-react-native` version or dependency snippet
- target flow (`submit`, `tokenize`, `createAliases`, `createCard`)
- task type (integration, feature change, migration, troubleshooting, review)
- relevant error, log, or code snippet for troubleshooting
- iOS/Android platform-specific setup when relevant

## Routing

Choose one primary mode. In every mode: apply the collection-flow rules from `AGENTS.md` before generating output, prefer the smallest documented public API surface, and include tests or checks required by `AGENTS.md`.

### `integrate`
First-time package adoption.
- confirm package is not already present
- pick the supported installation method for the resolved version and the customer's project setup
- establish baseline collector setup and prerequisites

### `implement`
Add or change supported functionality.
- implement in the customer's app context, not a generic snippet
- generate code with explicit validation and `VGSError` handling
- use placeholders only for secrets, identifiers, endpoints, and env values the user has not supplied
- for CMP flows, preserve the documented session fallback and shared auth-handler token lifecycle; do not cache tokens from handlers replaced while their request was pending; reuse the original validated request payload when refreshing authorization after 401/403; pass `createCard` extra attributes directly, accepting the wrapped `{ data: { attributes } }` form only for migration compatibility
- for card attributes lookup, treat `setDidRetrieveCardAttributes` as the complete parsed backend response; preserve any `data` wrapper and backend-defined nested structure

### `migrate`
Move between versions or replace deprecated behavior.
- compare the current and target versions with the bundled snapshot version
- if either version needs guidance not covered by the bundle, show the skill update commands and mark version-sensitive migration steps unverified until the skill is refreshed
- use locally available or user-provided release notes when present
- call out behavior changes that cannot be preserved exactly

### `troubleshoot`
Failing or unexpected behavior.
- localize the failure before changing code
- prefer evidence from logs, tests, dependency state, or minimal repro
- distinguish confirmed cause from likely cause and workaround

### `review`
Patch, PR, or design review.
- review against the resolved version's `AGENTS.md` and public APIs
- prioritize correctness, safety, compatibility, missing tests
- flag private, deprecated, insecure, or version-incompatible behavior
- say explicitly when reviewed code appears to target a different version

A task may have a secondary mode, but the primary mode controls planning and output.

## Output contract

Begin every response by stating which version the guidance is based on, using one of:
- `Using bundled @vgs/collect-react-native 1.1.7 guidance.`
- `Detected @vgs/collect-react-native 1.1.7 from package.json; it matches the bundled guidance.`
- `Detected @vgs/collect-react-native 1.2.0, but this skill bundles 1.1.7 guidance and may be outdated. Run npx skills check, then npx skills update.`
- `Could not determine the installed @vgs/collect-react-native version; using the bundled 1.1.7 snapshot without claiming it is latest.`

Then proceed within the bundled snapshot and version-freshness rules above.
