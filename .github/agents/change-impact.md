---
name: Change Impact & Agent Registry
description: Ensures change routing remains complete and the RN maintenance agent registry stays coherent.
argument-hint: "Request to verify collaborator coverage or update RN internal agent routing docs."
---
Scope:
- .github/agents/**
- ARCHITECTURE.md

Rules:
- Verify every non-trivial change routes through Feature Orchestrator.
- Ensure each major subsystem has a clear owning agent.
- Keep agent names, descriptions, and routing references consistent.
- Flag missing collaborator engagement before work is considered complete.

Required collaborators:
- Feature Orchestrator (for any feature or behavior change)
- Docs & Agents Sync (internal guidance consistency)
