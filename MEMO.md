# グラナビ稼働（granavi_kadou）MEMO

## 1. プロジェクト概要

- **プロダクト名**：グラナビ稼働（granavi_kadou）
- **目的**：エンジニアの稼働・フォロー状態を見える化し、
  管理者・リーダーが必要なフォローに気づけるようにする
- **解決した課題**：稼働一覧・月次実績・定期タスクの状態を
  1画面で確認できなかった問題を解消
- **グラナビシリーズ内の位置づけ**：
  グラナビ契約（granavi_contract）と並行して運用する
  エンジニア稼働管理ツール。
  将来的にグラナビ契約の HakkenActive との連携候補。

---

## 2. インフラ設定値

### GitHub
| 項目 | 値 |
|------|----|
| リポジトリURL | https://github.com/aicoach-dev/granavi_kadou |
| ローカルパス | C:\Users\kochi\Documents\GraNavi\granavi_kadou |
| GitHub Pages URL | https://aicoach-dev.github.io/granavi_kadou/kadou.html |

### GAS
| 項目 | 値 |
|------|----|
| エンドポイントURL | https://script.google.com/macros/s/AKfycbwNPFUL3t562swqlSxsGnovTyIZS_I3HC3tzby0Sl-QZ1E5obQ8aevPJ97qUfqVhHxC/exec |
| スプレッドシートID | 1NGsBsH0cG-e77udez4DPr6u-wMC-zFkzl2o0W8hD7o0 |
| GASプロジェクト名 | 無題のプロジェクト |
| スプレッドシート名 | granavi_kadou_db |

### localStorage キー一覧
| キー名 | 用途 |
|--------|------|
| kadou_v2 | メンバーデータ（GAS保存失敗時バックアップ） |
| kadou_monthly_v1 | 月次実績データ |
| kadou_test_base_date | テスト基準日オーバーライド |
| kadou_recipient_settings | チーム別宛先設定 |
| kadou_recipient_mode | 宛先モード（test / prod） |
| granavi_periodicTasks | 定期タスク確認の期間ラベルと状態 |

---

## 3. ファイル構成

```
granavi_kadou/
├── kadou.html   # メインアプリ（全機能を1ファイルに集約）
├── AGENTS.md    # Codex向け実装制約・方針
└── MEMO.md      # 本ファイル
```

---

### 4. デプロイ手順

GitHub Pages を使用。push するだけで自動反映される。

```bash
cd C:\Users\kochi\Documents\GraNavi\granavi_kadou
git add kadou.html
git commit -m "変更内容の説明"
git push
```

反映URL：https://aicoach-dev.github.io/granavi_kadou/kadou.html

---

### 5. 実装済み機能一覧

現バージョン：v0.4.0

| 機能 | 概要 |
|------|------|
| 稼働一覧 | エンジニアの稼働区分・要警戒・スキル課題等の状態管理 |
| 月次実績 | 1on1・月報・顧客ニーズ・ブログ・面接協力の月次記録 |
| 未更新検知 | 7日未更新・月次25日以降の未入力を自動検知 |
| リマインド生成 | 未更新者向けのリマインドメール文面を半自動生成 |
| mailto 導線 | 自動送信なし。人が確認して送信する設計 |
| 宛先設定 | チーム単位の通知先をtest/prodモードで管理 |
| テスト基準日オーバーライド | 任意の日付を基準日として動作確認できる機能 |
| 月次ドラフト出力 | OneNote貼り付け想定のHTML/テキスト出力 |
| 待機社員フォロー表示 | 待機中エンジニアのゴール・進捗・課題を管理 |
| 定期タスク確認 | 半期・年次の重要提出物（5項目固定）の完了状態管理 |

---

### 6. 既知の不具合と解決済み対応

現時点で既知の不具合はありません。

---

### 7. データ設計の注意事項

**メンバーデータのフィールド構成**

```json
{
  "id": "c_1",
  "name": "氏名",
  "team": "S/W1",
  "status_type": "稼働中 | 待機中",
  "is_watch": false,
  "watch_note": "",
  "role_mismatch": false,
  "skill_issue": false,
  "concern": false,
  "last_1on1": "YYYY-MM-DD",
  "memo": "",
  "updated_at": "",
  "followOwner": "",
  "taiki_goal": "",
  "taiki_progress": "",
  "taiki_issue": ""
}
```

**チーム一覧（固定値）**
S/W1、S/W2、S/W3、S/W4、セミコン、ハード、メカ、TEC、部付き

**定期タスク確認データ構造（localStorage: granavi_periodicTasks）**

```json
{
  "periodLabel": "2026下期",
  "taskStates": {
    "c_1": {
      "スキルシート更新": "未 | 済 | 対象外",
      "スキルマトリクス更新": "未 | 済 | 対象外",
      "CS調査回収": "未 | 済 | 対象外",
      "目標設定／更新": "未 | 済 | 対象外",
      "成長ポイント記入": "未 | 済 | 対象外"
    }
  }
}
```

**グラナビ契約（HakkenActive）との将来的な連携可能性**
現在グラナビ契約側でHakkenActiveを手動管理している。
将来的にgranavi_kadouのstatus_type（稼働中/待機中）と
HakkenActiveを自動同期する候補として検討中。
ただし現時点では設計・実装ともに未着手。

---

### 8. 未決事項・将来の拡張候補

| 項目 | 状況 |
|------|------|
| グラナビ契約との連携（HakkenActive自動同期） | 未着手。設計検討が必要 |
| 定期タスク確認の対象タスク追加 | 現在5項目固定。拡張は仕様変更が必要 |
| 月次ドラフトのフォーマット改善 | 随時対応 |

---

### 9. 田中さんへの申し送り（本番グラナビ構築時）

（要確認：ユーザーが記載内容を確認・追記してください）
