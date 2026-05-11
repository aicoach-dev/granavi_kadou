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

## Condition Signal (コンディションシグナル)

### Purpose
Early detection of follow-up needs based on absence patterns.
This is NOT attendance monitoring. It is follow-up support only.

### Tab
Add as the 4th tab: "コンディションシグナル"
Do not modify existing tabs (稼働一覧, 月次実績, 定期タスク確認).

### KOT File Parsing
- KOT export files (.xls) are actually HTML, not binary Excel.
- Parse using DOMParser in the browser. No library needed.
- Required columns: 名前, 所属, 欠勤日数
- Name field format in KOT: "00201 豊田 淳" → split on space, [0]=kotId, [1+]=displayName
- Skip rows where kotId does not match /^\d+$/ (skip totals row)

### Thresholds (fixed, not configurable)
- Alert (警戒): absenceDays >= 3
- Watch (要注意): absenceDays == 2
- Display cutoff: absenceDays >= 2 (absenceDays < 2 → not shown)

### Chronic detection
- Chronic (慢性): current month isAlert === true AND previous month isAlert === true
- Requires 2 snapshots to evaluate. If only 1 snapshot exists, chronicFlag = false.

### Trend values (dropdown, 6 options)
慢性 / 一時的 / 増加傾向 / 改善傾向 / 再発 / 要確認
- Auto-assign on import. Human can override via dropdown.
- Once manually changed (manualOverride: true), auto-assign does not overwrite.

### Auto trend assignment logic
- chronicFlag true → 慢性
- isAlert true, previous month false → 増加傾向
- isAlert false, previous month true → 改善傾向
- isAlert true, 2 months ago true but previous month false → 再発
- otherwise → 要確認

### localStorage
- Key: granavi_conditionSignal
- Structure: array of monthly snapshots
  { snapshotMonth: "2026-04", importedAt: "2026-05-11", members: [...] }
- Append new snapshot on each import. Do not overwrite existing snapshots.
- Max snapshots to retain: 12 (drop oldest when exceeded)

### Member record per snapshot
{
  kotId: string,         // "00201"
  name: string,          // "豊田 淳"
  dept: string,          // "技術部（AD）"
  absenceDays: number,
  isAlert: boolean,      // absenceDays >= 3
  isWatch: boolean,      // absenceDays == 2
  chronicFlag: boolean,
  absenceTrend: string,  // auto-assigned, human-overridable
  manualOverride: boolean,
  warningStatus: string, // "active" | "past" | "none"
  assignee: string,      // manual input, default ""
  memo: string           // manual input, default ""
}

### Prohibited
- Do not fetch KOT automatically. File upload only (two <input type="file">).
- Do not show absenceDays < 2 in the list.
- Do not implement medical or HR judgment language.
- Do not label the feature as 勤怠監視 or 欠勤管理.
- Do not add charts or graphs in MVP.
- Do not connect to existing reminder (mailto) flow.
- Do not save send history.
- Do not add per-member notes beyond the memo field.
- assignee field is free text only. Do not link to existing member records.

### Destructive operations
- Re-importing the same month overwrites that snapshot only. Confirm dialog required.
- Do not add a bulk delete feature.

### Architecture note
Keep KOT parsing logic in a separate function (e.g. parseKOTData(rawText))
that accepts raw HTML string and returns a member array.
The file upload handler and future API handler both call this same function.
Do not mix parsing logic into the upload event handler directly.
