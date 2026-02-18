# RN Maintenance Agent Router

Internal maintenance routing for repository contributors and coding agents.
This file is maintenance-only and is not part of customer integration guidance.
It is reusable by orchestrator flows, repo-level maintenance agents, and human maintainers.

## Entry Point

- Start with `feature-orchestrator.md` for any non-trivial change.

## Capability Map

- Core collector, submit/tokenize/card APIs:
  - `sdk-core-submission.md`
- Input components, masks, validators, card metadata behavior:
  - `inputs-validation.md`
- Native bridge and codegen surfaces (iOS/Android/cpp):
  - `native-bridge-codegen.md`
- Logging, analytics, and error surfacing:
  - `observability-errors.md`
- Security and privacy review gate:
  - `security-privacy-review.md`
- Tests and quality gates:
  - `tests-qa.md`
- Internal docs and maintenance guidance sync:
  - `docs-agents-sync.md`
- CI workflow and release metadata changes:
  - `ci-release.md`
- Routing and ownership coverage across agent docs:
  - `change-impact.md`

## Stewardship

- No single owner.
- Any agent or maintainer that changes routing, roles, or coverage must update this file in the same change.
- `change-impact.md` and `docs-agents-sync.md` provide consistency checks, but do not exclusively own this file.

## Coordination Rules

1. Route through `feature-orchestrator.md`.
2. Include `security-privacy-review.md` and `tests-qa.md` for behavior changes.
3. Keep customer-facing docs unchanged unless explicitly requested.
4. Use `ARCHITECTURE.md` as the evidence map before making path claims.
5. Update this file whenever agent routing or ownership boundaries change.
