import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct, IConstruct } from 'constructs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as fs from 'fs';

// このプロジェクトで作成するすべての IAM ロールに permissions boundary を自動適用する
class PermissionsBoundaryAspect implements cdk.IAspect {
  constructor(private readonly boundaryArn: string) {}

  visit(node: IConstruct): void {
    if (node instanceof iam.CfnRole) {
      node.permissionsBoundary = this.boundaryArn;
    }
  }
}

export class ContractRenewalStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    const accountId = this.account;
    const region = this.region;

    // =========================================================
    // 1. IAM Permissions Boundary
    //    このプロジェクトの IAM ロールが操作できるリソースを
    //    contract-renewal-* の名前空間に限定する。
    //    既存の業務系・人材評価系リソースはアクセス不可。
    // =========================================================
    const permissionsBoundary = new iam.ManagedPolicy(
      this,
      'PermissionsBoundary',
      {
        managedPolicyName: 'contract-renewal-permissions-boundary',
        description:
          '契約更新システム専用 IAM permissions boundary — contract-renewal-* 以外のリソースへのアクセスを排除',
        statements: [
          // DynamoDB: このプロジェクトのテーブルのみ
          new iam.PolicyStatement({
            sid: 'AllowDynamoDB',
            effect: iam.Effect.ALLOW,
            actions: ['dynamodb:*'],
            resources: [
              `arn:aws:dynamodb:${region}:${accountId}:table/contract-renewal-*`,
            ],
          }),
          // S3: このプロジェクトのバケットのみ
          new iam.PolicyStatement({
            sid: 'AllowS3',
            effect: iam.Effect.ALLOW,
            actions: [
              's3:GetObject',
              's3:PutObject',
              's3:DeleteObject',
              's3:ListBucket',
              's3:GetBucketLocation',
              's3:GetBucketVersioning',
            ],
            resources: [
              `arn:aws:s3:::contract-renewal-*`,
              `arn:aws:s3:::contract-renewal-*/*`,
            ],
          }),
          // CloudWatch Logs: このプロジェクトのロググループのみ
          new iam.PolicyStatement({
            sid: 'AllowCloudWatchLogs',
            effect: iam.Effect.ALLOW,
            actions: [
              'logs:CreateLogGroup',
              'logs:CreateLogStream',
              'logs:PutLogEvents',
              'logs:DescribeLogGroups',
              'logs:DescribeLogStreams',
            ],
            resources: [
              `arn:aws:logs:${region}:${accountId}:log-group:/aws/lambda/contract-renewal-*`,
              `arn:aws:logs:${region}:${accountId}:log-group:/aws/lambda/contract-renewal-*:*`,
            ],
          }),
          // SQS: このプロジェクトのキューのみ
          new iam.PolicyStatement({
            sid: 'AllowSQS',
            effect: iam.Effect.ALLOW,
            actions: [
              'sqs:SendMessage',
              'sqs:ReceiveMessage',
              'sqs:DeleteMessage',
              'sqs:GetQueueAttributes',
              'sqs:GetQueueUrl',
              'sqs:ChangeMessageVisibility',
            ],
            resources: [
              `arn:aws:sqs:${region}:${accountId}:contract-renewal-*`,
            ],
          }),
          // SES: SendEmail/SendRawEmail は送信元 identity ARN でリソース制限可能
          //      GetSendQuota は resource type なし（AWS 仕様上 * が必要）
          new iam.PolicyStatement({
            sid: 'AllowSESSend',
            effect: iam.Effect.ALLOW,
            actions: ['ses:SendEmail', 'ses:SendRawEmail'],
            resources: [
              `arn:aws:ses:${region}:${accountId}:identity/e-gravity.co.jp`,
            ],
          }),
          new iam.PolicyStatement({
            sid: 'AllowSESQuota',
            effect: iam.Effect.ALLOW,
            actions: ['ses:GetSendQuota'],
            resources: ['*'],
          }),
          // EventBridge: このプロジェクトのイベントバスのみ
          new iam.PolicyStatement({
            sid: 'AllowEventBridge',
            effect: iam.Effect.ALLOW,
            actions: ['events:PutEvents'],
            resources: [
              `arn:aws:events:${region}:${accountId}:event-bus/contract-renewal-*`,
            ],
          }),
          // Secrets Manager: このプロジェクトのシークレットのみ（Round 4b 以降: Graph API 認証）
          new iam.PolicyStatement({
            sid: 'AllowSecretsManager',
            effect: iam.Effect.ALLOW,
            actions: [
              'secretsmanager:GetSecretValue',
              'secretsmanager:DescribeSecret',
            ],
            resources: [
              `arn:aws:secretsmanager:${region}:${accountId}:secret:contract-renewal-*`,
            ],
          }),
          // X-Ray: リソースレベル制限なし（X-Ray の仕様上 * が必要）
          new iam.PolicyStatement({
            sid: 'AllowXRay',
            effect: iam.Effect.ALLOW,
            actions: [
              'xray:PutTraceSegments',
              'xray:PutTelemetryRecords',
              'xray:GetSamplingRules',
              'xray:GetSamplingTargets',
            ],
            resources: ['*'],
          }),
        ],
      },
    );

    // このスタック内のすべての IAM ロールへ境界を適用
    cdk.Aspects.of(this).add(
      new PermissionsBoundaryAspect(permissionsBoundary.managedPolicyArn),
    );

    // =========================================================
    // 2. DynamoDB: 現在状態テーブル
    //
    //    PK: subjectId（SHA-256(company#name#periodStart) で生成）
    //    SK: なし（対象者 × 契約期間で 1 レコード）
    //
    //    GSI 設計:
    //      gsi1-quarter-name    … 四半期別一覧・名前ソート（ops console 画面）
    //      gsi2-token           … URL トークンによる本人応答受付（スパース）
    //      gsi3-datatype-periodend … 契約終了日範囲検索（候補抽出、週次同期）
    // =========================================================
    const currentStateTable = new dynamodb.Table(this, 'CurrentStateTable', {
      tableName: 'contract-renewal-current-state',
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: 'subjectId', type: dynamodb.AttributeType.STRING },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    currentStateTable.addGlobalSecondaryIndex({
      indexName: 'gsi1-quarter-name',
      partitionKey: { name: 'quarter', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'name', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    currentStateTable.addGlobalSecondaryIndex({
      indexName: 'gsi2-token',
      partitionKey: { name: 'token', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.INCLUDE,
      nonKeyAttributes: ['subjectId', 'periodEnd', 'responseType', 'respondedAt'],
    });

    currentStateTable.addGlobalSecondaryIndex({
      indexName: 'gsi3-datatype-periodend',
      partitionKey: { name: 'dataType', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'periodEnd', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.INCLUDE,
      nonKeyAttributes: [
        'subjectId',
        'name',
        'company',
        'quarter',
        'contractType',
        'sentAt',
        'responseType',
        'opsConsentResult',
        'emergencyStop',
      ],
    });

    // =========================================================
    // 3. DynamoDB: 監査ログテーブル（追記専用）
    //
    //    PK: subjectId
    //    SK: eventId = "{ISO_TIMESTAMP}#{UUID_v4}"
    //
    //    GSI 設計:
    //      gsi1-quarter-time … 四半期別・時刻順エクスポート
    // =========================================================
    const auditLogTable = new dynamodb.Table(this, 'AuditLogTable', {
      tableName: 'contract-renewal-audit-log',
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: 'subjectId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'eventId', type: dynamodb.AttributeType.STRING },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    auditLogTable.addGlobalSecondaryIndex({
      indexName: 'gsi1-quarter-time',
      partitionKey: { name: 'quarter', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // =========================================================
    // 4. S3: フロントエンド静的アセットバケット
    //    CloudFront OAC 経由のみアクセス可（パブリックアクセス全ブロック）
    // =========================================================
    const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: `contract-renewal-frontend-${accountId}-${region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // =========================================================
    // 5. S3: 週次同期データバケット
    //    Excel台帳（仮名化済み）・合成テストファイルの格納先
    //    Lambda が GetObject でのみ読み取る
    // =========================================================
    const syncDataBucket = new s3.Bucket(this, 'SyncDataBucket', {
      bucketName: `contract-renewal-sync-data-${accountId}-${region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // =========================================================
    // 6. Secrets Manager: Graph API 認証情報プレースホルダー
    //    Entra ID アプリ登録完了後、管理者が手動で値を入力する
    //    Round 4b 以降（SharePoint モード実装時）に Lambda から参照
    // =========================================================
    const graphApiSecret = new secretsmanager.Secret(this, 'GraphApiSecret', {
      secretName: 'contract-renewal-graph-api',
      description:
        'Entra IDアプリ認証情報（SharePoint Graph API用）。' +
        'Entra IDアプリ登録完了後に tenantId / clientId / clientSecret を手動入力すること。',
      secretStringValue: cdk.SecretValue.unsafePlainText(
        JSON.stringify({ tenantId: '', clientId: '', clientSecret: '' }),
      ),
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // =========================================================
    // 7. SNS: アラート通知トピック
    //    CloudWatch Alarm → SNS → （将来: メール/Slack）
    // =========================================================
    const alertsTopic = new sns.Topic(this, 'AlertsTopic', {
      topicName: 'contract-renewal-alerts',
      displayName: '契約更新システム アラート通知',
    });

    // =========================================================
    // 8. Lambda: 週次同期
    //    Excel台帳を取得・解析して DynamoDB へ候補レコードを書き込む
    //    ローカルバンドリング（pip install + ファイルコピー）で ZIP を生成
    // =========================================================
    const syncLambdaRole = new iam.Role(this, 'SyncLambdaRole', {
      roleName: 'contract-renewal-sync-lambda-role',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Weekly sync Lambda execution role (permissions boundary applied)',
    });

    syncLambdaRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CloudWatchLogs',
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
        ],
        resources: [
          `arn:aws:logs:${region}:${accountId}:log-group:/aws/lambda/contract-renewal-*`,
          `arn:aws:logs:${region}:${accountId}:log-group:/aws/lambda/contract-renewal-*:*`,
        ],
      }),
    );

    currentStateTable.grantReadWriteData(syncLambdaRole);
    auditLogTable.grantWriteData(syncLambdaRole);
    syncDataBucket.grantRead(syncLambdaRole);
    graphApiSecret.grantRead(syncLambdaRole);

    const syncLogGroup = new logs.LogGroup(this, 'SyncLambdaLogGroup', {
      logGroupName: '/aws/lambda/contract-renewal-sync',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const syncLambda = new lambda.Function(this, 'SyncLambda', {
      functionName: 'contract-renewal-sync',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.lambda_handler',
      role: syncLambdaRole,
      logGroup: syncLogGroup,
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../backend/sync'),
        {
          bundling: {
            image: lambda.Runtime.PYTHON_3_12.bundlingImage,
            // scripts/config/ を Docker コンテナ内にマウント（Docker フォールバック用）
            volumes: [
              {
                hostPath: path.join(__dirname, '../../scripts/config'),
                containerPath: '/scripts-config',
              },
            ],
            // ローカルバンドリング: Docker 不要（ホストの pip を使用）
            local: {
              tryBundle(outputDir: string, _options: cdk.BundlingOptions): boolean {
                try {
                  const srcDir = path.join(__dirname, '../../backend/sync');
                  // scripts/config/ledger_mapping.json が唯一の正本（二重管理解消）
                  const configSrc = path.join(__dirname, '../../scripts/config/ledger_mapping.json');
                  execSync(
                    `python -m pip install -r requirements.txt -t "${outputDir}" --quiet`,
                    { cwd: srcDir, stdio: 'inherit' },
                  );
                  // config/ ディレクトリは別途 scripts/config/ からコピーするためスキップ
                  const skip = new Set([
                    'requirements.txt',
                    '__pycache__',
                    'node_modules',
                    '.venv',
                    'config',
                  ]);
                  for (const item of fs.readdirSync(srcDir)) {
                    if (skip.has(item) || item.endsWith('.pyc')) continue;
                    const src = path.join(srcDir, item);
                    const dest = path.join(outputDir, item);
                    if (fs.statSync(src).isDirectory()) {
                      fs.cpSync(src, dest, { recursive: true });
                    } else {
                      fs.copyFileSync(src, dest);
                    }
                  }
                  // 正本（scripts/config/）から config/ledger_mapping.json をコピー
                  fs.mkdirSync(path.join(outputDir, 'config'), { recursive: true });
                  fs.copyFileSync(configSrc, path.join(outputDir, 'config', 'ledger_mapping.json'));
                  return true;
                } catch (e) {
                  console.error('ローカルバンドリング失敗（Docker にフォールバック）:', e);
                  return false;
                }
              },
            },
            // Docker フォールバック（pip が PATH にない場合）
            // /scripts-config/ は volumes で scripts/config/ をマウントしたもの（正本）
            command: [
              'bash',
              '-c',
              [
                'pip install -r /asset-input/requirements.txt -t /asset-output --quiet',
                'cp -r /asset-input/. /asset-output/',
                'rm -rf /asset-output/config',
                'mkdir -p /asset-output/config',
                'cp /scripts-config/ledger_mapping.json /asset-output/config/',
                'find /asset-output -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null; true',
              ].join(' && '),
            ],
          },
        },
      ),
      memorySize: 512,
      timeout: cdk.Duration.minutes(5),
      environment: {
        CURRENT_STATE_TABLE: currentStateTable.tableName,
        AUDIT_LOG_TABLE: auditLogTable.tableName,
        EXCEL_SOURCE: 'SHAREPOINT',
        // S3 モードへの切り替え: EXCEL_SOURCE を 'S3' に変更し EXCEL_BUCKET/EXCEL_KEY を参照する
        EXCEL_BUCKET: syncDataBucket.bucketName,
        EXCEL_KEY: 'test-data/synthetic.xlsx',
        GRAPH_API_SECRET_NAME: graphApiSecret.secretName,
        // SharePoint 接続設定（EXCEL_SOURCE=SHAREPOINT 時に参照）
        SHAREPOINT_SITE_HOST: 'gravityoffice365.sharepoint.com',
        SHAREPOINT_SITE_PATH: '/sites/01_',
        // SHAREPOINT_ITEM_GUID: SharePoint でファイルを開いた URL の sourcedoc パラメータ（{} なし）
        // 変更時: このGUIDを更新して cdk deploy する（パス・ファイル名変更では不要）
        SHAREPOINT_ITEM_GUID: '438071B4-9178-4A3F-A9D2-28F285C9FE1C',
        // チームCSV キー: S3 上の team-data/team.csv が存在する週のみ team フィールドを更新
        // ファイルが存在しない週は更新をスキップし、既存 team 値を維持する
        TEAM_CSV_KEY: 'team-data/team.csv',
      },
      description: '週次同期Lambda — Excel台帳を取得・解析し DynamoDB に候補レコードを書き込む',
    });

    // =========================================================
    // 9. EventBridge: 週次実行スケジュール
    //    毎週月曜 07:00 JST (= 日曜 22:00 UTC) に Lambda を起動
    // =========================================================
    new events.Rule(this, 'WeeklySyncRule', {
      ruleName: 'contract-renewal-weekly-sync',
      description: '週次同期Lambda トリガー（月曜 07:00 JST）',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '22',
        weekDay: 'SUN',
        month: '*',
        year: '*',
      }),
      targets: [new eventsTargets.LambdaFunction(syncLambda)],
      enabled: true,
    });

    // =========================================================
    // 10. CloudWatch: Lambda エラー検知アラーム
    //     Lambda 実行エラーが 1 件以上発生したら SNS へ通知
    //     本格的なアラート設計（複数ジョブ横断・DLQ）は Round 10 で実施
    // =========================================================
    const syncErrorAlarm = new cloudwatch.Alarm(this, 'SyncErrorAlarm', {
      alarmName: 'contract-renewal-sync-errors',
      alarmDescription: '週次同期Lambda エラー検知（1件以上でアラート）',
      metric: syncLambda.metricErrors({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    syncErrorAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertsTopic));

    // =========================================================
    // 11. API Gateway HTTP API（スタブ）
    //     Round 5 以降でルート・Lambda 統合を追加する
    // =========================================================
    const httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', {
      apiName: 'contract-renewal-api',
      description:
        '契約更新 本人意思確認システム API（Round 5 以降でルート実装予定）',
      corsPreflight: {
        allowOrigins: ['https://d2ule3xvskr65i.cloudfront.net'],
        allowMethods: [apigatewayv2.CorsHttpMethod.ANY],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // =========================================================
    // 11b. JWT Authorizer（Round 5）
    //      ops-console からの API 呼び出しを Entra ID JWT で検証する
    //      Tenant: gravityoffice365.onmicrosoft.com
    //      Audience: d016064a-7092-43b9-966d-13af53f3d3b8
    //      (accessTokenAcceptedVersion=2 のため aud は GUID 形式で発行される)
    // =========================================================
    const jwtAuthorizer = new apigatewayv2.CfnAuthorizer(this, 'JwtAuthorizer', {
      apiId: httpApi.apiId,
      authorizerType: 'JWT',
      name: 'MsalJwtAuthorizer',
      identitySource: ['$request.header.Authorization'],
      jwtConfiguration: {
        audience: ['d016064a-7092-43b9-966d-13af53f3d3b8'],
        issuer:
          'https://login.microsoftonline.com/90d75b8f-615b-463e-9492-5cb3672bad9e/v2.0',
      },
    });

    // =========================================================
    // 11c. Ops Lambda（Round 5: 営業事務向け API）
    //      GET  /api/candidates
    //      PATCH /api/candidates/{subjectId}/consent
    //      PATCH /api/candidates/{subjectId}/emergency-stop
    //      PATCH /api/candidates/{subjectId}/memo
    //      PATCH /api/candidates/{subjectId}/acknowledge
    // =========================================================
    const opsLambdaRole = new iam.Role(this, 'OpsLambdaRole', {
      roleName: 'contract-renewal-ops-lambda-role',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Ops API Lambda execution role (permissions boundary applied)',
    });

    opsLambdaRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'CloudWatchLogs',
        actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [
          `arn:aws:logs:${region}:${accountId}:log-group:/aws/lambda/contract-renewal-*`,
          `arn:aws:logs:${region}:${accountId}:log-group:/aws/lambda/contract-renewal-*:*`,
        ],
      }),
    );

    currentStateTable.grantReadWriteData(opsLambdaRole);
    auditLogTable.grantWriteData(opsLambdaRole);

    const opsEnv: Record<string, string> = {
      CURRENT_STATE_TABLE: currentStateTable.tableName,
      AUDIT_LOG_TABLE: auditLogTable.tableName,
    };

    const addOpsRoute = (
      id: string,
      routeKey: string,
      entryFile: string,
    ): lambda.Function => {
      const slug =
        id.charAt(0).toLowerCase() +
        id
          .slice(1)
          .replace(/([A-Z])/g, '-$1')
          .toLowerCase();

      const logGroup = new logs.LogGroup(this, `${id}LogGroup`, {
        logGroupName: `/aws/lambda/contract-renewal-ops-${slug}`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      const opsSrcDir = path.join(__dirname, '../../backend/ops');
      const infraDir = path.join(__dirname, '..');

      const fn = new lambda.Function(this, `${id}Fn`, {
        functionName: `contract-renewal-ops-${slug}`,
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: 'index.handler',
        role: opsLambdaRole,
        logGroup,
        environment: opsEnv,
        timeout: cdk.Duration.seconds(30),
        memorySize: 256,
        code: lambda.Code.fromAsset(opsSrcDir, {
          bundling: {
            image: lambda.Runtime.NODEJS_22_X.bundlingImage,
            local: {
              tryBundle(outputDir: string): boolean {
                try {
                  execSync(
                    [
                      `npx esbuild`,
                      `"${path.join(opsSrcDir, entryFile)}"`,
                      `--bundle`,
                      `--target=node22`,
                      `--platform=node`,
                      `"--outfile=${path.join(outputDir, 'index.js')}"`,
                      `--external:@aws-sdk/*`,
                    ].join(' '),
                    { cwd: infraDir, stdio: 'inherit' },
                  );
                  return true;
                } catch (e) {
                  console.error(`バンドリング失敗 (${entryFile}):`, e);
                  return false;
                }
              },
            },
            command: [
              'bash',
              '-c',
              `npx esbuild /asset-input/${entryFile} --bundle --target=node22 --platform=node --outfile=/asset-output/index.js "--external:@aws-sdk/*"`,
            ],
          },
        }),
        description: `契約更新 ops API — ${routeKey}`,
      });

      fn.addPermission(`${id}ApiGwPerm`, {
        principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
        sourceArn: `arn:aws:execute-api:${region}:${accountId}:${httpApi.apiId}/*/*`,
      });

      const integration = new apigatewayv2.CfnIntegration(this, `${id}Integration`, {
        apiId: httpApi.apiId,
        integrationType: 'AWS_PROXY',
        integrationUri: fn.functionArn,
        payloadFormatVersion: '2.0',
      });

      new apigatewayv2.CfnRoute(this, `${id}Route`, {
        apiId: httpApi.apiId,
        routeKey,
        authorizationType: 'JWT',
        authorizerId: jwtAuthorizer.ref,
        target: `integrations/${integration.ref}`,
      });

      return fn;
    };

    addOpsRoute('GetCandidates', 'GET /api/candidates', 'getCandidates.ts');
    addOpsRoute(
      'PatchConsent',
      'PATCH /api/candidates/{subjectId}/consent',
      'patchConsent.ts',
    );
    addOpsRoute(
      'PatchEmergencyStop',
      'PATCH /api/candidates/{subjectId}/emergency-stop',
      'patchEmergencyStop.ts',
    );
    addOpsRoute('PatchMemo', 'PATCH /api/candidates/{subjectId}/memo', 'patchMemo.ts');
    addOpsRoute(
      'PatchAcknowledge',
      'PATCH /api/candidates/{subjectId}/acknowledge',
      'patchAcknowledge.ts',
    );

    // =========================================================
    // 12. CloudFront ディストリビューション
    //     /* → S3（静的アセット）
    //     /api/* → API Gateway HTTP API
    // =========================================================
    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(
      frontendBucket,
    );

    const apiOrigin = new origins.HttpOrigin(
      `${httpApi.apiId}.execute-api.${region}.amazonaws.com`,
      { protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY },
    );

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: '契約更新 本人意思確認システム',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy:
          cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      },
      additionalBehaviors: {
        '/api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
      ],
    });

    // BucketDeploymentによるCloudFrontキャッシュ無効化を許可
    // distributionが確定した後でaddStatementsを呼ぶことで、ARNにdistributionIdを埋め込める
    permissionsBoundary.addStatements(
      new iam.PolicyStatement({
        sid: 'AllowCloudFrontInvalidation',
        effect: iam.Effect.ALLOW,
        actions: ['cloudfront:CreateInvalidation'],
        resources: [`arn:aws:cloudfront::${accountId}:distribution/${distribution.distributionId}`],
      })
    );

    // =========================================================
    // 13. フロントエンドアセットのS3デプロイ（IaC化）
    //     cdk deploy で frontend/ 配下を S3 へ同期し、
    //     CloudFront キャッシュを自動無効化する。
    // =========================================================
    new s3deploy.BucketDeployment(this, 'FrontendDeployment', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../frontend'))],
      destinationBucket: frontendBucket,
      distribution: distribution,
      distributionPaths: ['/*'],
      prune: true,
    });

    // =========================================================
    // 14. スタック出力
    // =========================================================
    new cdk.CfnOutput(this, 'CloudFrontURL', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'CloudFront URL',
    });

    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: httpApi.url ?? '（ステージ URL 未確定）',
      description: 'API Gateway Endpoint（stub）',
    });

    new cdk.CfnOutput(this, 'FrontendBucketName', {
      value: frontendBucket.bucketName,
      description: 'Frontend S3 Bucket Name',
    });

    new cdk.CfnOutput(this, 'SyncDataBucketName', {
      value: syncDataBucket.bucketName,
      description: '週次同期データ S3 Bucket Name',
    });

    new cdk.CfnOutput(this, 'CurrentStateTableName', {
      value: currentStateTable.tableName,
      description: 'DynamoDB 現在状態テーブル',
    });

    new cdk.CfnOutput(this, 'AuditLogTableName', {
      value: auditLogTable.tableName,
      description: 'DynamoDB 監査ログテーブル',
    });

    new cdk.CfnOutput(this, 'SyncLambdaName', {
      value: syncLambda.functionName,
      description: '週次同期 Lambda 関数名',
    });

    new cdk.CfnOutput(this, 'AlertsTopicArn', {
      value: alertsTopic.topicArn,
      description: 'アラート通知 SNS Topic ARN',
    });

    new cdk.CfnOutput(this, 'GraphApiSecretArn', {
      value: graphApiSecret.secretArn,
      description: 'Graph API 認証情報 Secrets Manager ARN（Entra ID 登録後に手動入力）',
    });

    new cdk.CfnOutput(this, 'PermissionsBoundaryArn', {
      value: permissionsBoundary.managedPolicyArn,
      description: 'IAM Permissions Boundary ARN',
    });
  }
}
