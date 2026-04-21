# AI Agents AGENTS Entry

This file is the contributor-agent entrypoint for maintenance work in this repo.

## Authority

Contributor workflow authority:
- `.codex/agents/README.md`

Integration behavior contract reference:
- `../../AGENTS.md` (consumer/integration guidance)

Contributors should not use `../../AGENTS.md` as the primary workflow playbook.
Use it to preserve consumer-facing behavior, validation, security constraints, and supported public APIs.

If contributor guidance conflicts with integration behavior constraints, preserve the integration constraints and update contributor docs.

## Required Entry Workflow

1. Read `ARCHITECTURE.md` before making path or ownership claims.
2. Read `.codex/agents/README.md` before non-trivial maintenance work.
3. Read `../../AGENTS.md` when a change affects customer-facing behavior, validation, privacy, version guidance, or public integration flows.
4. For public integration behavior changes, update `skills/vgs-collect-react-native-guide/SKILL.md`, `skills/vgs-collect-react-native-guide/references/AGENTS.md`, and `README.md` in the same change.
5. If the public skill path, name, or layout changes, update `.github/workflows/validate-skills.yml` in the same change.

## Contributor Rules

- Root `AGENTS.md` is consumer-facing guidance, not contributor workflow documentation.
- Root `.agents/` is an install artifact and must not be committed in this repository.
- Never hand-edit generated `docs/**` files; update the source content that feeds doc generation instead.
- Keep contributor guidance centralized under `.codex/agents/**`.
- Keep the public skill aligned with `../../AGENTS.md` whenever flow selection, version-source rules, or customer-facing integration guidance changes.
