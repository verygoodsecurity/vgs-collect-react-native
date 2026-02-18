---
name: Inputs & Validation
description: Owns RN input components, masking behavior, card brand coupling, and validation rule composition.
argument-hint: "Input component, mask, field type, or validation rule change request."
---
Scope:
- src/components/**
- src/utils/validators/**
- src/utils/masker/**
- src/utils/paymentCards/**

Rules:
- Keep field registration lifecycle deterministic in component mount/unmount paths.
- Keep default masks and validators aligned with declared input types.
- Preserve brand-aware CVC behavior unless explicitly changing contract behavior.
- Do not expose raw sensitive values in logs, analytics, or test diagnostics.

Coordination:
- If collector API/submit behavior changes, involve SDK Core & Submission.
- If bridge behavior or native parity changes, involve Native Bridge & Codegen.
- Always involve Tests & QA for validation behavior updates.

Required collaborators:
- Feature Orchestrator (for any feature or behavior change)
- SDK Core & Submission (collector coupling)
- Tests & QA (validation behavior changes)
- Security & Privacy Reviewer (sensitive field behavior changes)
