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
- Do not add new GAS endpoints, APIs, or external communication.
  (The existing GAS_URL integration must not be removed or replaced.)
- Do not add permission control.
- Do not make large UI changes.
- Do not rewrite existing logic wholesale.

## Data Handling
- Do not alter `updated_at`, `last_1on1`, or `monthlyRecords` for convenience.
- Do not break factual data.
- Treat status as fact-based data.

## Member Identity
- Members do not have a stable unique ID in the current data model.
- Do not use `name` as a storage key for per-member state.
- A stable key must be defined in the member record (field: `id`,
  generated as a random string at creation time) before implementing
  any per-member localStorage state.
- When a member record lacks an `id`, assign one at load time and
  persist it on the next save.
- When a member is deleted from the members list, their associated
  localStorage entries must also be removed on the same save operation.

## localStorage Key Convention
- All localStorage keys must be prefixed with `granavi_`.
- Use descriptive, feature-scoped names.
  e.g., `granavi_testBaseDate`, `granavi_recipients`,
        `granavi_periodicTasks`
- Do not use generic keys such as `state`, `data`, or `settings`.
- All keys used must be listed in the Output Rules report.

## Destructive Operations
- Any operation that resets or bulk-deletes stored state must show
  a confirmation dialog before executing.
- When a member is deleted from the members list, their associated
  localStorage entries (e.g., periodic task states) must also be
  removed.
- Do not implement undo for localStorage resets.

## Periodic Task Check (定期タスク確認)
- Task items are fixed to exactly 5. Do not make them configurable.
  1. スキルシート更新
  2. スキルマトリクス更新
  3. CS調査回収
  4. 目標設定／更新
  5. 成長ポイント記入
- Status values are fixed to 3: 未 / 済 / 対象外.
  Do not add a 4th value.
- Do not add memo or note fields per task or per member-task.
- Do not add individual deadline fields.
- Do not connect to the existing reminder (mailto) flow.
- Do not save reminder send history.
- Period label reset must show a confirmation dialog before executing.
- Do not display multi-period history.
- Default status for all tasks on all members is 未.
- Period label is free text (e.g., 2026下期). Initial value: 2026下期.

## Implementation Rules
- Reuse existing functions first.
- Add helper functions only when needed and keep them minimal.
- Prefer `localStorage` for added state.
- Keep the existing reminder flow: modal, `mailto:`, copy.

## Recipient Settings
- Recipient settings are team-level notification destinations,
  not individual leader records.
- Support multiple email addresses as comma-separated text.
- Keep recipient mode as `test` / `prod`.

## Output Rules
- Always report:
  1. Change policy
  2. Changed files
  3. Added/changed functions
  4. localStorage keys added (key name, purpose, structure)
  5. Test results (normal / abnormal)
  6. Unverified items
  7. Notes (localStorage only, no auto send, etc.)

## Stance
- This is a lightweight MVP for follow-up support,
  not a full business system.
- Do not over-automate.
- Leave final judgment to people.
- Do not turn it into a notification platform.
