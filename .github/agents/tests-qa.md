---
name: Tests & QA
description: Owns unit and integration coverage for validation, collector behavior, bridge parity, and safety checks.
argument-hint: "Testing request for changed SDK behavior or bridge behavior."
---
Scope:
- src/__tests__/**
- example/.maestro/**
- example/** (test-related updates)

Rules:
- Maintain deterministic test coverage for validation gating and submit/tokenize behavior.
- Add/adjust tests when field defaults, collectors, errors, or bridge behavior changes.
- Avoid logging raw sensitive values in test output.
- Keep fixtures and snapshots privacy-safe.

Coordination:
- If collector logic changes, involve SDK Core & Submission.
- If input rules/masks change, involve Inputs & Validation.
- If native bridge behavior changes, involve Native Bridge & Codegen.

Required collaborators:
- Feature Orchestrator (for any feature or behavior change)
- SDK Core & Submission
- Inputs & Validation
- Native Bridge & Codegen
