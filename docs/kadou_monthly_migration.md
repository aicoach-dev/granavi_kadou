# 概要

- `kadou_monthly_v1` の保存方式を変更
- 目的は Google Sheets 1セル 50,000文字制限の回避

# 変更内容

- 保存先を `data` シートから `monthly` シートへ変更
- 保存形式を 1セル JSON から 1行1レコードへ変更
- 主キーは `member_id + '__' + year_month`
- 変更対象は GAS のみ
- フロント (`kadou.html`) と Python (`import_1on1_history.py`) は無変更

# GAS修正ポイント

- `doGet` / `doPost` に `kadou_monthly_v1` 用の monthly 分岐を追加
- `monthly` シートをコードで自動生成
- `year_month`、`created_at`、`updated_at` の正規化処理を追加
- `updated_at` は monthly records 全体の最大値を返す方式に変更

# インポート結果

- import件数: 499件
- 既存47件とマージ後: 544件
- POST エラーなし
- 再GETで 544件を確認

# unmatched対応

- `田中 宏和タナカヒロカズ` : `田中 宏和` の表記ゆれ
- `山城 卓也` : 未登録
- `飯塚 道雄` : 未登録

# 結論

- 保存方式変更は成功
- 既存機能との互換は維持
- インポートは正常完了
