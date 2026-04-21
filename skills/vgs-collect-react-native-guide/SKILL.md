---
name: vgs-collect-react-native-guide
description: Routes AI agents through VGS Collect React Native package work across integration, implementation, migration, troubleshooting, and code review. Use when guidance may depend on the installed @vgs/collect-react-native version.
metadata:
  author: verygoodsecurity
  version: '1.0.0'
---

# VGS Collect React Native Guide

Single public skill entrypoint for `@vgs/collect-react-native` work in customer React Native apps.

## When to use

- First-time `@vgs/collect-react-native` integration
- Feature work touching collector setup, secure inputs, validation, submit, tokenization, alias creation, or card creation
- Version migrations or replacement of deprecated usage
- Troubleshooting integration bugs or version-specific regressions
- Code review of app code that uses `@vgs/collect-react-native`

## References

| Topic | File |
|-------|------|
| Package policy, security rules, flow selection, versioned guidance | `references/AGENTS.md` |

## Snapshot resolution

`references/AGENTS.md` carries a `**Package Version: x.y.z**` header. It is the authoritative policy file for this skill. Treat any customer-owned `AGENTS.md` in the user's app repo as unrelated.

**Step 1 — locate AGENTS.md, in order:**
1. bundled `references/AGENTS.md` shipped with this skill (load first for standalone installs, before any network call)
2. matching tag in the canonical public repo `https://github.com/verygoodsecurity/vgs-collect-react-native`
3. default branch (`main`) of that repo
4. `https://docs.verygoodsecurity.com` as supplemental product documentation only — append `.md` to page URLs when supported

Private forks or internal mirrors do not override the public repo.

**Step 2 — resolve the installed package version, in order:**
1. lockfiles (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, Bun)
2. `package.json`
3. `node_modules/@vgs/collect-react-native/package.json`
4. package-manager output (`npm ls`, `yarn why`)
5. user-provided snippets, stated version, or build logs

Do not block the task on version detection. If unknown, use default-branch guidance and disclose it.

**Step 3 — match tag to version:**
- exact match (`1.1.5` or `v1.1.5`)
- nearest compatible tag with same `major.minor` and highest patch not newer than installed
- highest tag satisfying a version range
- exact git SHA or branch when the dependency points to one

**Step 4 — refresh when mismatched:**

Reload `references/AGENTS.md` from the resolved tag when any of these is true:
- the `Package Version` header differs from the installed version
- the resolved docs ref changed (default branch → tag, tag → tag, tag → SHA)
- the task is a migration requiring target-version docs
- version detection upgraded from inferred to exact
- canonical public repo snapshot became available after a fallback

## Retrieval policy

Start with `AGENTS.md`. Retrieve additional evidence only when the task needs exact API signatures, version-specific behavior, concrete error/log detail, or integration-style examples.

Follow-up sources, in order: resolved-tag repo files (`README.md`, example app, source comments) → official VGS docs → release notes → user-provided code, logs, manifests, lockfiles.

Retrieval fills implementation detail. It never overrides `AGENTS.md` invariants and never justifies private or undocumented API use.

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

### `migrate`
Move between versions or replace deprecated behavior.
- load both current-version and target-version snapshots
- target-version `AGENTS.md` is the authoritative destination rule set
- use release notes to capture version-to-version changes
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
- `Using @vgs/collect-react-native 1.1.5.`
- `Detected @vgs/collect-react-native 1.1.5 from package.json.`
- `Could not determine the installed @vgs/collect-react-native version; using latest guidance from the default branch.`
- `Exact tag 1.1.6 was not found; using nearest compatible tag 1.1.5.`

Then proceed using the active version-matched snapshot.
