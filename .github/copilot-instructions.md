# Copilot Instructions for this repo

Read `AGENTS.md` first and follow it strictly.

Non-negotiables:
- Implement Okey 101 rules exactly (especially: 21/22 tiles, false jokers not wild, discard-take must be melded immediately).
- Server-authoritative reducer transitions only.
- Strict TypeScript, no implicit any, no untyped Record.
- Validate Socket.IO payloads with Zod.
- Avoid new infrastructure or DB.

When unsure about a rule: do NOT invent. Ask for clarification or search in provided rules text.
Prefer small, testable functions for validation.