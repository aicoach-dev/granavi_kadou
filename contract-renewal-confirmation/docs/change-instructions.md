# Codeへの変更指示書 - 契約更新 本人意思確認システム

このファイルは、claude.ai（設計・仕様検討スレッド）からClaude Codeへの指示書です。版を重ねて改訂される生きたドキュメントであり、話が変わるたびに作り直しません。レビュー指摘・仕様変更は該当セクションを直接改訂します。

**このファイルはclaude.aiスレッドのみが編集します。Claude Codeはこのファイルの内容を編集・追記しないでください（2026-07-28確認済みの運用ルール）。実施結果はチャット上の報告としてまとめてください。**

## 更新履歴

- 2026-07-21：初版作成。Round 1（技術設計の壁打ち依頼）を起票。
- 2026-07-21：Round 1完了（技術設計合意）。Round 2（Excel技術検証スパイク）を起票。
- 2026-07-21：Round 2完了（Excel台帳パース検証・委託種別の扱い等の論点を解消）。Round 3（基盤構築）を起票。
- 2026-07-28：Round 3完了（基盤構築・デプロイ確認・IAM境界の実機検証）。Round 4（週次同期・候補抽出ロジック）を起票。
- 2026-07-28：Round 4完了（週次同期・候補抽出ロジック、SharePoint実接続、テストデータ整理）。Round 5は次回起票。

---

## 実装前提（現在のリポジトリ・データの状態についての想定）

- `CLAUDE.md` / `README.md` / `docs/requirements.md` / `docs/decisions-log.md` / `docs/change-instructions.md` / `docs/business-flow-diagram.svg` が存在する。
- `scripts/analyze_ledger.py`、`scripts/config/ledger_mapping.json`（正本）が存在する。`backend/sync/config/ledger_mapping.json` は削除済み（二重管理解消、CDK bundling時に自動コピー）。
- `infra/` にAWS CDK（TypeScript）プロジェクトが実装済みで、AWSアカウント `698212246219` / `ap-northeast-1` へデプロイ済み（`ContractRenewalStack`）。
- `backend/sync/` に週次同期Lambda（Python）が実装済み。SharePoint Graph API接続はGUID（`SHAREPOINT_ITEM_GUID`）によるリストアイテムスキャン方式（`Sites.Selected`権限下で動作確認済み）。
- EventBridge Schedulerによる週次実行、CloudWatch Alarm（`contract-renewal-sync-errors`）→SNS（`contract-renewal-alerts`）通知が稼働中。通知先メールアドレス登録・確認済み。
- DynamoDB現在状態テーブルに、実データ44件が投入済み（テストデータは削除済み）。監査ログテーブルにはテスト実行分の記録も含めて保持されている。
- Secrets Manager（`contract-renewal-graph-api`）に実際の認証情報が投入済み。
- `frontend/` は空フォルダの状態。営業事務向け画面（`ops-console.html`）・本人向け画面（`applicant.html`）・API Gatewayの実エンドポイントは未実装。
- Gitは初期化済み（mainブランチ）、複数コミットあり。

**着手前に、上記の前提と実際のリポジトリの状態が一致しているか確認してください。不一致があれば、実装を進める前に報告してください。**

---

## 現在のRound

現時点で着手中のRoundはありません。Round 5（営業事務向け画面）は、claude.aiスレッドでの壁打ちを経て、次回起票します。着手しないでください。

---

## 完了済みRound

### Round 4：週次同期・候補抽出ロジック（完了：2026-07-28）

週次同期Lambda（Python）を実装し、実際のSharePoint台帳から候補抽出・DynamoDBへの反映まで一連の動作を確認した。

- 基準日（契約開始日−1ヶ月−15日、暦月方式）を過ぎた行のみ候補作成される仕組みを実装・確認
- 「委託」種別のデフォルト除外・許可リスト（イーソル株式会社）が正しく機能することを実データで確認（除外2件：ネクスジェンテクノロジーズ・ブライセン／通過2件：イーソル株式会社2名）
- Excel「本人確認」列の生値・出所（客先ブロック名）を監査ログに記録する仕組みを実装。認識済みの値がある行は、個別確認結果を事前セットした状態で候補作成される（出所は「Excel台帳（週次同期）」）
- 未知の値は「未解決」として記録し、通常の候補として扱われることを確認
- 冪等性（再実行での重複防止）を確認
- SharePoint接続はGraph API `listItems`全件取得＋GUID（`sourcedoc`由来）照合方式を採用。`$filter`によるOData絞り込み・ドライブ検索はいずれも`Sites.Selected`権限下で動作せず、この方式に決定
- 実データでの最終実行結果：total=46, due=44, excluded_commission=2, created=44, created_consent_preset=27
- `ledger_mapping.json`の二重管理を解消（`scripts/config/`を正本とし、CDK bundling時に自動コピー）
- `Sites.Selected`権限取得の経緯を`backend/sync/fetch_excel.py`（25〜54行目）にコメントとして記録
- テストデータ（synthetic 5件・sanitized 42件、計47件）を承認の上、現在状態テーブルから削除。監査ログは保持（2026-07-28決定）
- 開発中の是正事項：ロールバック起因の孤立リソースをAWS CLIで直接削除した件（実害はなかったが、今後は事前相談する運用に変更）。SES送信権限の過剰付与（`Resource: "*"`）をidentity ARN制限に是正。CloudWatchアラームが実際に発報した事象を確認し、試行錯誤によるものと特定（今後は申告先行の運用に変更、2026-07-28決定）

### Round 3：基盤構築（完了：2026-07-28）

CDK（TypeScript）でのIaC雛形、IAM Permissions Boundary、DynamoDB現在状態テーブル・監査ログテーブル、CloudFront＋S3（プレースホルダー）、API Gateway（スタブ）を実装し、AWSアカウント `698212246219` / `ap-northeast-1` へデプロイ成功（`ContractRenewalStack`、CREATE_COMPLETE）。

- IAM境界は `aws iam simulate-custom-policy` による実機テストで、既存の業務系・人材評価系リソース（`EmployeeTable` 等）への `implicitDeny`、プロジェクトリソースへの `allowed` を確認済み。
- **是正事項**：Permissions BoundaryのSES関連ステートメント（`ses:SendEmail`／`ses:SendRawEmail`）を、当初リソース制限なし（`Resource: "*"`）で実装していたが、完了確認の過程でAWS仕様上リソースレベル制限（identity ARN）が可能であることが判明し、`arn:aws:ses:ap-northeast-1:698212246219:identity/e-gravity.co.jp` に制限を修正・再デプロイ済み。X-Ray関連は仕様上リソースレベル制限をサポートしないため `Resource: "*"` のままで問題ないことを確認済み。
- `.gitignore` を先に作成した上でコミットし、`scripts/sample-data/`（実データ・個人情報）がGit履歴に含まれていないことを確認済み。

### Round 2：Excel台帳の技術検証（完了：2026-07-21）

全15客先ブロック・45件のデータ行についてパース検証を実施し、以下を確認した。

- 客先ブロックの境界は「A列（客先名）→ヘッダー行（B列『手続き』を含む）→D列（氏名）が非nullの行」というパターンで機械的に判定可能
- 必須カラム（企業・氏名・種類/形態・期間開始日・期間終了日・本人確認）は全件抽出可能
- 客先ごとの表記ゆれ（列名・社名の違い等）は、外部設定ファイル `scripts/config/ledger_mapping.json` で吸収する設計とした
- Python（openpyxl）での実装方針が確認できた。SharePoint Graph APIからのファイル取得〜メモリ上でのパースという方式が定番であることも確認済み

検証の過程で判明した実データ由来の論点（委託種別の扱い、本人確認列の値の出所記録等）は `docs/decisions-log.md` の該当日付エントリに決定事項として記録した。

### Round 1：技術設計の壁打ち（完了：2026-07-21）

以下の技術設計で合意した。詳細な決定理由は `docs/decisions-log.md` の2026-07-21付エントリを参照。

- **アーキテクチャ**：フルサーバーレス（Lambda / DynamoDB / API Gateway / SES / SQS / EventBridge）。VPCは使わない。新規CloudFrontディストリビューション1つ（`/*` → S3静的アセット、`/api/*` → API Gateway）。
- **IaC**：AWS CDK（TypeScript）。
- **実装言語**：CDKおよび大半のLambdaはTypeScript。週次同期（Excel取り込み）LambdaのみPython。
- **データストア**：DynamoDB。「現在状態テーブル」と「監査ログテーブル（追記専用）」の2本立て。
- **ステータス設計**：7種のステータス・自動停止条件は、DBに直接書き込む値にせず、一次情報（送信日時・回答内容・個別確認結果・緊急停止フラグ等）から都度導出する純粋関数として実装する方針。
- **個別確認結果の編集**：上書き自由、変更履歴は監査ログで担保。営業事務向け画面には誤操作軽減のための軽量な確認ダイアログ（ブラウザネイティブconfirm）を設ける。
- **今後のRound見込み（参考、詳細は都度このセクションに追記）**：
  R2 Excel技術検証（完了） → R3 基盤構築（完了） → R4 週次同期・候補抽出（完了） → R5 営業事務向け画面（次回起票） → R6 送信フロー（SES設定含む） → R7 本人向け画面・API → R8 リマインド・エスカレーション・自動停止ロジック → R9 四半期集計 → R10 障害検知・アラート → R11 ステージング確認・本番移行準備

---

## 将来のための申し送り（バックログ）

- **AWSアカウント構成**：当面は既存アカウント内に構築し、後日AWS Organizationsへの移行を検討する（要件定義時点の暫定方針。再検討の余地あり）。
- **送信者表示名のデフォルト**：汎用アシスタント名で確定したが、運用開始後の開封率・返信率のデータを見て見直す余地がある。
- **四半期モニタリングの自動化**：「無反応のまま契約開始日到達」の集計を、将来的にclaude.aiプロジェクトの定期タスク機能で自動化できないか検討する（システム側に参照手段ができてから）。
- **グローバル一時停止スイッチ**：個別の緊急停止とは別に、全体の自動送信を一括で止められる仕組み。要件外の任意提案、実装コスト次第で検討。
- **SES本番送信申請・DNS（SPF/DKIM/DMARC）設定**：Round 6着手前に、社内でDNS設定を行う担当者との調整を早めに始めておくとよい（コーディング外の待ち時間が発生しうるため）。
- **本人向けリンクのなりすまし対策の最終承認**：要件書8章で未定となっている「最終承認者」の確定が必要。技術的な緩和策（ランダムトークン＋レート制限）は用意する前提だが、リスク受容の最終判断は別途要。
- **個人情報の保持期間・アクセス権限（上長閲覧の要否）**：人事・法務・セキュリティ担当者への確認が必要な論点。技術設計としては保持期間を設定値化し、削除バッチを後付けできる形にする方針のみ決めている。
- **社名normalization overrideの保守運用**：客先都合の社名変更（SCSK等）に気づいた際、誰が `ledger_mapping.json` を更新するかの運用ルールが未定。
- **CDK bootstrapバージョン**：v21未満というNOTICEあり。デプロイへの影響はなかったが、早めに `cdk bootstrap` の再実行を推奨。
