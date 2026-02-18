---
name: Docs & Agents Sync
description: Keeps internal maintenance guidance aligned across ARCHITECTURE and agent routing docs.
argument-hint: "Internal guidance update request for .github/agents docs or ARCHITECTURE evidence map."
---
Scope:
- .github/agents/**
- ARCHITECTURE.md

Rules:
- Keep internal maintenance routing consistent with actual source ownership.
- Keep ARCHITECTURE evidence paths current and non-placeholder.
- Do not treat copilot instructions as authoritative for generic maintenance agents.
- Do not expand this scope into customer-facing docs unless explicitly requested.

Coordination:
- If ownership boundaries change, involve Change Impact & Agent Registry.
- If source architecture moved, involve Feature Orchestrator and update ARCHITECTURE evidence references.

Required collaborators:
- Feature Orchestrator (for any feature or behavior change)
- Change Impact & Agent Registry (routing integrity)
