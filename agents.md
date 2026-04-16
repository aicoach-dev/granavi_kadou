# granavi_kadou AGENTS

## Basic Policy
- Do not break the existing MVP.
- Implement with the smallest possible diff.
- Do not expand the spec on your own.
- If unclear, follow the current behavior.

## Target Files
- Primary target is `kadou.html`.
- Do not touch other files unless necessary.

## Prohibited
- Do not implement auto send. `mailto:` only.
- Do not save send history.
- Do not add GAS, APIs, or other external communication.
- Do not add permission control.
- Do not make large UI changes.
- Do not rewrite existing logic wholesale.

## Data Handling
- Do not alter `updated_at`, `last_1on1`, or `monthlyRecords` for convenience.
- Do not break factual data.
- Treat status as fact-based data.

## Implementation Rules
- Reuse existing functions first.
- Add helper functions only when needed and keep them minimal.
- Prefer `localStorage` for added state.
- Keep the existing reminder flow: modal, `mailto:`, copy.

## Recipient Settings
- Recipient settings are team-level notification destinations, not individual leader records.
- Support multiple email addresses as comma-separated text.
- Keep recipient mode as `test` / `prod`.

## Output Rules
- Always report:
  1. Change policy
  2. Changed files
  3. Added/changed functions
  4. Test results (normal / abnormal)
  5. Unverified items
  6. Notes (`localStorage` only, no auto send, etc.)

## Stance
- This is a lightweight MVP for follow-up support, not a full business system.
- Do not over-automate.
- Leave final judgment to people.
- Do not turn it into a notification platform.
