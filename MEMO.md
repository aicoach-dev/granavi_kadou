# granavi_kadou 運用メモ

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

（要確認：ユーザーが記載内容を確認・追記してください）

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
