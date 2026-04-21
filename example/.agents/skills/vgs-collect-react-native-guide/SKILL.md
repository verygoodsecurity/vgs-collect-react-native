---
name: vgs-collect-react-native-guide
description: Routes AI agents through VGS Collect React Native package work across integration, implementation, migration, troubleshooting, and code review. Use when guidance may depend on the installed @vgs/collect-react-native version.
metadata:
  internal: true
  author: verygoodsecurity
  version: '1.0.0'
---

# VGS Collect React Native Guide

This is the single public skill entrypoint for the VGS Collect React Native package repository.

Use this skill when the task involves integrating, implementing, migrating, troubleshooting, or reviewing `@vgs/collect-react-native` usage in a customer React Native application.

## When to Use

- First-time `@vgs/collect-react-native` integration in a React Native app
- Feature implementation or refactor that touches collector setup, secure inputs, validation, submit flows, tokenization, alias creation, or card creation
- Migration between package versions or replacement of deprecated usage
- Troubleshooting package behavior, integration bugs, or version-specific regressions
- Code review of app code that uses `@vgs/collect-react-native`
- Generating starter templates or guidance that depends on the installed package version

## Bundled policy reference

This skill bundle must ship `references/AGENTS.md`.

When the skill is installed with `npx skills add ...`, load `references/AGENTS.md` first so the durable repository policy arrives with the skill itself.

## References

| Topic | File |
|-------|------|
| VGS Collect React Native package policy, security rules, flow selection, and versioned guidance | `references/AGENTS.md` |

## AGENTS.md refresh logic

Treat `references/AGENTS.md` from this skill or the resolved VGS Collect React Native repository snapshot as the VGS Collect React Native policy file for this skill.

Do not confuse that VGS Collect React Native policy file with any customer-owned `AGENTS.md` that may exist in the user's app repository for unrelated project rules.

Before giving version-sensitive guidance:
- check whether the VGS Collect React Native `AGENTS.md` policy file is present in the current skill or resolved repo context
- read the `**Package Version: x.y.z**` header from that VGS Collect React Native `AGENTS.md`
- resolve the app's installed `@vgs/collect-react-native` version
- confirm the VGS Collect React Native `AGENTS.md` header version matches the app version, or matches the fallback docs snapshot being used

If the VGS Collect React Native `AGENTS.md` policy file is missing, download the correct `references/AGENTS.md` content from the canonical repository snapshot and use that updated file as the active rule set.

If the VGS Collect React Native `AGENTS.md` policy file exists but its `Package Version` header does not match the app version or resolved fallback snapshot, download and replace it with the correct `references/AGENTS.md` content from the canonical repository snapshot before continuing with version-sensitive guidance.

## Core operating model

Use the active `AGENTS.md` snapshot as the base policy and decision framework.

Start with bundled `references/AGENTS.md` when the skill is being used standalone outside this repository.

Then decide whether that guidance is sufficient for the task.

If implementation details, version-specific API facts, migration steps, examples, or troubleshooting evidence are still needed, use the agent's normal retrieval tools to inspect the resolved repository snapshot, official docs, example app, source comments, release notes, and user-provided artifacts.

Search and retrieval may fill gaps, but they must not override `AGENTS.md` on:
- public-versus-private API boundaries
- root-package import requirements
- sensitive-data handling
- validation-before-submission requirements
- error-handling expectations
- task routing and flow-selection rules

## Required workflow

1. Load bundled `references/AGENTS.md` immediately when the skill is being used standalone so the durable policy is available before any network or repo lookup.
2. Resolve the installed `@vgs/collect-react-native` package version before giving version-sensitive guidance.
3. Read the `Package Version` header from the currently available `AGENTS.md`, if one exists.
4. Resolve the documentation snapshot for the app version.
5. Reuse a previously loaded `AGENTS.md` only when its `Package Version` header and docs source both match the resolved package version snapshot.
6. If `AGENTS.md` is missing or version-mismatched, download `references/AGENTS.md` from the resolved documentation source and update the active snapshot before continuing.
7. Decide whether `AGENTS.md` alone is sufficient for the task.
8. If not, retrieve additional evidence from the resolved repository snapshot, official docs, example app, source comments, release notes, and user-provided artifacts.
9. Apply the collection-flow rules from `AGENTS.md` before generating guidance.
10. Route the task into one primary mode: `integrate`, `implement`, `migrate`, `troubleshoot`, or `review`.
11. State which package version the guidance is based on.

## Retrieval policy

Read the active `AGENTS.md` first for policy, constraints, invariants, allowed public APIs, and decision order.

For standalone skill installs, that means `references/AGENTS.md` first, then the resolved `references/AGENTS.md` snapshot once it has been matched to a versioned docs source.

Do not trust a bundled or cached `AGENTS.md` header blindly; compare its `Package Version` value against the resolved app version first, and refresh it from the repo when they differ.

Then classify whether more evidence is needed.

`AGENTS.md` alone is usually sufficient for:
- high-level architecture guidance
- security and compliance guardrails
- choosing between `submit`, `tokenize`, `createAliases`, and `createCard`
- code review against known invariants
- generic starter templates that use documented public APIs
- deciding whether a requested approach conflicts with supported public behavior

Additional retrieval is required when the task depends on:
- exact API signatures or prop names
- version-specific behavior
- migration steps between versions
- examples for a specific React Native integration style
- troubleshooting tied to concrete errors, logs, or existing code
- release-specific caveats
- implementation hints available in repo docs, example code, or source comments

Preferred follow-up sources, in order:
1. resolved-tag repository files such as `README.md`, example app sources, and source comments
2. official VGS docs for the React Native package
3. release notes and tags
4. user-provided code, logs, dependency manifests, lockfiles, and snippets

Source inspection may be used to confirm behavior, but must not justify use of private or undocumented APIs.

## Snapshot reuse and invalidation

Agents should treat loaded repository guidance as a versioned docs snapshot.

A snapshot includes:
- repository identity
- git ref, tag, SHA, or default branch
- resolved package version status
- loaded `AGENTS.md`
- optional release-note context

Reuse rule:
- Reuse a previously loaded `AGENTS.md` only when the resolved package version, the `Package Version` header, and the docs source still match the active snapshot.

A stored snapshot may be reused for efficiency, but it is authoritative only when it matches the currently resolved package version and docs ref.

Invalidate and reload when:
- the resolved package version changes
- the docs ref changes from default branch to a tag, from one tag to another, or to a specific SHA
- the task is a migration and target-version docs are required
- previous version detection was inferred or unknown, and stronger evidence becomes available
- the active snapshot came from a fallback source and the canonical public repo snapshot later becomes available

Do not reuse an `AGENTS.md` snapshot across different package versions.

Do not continue using a default-branch `AGENTS.md` snapshot after an exact version tag has been resolved.

Do not continue using an `AGENTS.md` snapshot whose `Package Version` header differs from the resolved app version unless you have explicitly disclosed a nearest-compatible fallback.

## Resolve version first

Determine whether `@vgs/collect-react-native` is already installed in the user's project.

Inspect evidence in this order when the runtime allows it:
- resolved dependency metadata such as `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, Bun lockfiles, or workspace lockfiles
- app dependency manifests such as `package.json`
- installed package metadata such as `node_modules/@vgs/collect-react-native/package.json`
- package-manager output such as `npm ls @vgs/collect-react-native`, `yarn why`, or equivalent
- source imports or configuration references only when stronger evidence is unavailable

If the runtime does not allow project inspection, fall back in this order:
- user-provided dependency snippets
- user-stated package version
- user-provided build logs or package-manager output
- default-branch docs when version remains unknown

For each candidate, record:
- package name
- discovered version or version range
- evidence source file, snippet, or command
- confidence: `exact`, `constrained`, `inferred`, or `unknown`

Treat the package as not installed only when no reliable evidence is found.

Do not block the task on version detection. If the version cannot be determined, continue using default-branch guidance and clearly label it as version-unverified.

## Resolve the authoritative docs source

Canonical public docs source:
- Use `https://github.com/verygoodsecurity/vgs-collect-react-native` as the canonical public repository for tags, release notes, and versioned copies of `AGENTS.md` and this skill.
- Do not treat private forks, private mirrors, or unrelated remotes as the public docs source of truth when they differ from the public repository.
- A local checkout may be used as the docs source only when it is the same repository content as the public `verygoodsecurity/vgs-collect-react-native` snapshot needed for the task.

If an exact installed version is known:
- prefer the canonical public repository snapshot at the matching Git tag
- read `skills/vgs-collect-react-native-guide/references/AGENTS.md` from that tag first
- read `skills/vgs-collect-react-native-guide/SKILL.md` from that same tag when routing or wording consistency matters
- replace any missing or stale local `AGENTS.md` with that tag-matched `references/AGENTS.md` copy before giving version-sensitive guidance

Map versions to tags like this:
- first try exact normalized matches such as `1.1.5` and `v1.1.5`
- if no exact tag exists and the version is semver-like, choose the nearest compatible tag with the same `major.minor` and the highest patch that is not newer than the installed version
- if only a version range is known, choose the highest tag that satisfies the range
- if the dependency points to a git SHA or branch, prefer that exact repository revision when available
- if a local checkout remote disagrees with the public repository, the public repository wins for public skill guidance
- if the canonical public repo snapshot is not available locally, inspect the public remote tag snapshot before falling back

If the package is not installed:
- use the default-branch copies of `references/AGENTS.md` and this skill
- in the public repository, the current default branch is `main`
- if the local `AGENTS.md` is missing or not already from the default-branch snapshot, refresh it from `main`

If version detection fails:
- use default-branch docs
- say explicitly that the installed version could not be determined
- refresh `AGENTS.md` from the default branch if no local file exists or if the current header does not match the fallback snapshot you are using

If the public repository cannot be reached:
- use bundled `references/AGENTS.md` and bundled `SKILL.md` as the authoritative fallback snapshot
- disclose that remote tag verification was not possible

If `AGENTS.md`, release notes, and resolved repository sources still do not provide enough detail for the task:
- consult `https://docs.verygoodsecurity.com` for official product documentation
- prefer direct documentation pages that match the requested package feature or API behavior
- when you need documentation in markdown-friendly form, append `.md` to the documentation page URL when supported
- treat `docs.verygoodsecurity.com` as supplemental product documentation, not as a replacement for the versioned repository guidance above

## React Native integration invariants

Treat the active `AGENTS.md` snapshot as the sole source of truth for integration invariants.

That includes:
- allowed public API surface and root-package import requirements
- private and undocumented API prohibitions
- sensitive-data handling and no-raw-value logging or persistence rules
- collector lifecycle, field registration, and component-driven integration expectations
- validation-before-`submit`/`tokenize`/`createAliases`/`createCard` requirements
- `VGSError` handling expectations

Do not restate, relax, or override those rules from examples, source inspection, release notes, or product docs. If another source appears to conflict, follow `AGENTS.md` and use additional retrieval only to fill in implementation detail.

## Resolve collection flow before generating output

Apply the collection-flow rules from the active `AGENTS.md` snapshot before producing implementation, migration, troubleshooting, or review guidance.

Default to the smallest documented public API surface that satisfies the task.

Prefer component-driven integration in the customer's React Native app, not package-internal modifications.

## Minimum missing-context questions

Ask a clarifying question only when the missing information materially changes the recommended API, migration path, or fix.

Useful missing-context questions include:
- installed `@vgs/collect-react-native` version or dependency snippet
- whether the target flow is `submit`, `tokenize`, `createAliases`, or `createCard`
- whether the task is first-time integration, an existing feature change, migration, troubleshooting, or review
- the relevant error message, log output, or code snippet for troubleshooting
- whether the user needs platform-specific React Native setup details for iOS, Android, or both

Do not ask for context that is not necessary for the current task.

## Routing

Choose one primary mode.

### `integrate`

Use when `@vgs/collect-react-native` is not yet installed in the downstream app, or when the task is specifically about first-time package adoption.

- confirm whether the package is already present
- determine the preferred supported installation method for the resolved package version based on the customer's project setup
- establish baseline collector setup and required prerequisites
- apply the collection-flow rules from `AGENTS.md` before generating any submit or tokenization logic
- prefer the smallest documented public API surface
- include the tests or checks required by `AGENTS.md`

### `implement`

Use when adding or changing supported functionality in a downstream app with `@vgs/collect-react-native`.

- confirm prerequisites and supported installation path from `AGENTS.md`
- apply the collection-flow rules from `AGENTS.md` before generating code
- prefer the smallest documented public API surface
- implement the requested feature in the customer's app context, not just a generic snippet
- generate code and config with explicit validation and error handling
- include the tests or checks required by `AGENTS.md`
- use placeholders only for secrets, identifiers, endpoints, and environment values that the user has not supplied

### `migrate`

Use when moving between versions or replacing deprecated behavior.

- identify current version and target version
- load the current-version docs snapshot when available
- load the target-version docs snapshot
- use target-version `AGENTS.md` as the authoritative destination rule set
- compare the existing code against the current-version docs when possible, and against the target-version docs for required changes
- use repository release notes to capture version-to-version changes and release-specific caveats
- replace deprecated or removed behavior with the newest documented public alternative
- call out any behavior changes that cannot be preserved exactly

### `troubleshoot`

Use when the integration is failing or behaving unexpectedly.

- localize the failure before changing code
- prefer evidence from logs, tests, dependency state, or a minimal repro
- validate fixes against the resolved version's public behavior and invariants
- distinguish confirmed cause from likely cause and from workaround

### `review`

Use when reviewing a patch, PR, or design.

- review against the resolved version's `AGENTS.md` and public APIs
- retrieve additional implementation evidence when exact API details or version-specific behavior matter
- prioritize correctness, safety, compatibility, and missing tests
- flag private, deprecated, insecure, or version-incompatible behavior
- say explicitly when the reviewed code appears to target a different version

A task may have a secondary mode, but the primary mode controls planning and output.

## Transparency requirements

Always state which package version guidance is based on.

When relevant, say one of:
- `Using @vgs/collect-react-native 1.1.5.`
- `Detected @vgs/collect-react-native 1.1.5 from package.json.`
- `Could not determine the installed @vgs/collect-react-native version; using latest guidance from the default branch.`
- `Exact tag 1.1.6 was not found; using nearest compatible tag 1.1.5.`

## Output contract

When this skill is used:
- begin by stating which package version was detected or assumed
- if the version could not be determined, say that latest default-branch guidance is being used
- then proceed using the active version-matched snapshot rather than stale assumptions
