import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct, IConstruct } from 'constructs';

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
    //
    //    主要属性（属性値の仕様は docs/requirements.md §4 参照）:
    //      quarter, name, company, contractType, periodStart, periodEnd
    //      token（スパース）, sentAt, reminderCount
    //      responseType（"consent" | "consult" | null）, respondedAt
    //      opsConsentResult（"pending" | "consent" | "declined" | null）
    //      opsConsentUpdatedAt, opsNote
    //      emergencyStop, emergencyStopAt
    //      excelConsentRaw, excelConsentSource, syncedAt
    //      dataType（固定値 "SUBJECT"、GSI3 の PK として使用）
    //      updatedAt
    // =========================================================
    const currentStateTable = new dynamodb.Table(this, 'CurrentStateTable', {
      tableName: 'contract-renewal-current-state',
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: 'subjectId', type: dynamodb.AttributeType.STRING },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // GSI1: 四半期 × 氏名 → ops console の四半期別一覧表示
    currentStateTable.addGlobalSecondaryIndex({
      indexName: 'gsi1-quarter-name',
      partitionKey: { name: 'quarter', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'name', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI2: token → 本人向け URL の回答受付（token が存在する行のみのスパース GSI）
    currentStateTable.addGlobalSecondaryIndex({
      indexName: 'gsi2-token',
      partitionKey: { name: 'token', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.INCLUDE,
      nonKeyAttributes: ['subjectId', 'periodEnd', 'responseType', 'respondedAt'],
    });

    // GSI3: periodEnd による範囲検索 → 「契約終了 1.5 ヶ月前」候補抽出
    //       dataType は常に固定値 "SUBJECT" を書き込む
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
    //        → 時刻昇順にソートでき、同一ミリ秒でも衝突しない
    //
    //    GSI 設計:
    //      gsi1-quarter-time … 四半期別・時刻順エクスポート
    //
    //    主要属性:
    //      eventType（"EXCEL_SYNC" | "TOKEN_ISSUED" | "EMAIL_SENT" |
    //                 "REMINDER_SENT" | "ESCALATION_SENT" |
    //                 "APPLICANT_RESPONSE" | "OPS_CONSENT_RECORDED" |
    //                 "EMERGENCY_STOP" | "CLOSED" | "SYNC_CONSENT_RESOLVED"）
    //      timestamp（ISO 8601）
    //      actor（"SYSTEM" | "OPS:{microsoftUserId}" | "APPLICANT:{tokenPrefix}"）
    //      quarter（GSI1 PK）
    //      payload（JSON 文字列、イベント種別ごとの詳細）
    //      name, company（非正規化、監査コンテキストでの参照用）
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

    // GSI1: 四半期別・時刻順 → 四半期監査エクスポート
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
    // 5. API Gateway HTTP API（スタブ）
    //    Round 4 以降でルート・Lambda 統合を追加する
    //    注意: CloudFront の /api/* ビヘイビアがこの API に転送するため、
    //    Round 5 以降でルートを定義する際はパスを /api/... で定義すること
    //    （または CloudFront Function で /api プレフィクスを除去する）
    // =========================================================
    const httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', {
      apiName: 'contract-renewal-api',
      description:
        '契約更新 本人意思確認システム API（Round 5 以降でルート実装予定）',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigatewayv2.CorsHttpMethod.ANY],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // =========================================================
    // 6. CloudFront ディストリビューション
    //    /* → S3（静的アセット）
    //    /api/* → API Gateway HTTP API
    // =========================================================
    // S3 オリジン（OAC 自動生成）
    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(
      frontendBucket,
    );

    // API Gateway オリジン
    const apiOrigin = new origins.HttpOrigin(
      `${httpApi.apiId}.execute-api.${region}.amazonaws.com`,
      { protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY },
    );

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: '契約更新 本人意思確認システム',
      // PriceClass_200: 日本・アジアを含むエッジロケーションを使用
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
        // S3 の 403/404 を index.html にフォールバック（SPA ルーティング用）
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

    // =========================================================
    // 7. スタック出力
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

    new cdk.CfnOutput(this, 'CurrentStateTableName', {
      value: currentStateTable.tableName,
      description: 'DynamoDB 現在状態テーブル',
    });

    new cdk.CfnOutput(this, 'AuditLogTableName', {
      value: auditLogTable.tableName,
      description: 'DynamoDB 監査ログテーブル',
    });

    new cdk.CfnOutput(this, 'PermissionsBoundaryArn', {
      value: permissionsBoundary.managedPolicyArn,
      description: 'IAM Permissions Boundary ARN（Round 4 以降の Lambda ロールへ適用済み）',
    });
  }
}
