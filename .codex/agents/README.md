# RN Codex Contributor Router

This directory contains repo-local Codex entrypoints for contributor agents.

## Start Here

- Read [AGENTS.md](./AGENTS.md) in this folder first.

## Rules

- Treat `../../AGENTS.md` as the consumer integration contract, not the contributor workflow source.
- Keep `skills/vgs-collect-react-native-guide/SKILL.md` and `skills/vgs-collect-react-native-guide/references/AGENTS.md` updated when public integration guidance changes.
- Do not commit a root `.agents/` directory; it is a skill install artifact, not repository source.
- If the public skill path, name, or layout changes, update `.github/workflows/validate-skills.yml` in the same change.
- Never edit generated `docs/**` files directly.
- Keep contributor routing guidance in this folder only.
