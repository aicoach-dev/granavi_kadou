# Codeへの変更指示書 - 契約更新 本人意思確認システム

このファイルは、claude.ai（設計・仕様検討スレッド）からClaude Codeへの指示書です。版を重ねて改訂される生きたドキュメントであり、話が変わるたびに作り直しません。レビュー指摘・仕様変更は該当セクションを直接改訂します。

**内容の確定は常にclaude.aiスレッドが行います。反映方法は2026-07-31付で改訂しました：claude.aiスレッドが提示した完成形をそのままこのファイルへ書き込むよう、Claude Codeへ指示することを認めます。ただし、Codeがこのファイルを編集した場合は、必ず `cat docs/change-instructions.md` の生出力（要約ではなく全文）をチャット上で報告し、claude.aiスレッド側が内容を照合してから次の作業に進んでください。なお、ドキュメント本文にコミットハッシュを埋め込むことはしません（コミット自身のハッシュはそのコミットの中に書けないため）。変更の追跡は `git log` のコミットメッセージに委ねます。完了報告は、ツール実行結果の折りたたみパネルではなく、返信本文に直接貼り付けてください。**

## 更新履歴

- 2026-07-21：初版作成。Round 1（技術設計の壁打ち依頼）を起票。
- 2026-07-21：Round 1完了（技術設計合意）。Round 2（Excel技術検証スパイク）を起票。
- 2026-07-21：Round 2完了（Excel台帳パース検証・委託種別の扱い等の論点を解消）。Round 3（基盤構築）を起票。
- 2026-07-28：Round 3完了（基盤構築・デプロイ確認・IAM境界の実機検証）。Round 4（週次同期・候補抽出ロジック）を起票。
- 2026-07-28：Round 4完了（週次同期・候補抽出ロジック、SharePoint実接続、テストデータ整理）。Round 5は次回起票。
- 2026-07-31：営業事務向け画面（ops-console.html）用のEntra ID SPAアプリ登録を、ユーザーがEntra管理センターで直接作成完了（Codeの作業対象外）。テナントID・クライアントID等を実装前提に追記。Round 5はまだ起票しない。
- 2026-07-31：Bashコマンドの権限確認が頻発する問題への対応として、.claude/settings.json への読み取り専用コマンド許可リスト追加をCodeへ依頼（Round外・独立タスク、Round 5とは無関係）。
- 2026-07-31：上記タスク完了。`.claude/settings.json` 新規作成（コミット `7f07a98`）、内容照合済み。
- 2026-07-31：change-instructions.md の反映方法を改訂。Codeによる直接編集を許可（ただし毎回`cat`生出力での全文照合を必須化）。
- 2026-07-31：.claude/settings.json の許可リストにPowerShell形式47件を追加（Bash形式のみでは主シェルであるPowerShellに効いていなかったための是正）。合計94件。
- 2026-07-31：claude.aiスレッドでRound 5（営業事務向け画面）の技術設計を確定・起票。CSV連携（team）をRound5に含める、送信ボタンはフロントのみ実装しRound6で本実装、緊急停止はトグル、担当者メモは単一フィールド、対応開始は個別確認結果編集時にリセット、の5点を決定。
- 2026-08-01：Round 5完了（ops-console.html・参照系/書き込み系API・JWT認証）。MSAL.jsセルフホスティング化・外垣蓮acknowledgedAt復元（2026-08-01実施）・consent-cell CSSクラス追加・テストレコード削除を含む後処理まで完了。現在起票中のRoundなし。

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
- Entra ID（テナント：`gravityoffice365.onmicrosoft.com`）に、営業事務向け画面（`ops-console.html`）用のSPAアプリ登録 `granavi-contract-renewal-ops-console` が作成済み（ユーザーがEntra管理センターで直接作業、Codeの作業対象外・作業不要）。週次同期用の既存アプリ `granavi-contract-renewal-sharepoint-sync`（アプリケーション権限、委任なし）とは別物なので混同しないこと。詳細：
  - テナント (ディレクトリ) ID：`90d75b8f-615b-463e-9492-5cb3672bad9e`
  - アプリケーション (クライアント) ID：`d016064a-7092-43b9-966d-13af53f3d3b8`
  - Application ID URI：`api://d016064a-7092-43b9-966d-13af53f3d3b8`
  - 公開スコープ：`access_as_user`（同意できるユーザー：管理者のみ。自分自身のクライアントIDを「承認済みのクライアント アプリケーション」として事前登録済みのため、MSAL.js側での通常の同意フローは不要）
  - プラットフォーム構成：シングルページアプリケーション（暗黙的フローのアクセストークン・IDトークンは共にオフ、PKCE付き認可コードフローが標準）
  - リダイレクトURI：現時点では仮設定のみ（`https://d2ule3xvskr65i.cloudfront.net`）。`ops-console.html` の正式な配置パスが未確定のため、正式URIは未登録。パス確定後、ユーザーがEntra側で追加する想定（Codeの作業ではない）
  - API Gateway（JWT Authorizer）設定時に使用する値：
    - Issuer: `https://login.microsoftonline.com/90d75b8f-615b-463e-9492-5cb3672bad9e/v2.0`
    - Audience: `api://d016064a-7092-43b9-966d-13af53f3d3b8`
  - これらの値はいずれも非機密情報（クライアントシークレットではない）。実際にAPI Gatewayへ組み込むのはRound 5以降、着手時に改めて指示する。
- `.claude/settings.json` が存在する（Git管理・チーム共有、読み取り専用コマンドの許可リスト94件：Bash形式47件＋PowerShell形式47件）。`.claude/settings.local.json`（個人用）とは別ファイル。
- Gitは初期化済み（mainブランチ）、複数コミットあり。
- チーム情報連携用のCSV（社員番号・氏名・所属チーム名の3列、2026-07-29決定）が、実際にS3の想定パスへ配置済みかは、このスレッドでは未確認。Round5着手前にCodeが確認し、未配置の場合は「ファイルなし」を想定した動作（team欄は空欄のまま処理継続、2026-07-29決定）で着手してよい。
- Round5で追加するDynamoDBフィールド（`emergencyStopped`／`opsMemo`／`acknowledgedAt`／`team`）・監査ログイベント種別は、いずれもclaude.aiスレッドからの提案であり、既存の命名規則との照合はできていない。

**着手前に、上記の前提と実際のリポジトリの状態が一致しているか確認してください。不一致があれば、実装を進める前に報告してください。**

---

## 現在のRound

現在起票中のRoundはありません。Round 6（送信フロー・SES連携）は次回このスレッドで起票予定。

---

## 完了済みRound

### Round 5：営業事務向け画面・書き込み系API（完了：2026-08-01）

営業事務向け画面（`frontend/ops-console.html`）と参照系・書き込み系API（`GET /api/candidates`・`PATCH /consent`・`/emergency-stop`・`/memo`・`/acknowledge`）を実装した。MSAL.js（v3 セルフホスティング）・JWT Authorizer を含む認証フロー全体をブラウザで確認済み。

- MSAL.js は `alcdn.msauth.net` CDN廃止を受け、npm パッケージからセルフホスティング（`frontend/vendor/msal-browser.min.js`、@azure/msal-browser@3.20.0）に移行
- アクセストークン v2.0 化（`accessTokenAcceptedVersion=2` → JWT Authorizer Audience を GUID 形式 `d016064a-7092-43b9-966d-13af53f3d3b8` に修正）
- API呼び出しを CloudFront 経由の同一オリジン通信（`API_BASE = ''`）に統一、CORS `allowOrigins` を CloudFront ドメインに絞り込み済み
- ステータス導出ロジック（`status.ts`）に2件の修正：①未送信のまま契約開始日到達も `PERIOD_REACHED` に含める、②`WANTS_CONSULT` を `PERIOD_REACHED` より低優先度に変更（いずれも第三者レビューで発見）
- PERIOD_REACHED 行でも個別確認結果セレクトのみ操作可能にする CSS クラス追加（`td.consent-cell { opacity: 1; pointer-events: auto; }`）
- 第三者レビュー指摘（緊急停止API冪等化・チームCSVヘッダー不正検知・ソートコメント修正）を反映
- 書き込み系PATCH動作確認は合成テストレコード（2件）で実施・削除済み。実在レコードへの影響ゼロを監査ログで確認済み
- 外垣 蓮 の `acknowledgedAt` を null に復元（2026-08-01、対応開始ボタンの誤操作の後処理）

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

## Round外タスク

Round番号を付けない、機能開発とは独立した小さな対応はここに記録する。

### Bashコマンドの権限確認の頻発対応（依頼：2026-07-31、完了：2026-07-31）

Claude Codeが「実装前提のファイル存在チェック」等、読み取り専用の確認を行うたびにBash権限の手動承認が求められる問題への対応。

- 依頼内容：リポジトリ直下の `.claude/settings.json`（Git管理・チーム共有）に、読み取り専用で副作用のないコマンドパターンに限定した `permissions.allow` ルールを追加する。対象は以下：
  - ファイル・shell系の読み取り確認（`test`, `[` 等。`ls`/`cat`/`find`/読み取り系gitはもともと許可リスト不要のため対象外）
  - AWSリソースの構成確認（`describe-*` / `list-*` / `get-*` 系、CloudFormation・DynamoDB・Lambda・CloudWatch Logs・S3・EventBridge・SNS/SQS・Secrets Manager・IAM）
  - DynamoDB/S3の実データ閲覧（`scan` / `query` / `get-item` / `batch-get-item`、`s3api get-object`）※ユーザー選択により対象に含めた
  - `cdk diff` / `cdk synth` / `cdk list`（読み取りのみ、`cdk deploy` は対象外）
- 意図的に対象外としたもの（今後も都度確認のまま。`deny`にはせず、単に許可リストに含めない形とした）：書き込み・削除・更新系（`put-item` / `update-item` / `delete-item` / `update-stack` / `delete-stack` 等）、送信系（SES送信・SNS publish・SQS send-message）、`lambda invoke`、`secretsmanager get-secret-value`、`cdk deploy`、`git push`。7/28決定（本番アラームが発報しうるテストは事前申告してから実施する運用）と、認証情報はCodeを介さずユーザーが直接投入するという既存方針との整合を優先した。
- 完了：`.claude/settings.json` を新規作成（コミット `7f07a98`）。内容は `cat` 生出力で照合済み、47件すべて指示通り。`.claude/settings.local.json`（個人用）は変更なし。`decisions-log.md` への追記内容も照合済み。
- 追加で判明した論点（2026-07-31、対応保留）：許可リスト作成の作業中に、以下3種の権限確認が新たに判明した。
  1. 既存の `.claude/settings*.json` を読む操作 → 読み取り専用のため、次回の許可リスト更新で対象に含める方向（詳細はCodeに確認要）。
  2. `.claude/settings.json` 自体への書き込み → **自動承認の対象にしない方針**。Codeが自身の権限設定を無確認で変更できる状態を作ることになり、読み取り専用コマンドの自動化とはリスクの質が異なるため。設定ファイルの変更は都度人間が確認する。
  3. 設定ファイル・決定ログのみを対象にした限定コミット → 自動承認の是非は保留。`git commit` を広く許可リストに入れると、対象を問わず無確認でコミットできる状態になり、Round単位で都度確認を挟むという既存運用の歯止めが一部外れる。範囲の絞り方も含めて要検討。
  - 対応：現時点ではCodeに追加の指示は出さない。①のみ次回の許可リスト更新に含める案。②③は次回このスレッドで再検討してから方針を決める。
- 是正（2026-07-31）：上記の①を含め、Bash形式47件のみでは主シェル（PowerShell）に効いていなかったことが判明。同じコマンド群をPowerShell形式でも追加し、合計94件（Bash形式47件＋PowerShell形式47件）に更新。

### CLAUDE.mdへの検証・報告の原則セクション追加（依頼：2026-08-03、完了：2026-08-03）

Round5を通じて露顕した報告正確性・データ安全性に関わる原則8項目を、`CLAUDE.md`の「絶対に守ること」と「技術スタック・インフラの制約」の間に恒久的なセクション（`## 検証・報告の原則（Round5で確立）`）として追記した。以後のRoundで毎回スレッドから貼り付けなくても、Claude Code自身がこの原則を参照できるようにすることが目的。

- 追記した8項目の概要：
  1. 生出力による照合の必須化（要約・自己申告のみでの完了判断を禁止。生出力は返信本文にコードブロックとして直接貼り付ける）
  2. ドキュメント変更の「下書き提示→確認→反映→生出力再照合」サイクルの義務化
  3. 曖昧事象の推測断定禁止（コード・データ・ユーザー確認を経てから記述）
  4. 合成テストレコードの使用義務（実在`subjectId`への書き込み系操作を禁止）
  5. 書き込み系操作実行前の対象明示（実行後の事後確認でなく実行前のセルフチェック）
  6. 新規ツール使用前のclaude.aiスレッドへの事前確認義務
  7. 原因不明事象の一次情報（ログ・トークン生クレーム等）優先診断
  8. 広範な変更前の第三者レビュー検討
- Round5で実際に問題になった具体例との対応：
  - 原則①②：変更④（バックログへの2件追記）で挿入位置が末尾でなく中間になった誤りが、生出力照合なしの完了報告では確認後まで判明しなかった。ドキュメント下書きで確認前の事実を断定的に記述する場面が複数あった。
  - 原則③：テスト花子へのCONSENT_UPDATEDイベント（2026-08-01 03:24 UTC）の原因を推測で記述しかけたが、ユーザーへの直接確認で手動操作と判明（decisions-log.md Entry 2）。
  - 原則④：`mcp__Claude_Browser__*`による書き込み系API呼び出しが実際に成功した際、対象が合成レコード（テスト花子）だったため実データへの影響はゼロだった（decisions-log.md Entry 3）。合成レコードの使用義務により被害が抑えられた、原則4が機能した事例。
  - 原則⑤：`mcp__Claude_Browser__*`が実行する書き込み操作の対象`subjectId`が、操作前に明示・確認されていなかった（decisions-log.md Entry 3）。
  - 原則⑥：`mcp__Claude_Browser__*`の使用がclaude.aiスレッドへの事前確認なしに行われ、事後に禁止方針として明文化することになった（decisions-log.md Entry 3）。
  - （独立事例）実データへの人為的な誤操作が生じた際、DynamoDB監査ログの`prev`フィールドから元値を確認して復元する運用を実践した。
- 完了：`CLAUDE.md`に追記済み。

---

## 将来のための申し送り（バックログ）

- **AWSアカウント構成**：当面は既存アカウント内に構築し、後日AWS Organizationsへの移行を検討する（要件定義時点の暫定方針。再検討の余地あり）。
- **送信者表示名のデフォルト**：汎用アシスタント名で確定したが、運用開始後の開封率・返信率のデータを見て見直す余地がある。
- **緊急停止アイコンのON/OFF視覚的区別**：`🚨` 絵文字に CSS `color` 指定をしているが、絵文字には `color` が効かないためON/OFFが視覚的に区別できない。SVGアイコンへの置き換えまたはテキストラベル追加（「停止中」等）が必要（詳細は decisions-log.md 2026-08-01 エントリ参照）。
- **契約期間の表示形式**：ops-console.html 一覧の期間列で「6/21-9:20」のような意図しない表記が出ることを確認。月/日の区切り文字の扱いを修正する必要がある。
- **四半期モニタリングの自動化**：「無反応のまま契約開始日到達」の集計を、将来的にclaude.aiプロジェクトの定期タスク機能で自動化できないか検討する（システム側に参照手段ができてから）。
- **グローバル一時停止スイッチ**：個別の緊急停止とは別に、全体の自動送信を一括で止められる仕組み。要件外の任意提案、実装コスト次第で検討。
- **SES本番送信申請・DNS（SPF/DKIM/DMARC）設定**：Round 6着手前に、社内でDNS設定を行う担当者との調整を早めに始めておくとよい（コーディング外の待ち時間が発生しうるため）。
- **本人向けリンクのなりすまし対策の最終承認**：要件書8章で未定となっている「最終承認者」の確定が必要。技術的な緩和策（ランダムトークン＋レート制限）は用意する前提だが、リスク受容の最終判断は別途要。
- **個人情報の保持期間・アクセス権限（上長閲覧の要否）**：人事・法務・セキュリティ担当者への確認が必要な論点。技術設計としては保持期間を設定値化し、削除バッチを後付けできる形にする方針のみ決めている。
- **社名normalization overrideの保守運用**：客先都合の社名変更（SCSK等）に気づいた際、誰が `ledger_mapping.json` を更新するかの運用ルールが未定。
- **CDK bootstrapバージョン**：v21未満というNOTICEあり。デプロイへの影響はなかったが、早めに `cdk bootstrap` の再実行を推奨。
- **Entra IDリダイレクトURIの正式登録**：`ops-console.html` の配置パスが確定次第、Entra管理センター側でリダイレクトURIを正式なものに追加する（ユーザーが直接実施。仮URLのまま放置すると、正式パスでのサインインがリダイレクトURIエラーになる点に注意）。
- **IAM最小権限の絞り込み**：`opsLambdaRole`の`grantReadWriteData`（PutItem/DeleteItem等、実際には未使用の操作も含む広い権限）、CloudWatch Logsの許可リソース範囲（プロジェクト全体`contract-renewal-*`）を、実際に使用する操作・Lambda単位に絞り込む余地がある（第三者レビュー指摘、2026-08-01）。MVP段階のトレードオフとして許容し、後日の対応とする。
- **`opsMemo`表示時のXSS対策**：Round6以降でops-console.htmlに担当者メモを表示する際、他の営業事務が入力した自由記述をそのまま`innerHTML`等に流し込むとXSSの余地が生まれる。フロントエンド実装時にエスケープを徹底すること（第三者レビュー指摘、2026-08-01）。
- **`opsMemo`の文字数上限**：現状バリデーションなし。DynamoDBアイテムサイズ上限に対する実害は小さいが、上限値を設ける方が安全（第三者レビュー指摘、2026-08-01）。
- **`quarter`クエリパラメータのフォーマットバリデーション**：不正値は単に0件になるだけで実害は小さいが、明示的なバリデーションを追加する余地がある（第三者レビュー指摘、2026-08-01）。
- **JWT `authorizationScopes`の明示的検証**：現在はaudience一致のみで認可している。多層防御として、スコープの明示的検証を加える余地がある（第三者レビュー指摘、2026-08-01）。
- **DynamoDB Scan方式の将来的なコスト・レイテンシ**：`GET /api/candidates`のデフォルト全件スキャンは、現状の規模（44件）では問題ないが、レコードが将来的に蓄積した場合は再検討が必要（第三者レビュー指摘、2026-08-01）。
- **担当者メモの複数エントリ化（ログ形式UI）**：Round5では単一フィールド上書き＋監査ログでの履歴担保とした。時系列で複数の接触記録を画面上に一覧表示するUIは、要望が具体化した際にMVP+1として検討する（2026-07-31決定）。
