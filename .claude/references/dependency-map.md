# vgs-collect-react-native-private Dependency Map

## Project Structure

React Native SDK library (`@vgs/collect-react-native`) published to npm.
Built with `react-native-builder-bob`, uses npm workspaces.

- `src/` -- SDK source: components, collector logic, utilities, and tests (`__tests__/`)
- `example/` -- Example React Native app (workspace) used for manual testing and Maestro E2E flows
- `docs/` -- Documentation

The SDK has **no direct runtime dependencies** -- only `peerDependencies` on
`react` and `react-native` (any version). All listed dependencies in
`package.json` are `devDependencies` used for building, testing, and releasing.

## Dependency Categories

### Always Low Risk (Auto-merge Candidates)

| Pattern | Example | Reason |
|---------|---------|--------|
| Commit lint tooling | `commitlint`, `@commitlint/config-conventional` | Dev-only, enforces commit messages |
| Git hooks | `@evilmartians/lefthook` | Dev-only, local git hooks |
| Type definitions | `@types/jest`, `@types/react` | Compile-time only, no runtime effect |
| Linting / formatting | `eslint`, `eslint-*`, `prettier`, `@typescript-eslint/*` | Dev-only, code style enforcement |
| Test runner | `jest` | Test-only |
| CLI utilities | `del-cli` | Dev-only, used in `clean` script |
| Documentation | `typedoc` | Dev-only, generates docs |

### Needs Quick Review

| Pattern | Example | Reason | Expected Test Coverage |
|---------|---------|--------|----------------------|
| Build tooling | `react-native-builder-bob` | Builds the library output; changes could affect published artifacts | TypeScript typecheck, manual smoke test of built output |
| Release tooling | `release-it`, `@release-it/conventional-changelog` | Automates npm publish and GitHub releases; misconfiguration could break release flow | Release dry-run |
| TypeScript compiler | `typescript` | Compiler version changes can surface new errors or change emit | `typecheck` script, Jest tests |
| ESLint config (RN) | `@react-native/eslint-config` | Tied to React Native version; may introduce new lint rules | `lint` script |

### Needs Deep Review

| Pattern | Example | Reason | Expected Test Coverage |
|---------|---------|--------|----------------------|
| React | `react` | Core peer dependency, also devDep for building/testing; major bumps affect the entire SDK | Jest unit tests, example app, Maestro E2E |
| React Native monorepo | `react-native`, `@react-native/*`, `@react-native-community/*` | Core framework; updates may require native code changes (Android/iOS) and affect codegen | Jest unit tests, example app build, Maestro E2E |

## Historical Patterns (from PR analysis)

10 open Renovate PRs as of 2026-04-08:
- Most are minor/patch bumps of dev tooling (jest, eslint-plugin-prettier,
  commitlint, typedoc, lefthook, release-it, eslint)
- One `react` monorepo update (peer dep) and one `react-native` monorepo pin
- One `prettier` pin PR
- Volume is moderate (~1-2 PRs/week); backlog suggests manual review has stalled

## Renovate Configuration

From `renovate.json`:
- Groups `react-native`, `@react-native/*`, and `@react-native-community/*`
  packages into a single "react-native monorepo" PR
- No automerge rules configured
- No custom labels, schedules, or extends beyond defaults
- All PRs receive the `renovate` label (Renovate default)
