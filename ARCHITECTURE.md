# Architecture

## Repo Identity
- Purpose: React Native SDK (iOS/Android) for secure collection, validation, tokenization, and submission of sensitive data to a VGS Vault.
- Primary language/tooling: TypeScript/React Native, Jest, bob build, npm scripts.

## Authoritative Guidance Pointers
- AGENTS: `vgs-collect-react-native/AGENTS.md`
- Contributor workflow entry: `vgs-collect-react-native/.codex/agents/AGENTS.md`
- Contributor routing: `vgs-collect-react-native/.codex/agents/README.md`
- Repo docs: vgs-collect-react-native/README.md, vgs-collect-react-native/CONTRIBUTING.md
- Copilot-only guidance (non-authoritative for generic agents): `vgs-collect-react-native/.github/copilot-instructions.md`

## Source Structure Overview (Evidence)
- Public exports surface: `vgs-collect-react-native/src/index.tsx`
- Collector core: `vgs-collect-react-native/src/collector/VGSCollect.ts`
- Input components: `vgs-collect-react-native/src/components/VGSTextInputBase.tsx`, `vgs-collect-react-native/src/components/VGSTextInput.tsx`, `vgs-collect-react-native/src/components/VGSCardInput.tsx`, `vgs-collect-react-native/src/components/VGSCVCInput.tsx`
- Errors: `vgs-collect-react-native/src/utils/errors/VGSError.ts`
- Analytics: `vgs-collect-react-native/src/utils/analytics/AnalyticsClient.ts`
- Example usage: `vgs-collect-react-native/example/src/use-cases/CollectCardData.tsx`

## Public API Entry Points (Session Init Flow + Config Patterns)
- Collector initialization: `new VGSCollect(id, environment)` in `vgs-collect-react-native/src/collector/VGSCollect.ts`
- Configuration helpers for session init:
  - `setRouteId`, `setCname`, `setCustomHeaders` in `vgs-collect-react-native/src/collector/VGSCollect.ts`
- Public exports for consumer import surface: `VGSCollect`, input components, serializers, validators in `vgs-collect-react-native/src/index.tsx`
- Field registration and defaults:
  - `VGSTextInputBase` registers fields with collector and applies defaults by type in `vgs-collect-react-native/src/components/VGSTextInputBase.tsx`
  - `VGSTextInput` wrappers define default fieldName/type/serializers in `vgs-collect-react-native/src/components/VGSTextInput.tsx`
  - `VGSCardInput` and `VGSCVCInput` specialize card and CVC behavior in `vgs-collect-react-native/src/components/VGSCardInput.tsx` and `vgs-collect-react-native/src/components/VGSCVCInput.tsx`
- Example session init pattern: collector instantiation and input wiring in `vgs-collect-react-native/example/src/use-cases/CollectCardData.tsx`

## Error Model Locations
- `VGSError` class and error codes: `vgs-collect-react-native/src/utils/errors/VGSError.ts`

## Analytics/Logging Locations
- Analytics client and event types: `vgs-collect-react-native/src/utils/analytics/AnalyticsClient.ts`
- Logger singleton: `vgs-collect-react-native/src/utils/logger/VGSCollectLogger.ts`

## Build/Test Command Discovery (Evidence)
- CI runs tests: `vgs-collect-react-native/.github/workflows/tests-and-scans.yml` (`npm ci`, `npm test`)
- CI iOS build/e2e chain: `vgs-collect-react-native/.github/workflows/tests-and-scans.yml` (`npx expo prebuild --platform ios`, `pod install`, `xcodebuild`)
- Package scripts (local): `vgs-collect-react-native/package.json`
  - `test`: `jest`
  - `typecheck`: `tsc`
  - `lint`: `eslint src --ext .ts,.tsx --max-warnings=0`
  - `prepare`: `bob build`

## Patterns and Conventions
- Public imports must come from `src/index.tsx` (root export surface).
- Collector owns URL/session configuration, with optional `routeId` and `cname` validation.
- Input components register with collector on mount; type defaults drive mask/validation.
- Errors are surfaced via `VGSError` (`code` + `details`), not generic `Error`.
