import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { deriveStatus } from './shared/status';
import type { ConsentResult, ResponseType } from './shared/status';

const CURRENT_STATE_TABLE = process.env.CURRENT_STATE_TABLE!;

const ddbClient = new DynamoDBClient({
  region: process.env.AWS_REGION ?? 'ap-northeast-1',
});
const docClient = DynamoDBDocumentClient.from(ddbClient);

function mapItem(item: Record<string, unknown>, today: Date) {
  const statusResult = deriveStatus(
    {
      sentAt: (item['sentAt'] as string | null | undefined) ?? null,
      responseType: (item['responseType'] as ResponseType | undefined) ?? null,
      opsConsentResult: (item['opsConsentResult'] as ConsentResult | undefined) ?? null,
      opsConsentSource: (item['opsConsentSource'] as string | null | undefined) ?? null,
      escalatedAt: (item['escalatedAt'] as string | null | undefined) ?? null,
      periodStart: item['periodStart'] as string,
    },
    today,
  );

  return {
    subjectId: item['subjectId'] as string,
    quarter: item['quarter'] as string,
    name: item['name'] as string,
    company: item['company'] as string,
    team: (item['team'] as string | null | undefined) ?? null,
    contractType: item['contractType'] as string,
    periodStart: item['periodStart'] as string,
    periodEnd: item['periodEnd'] as string,
    sentAt: (item['sentAt'] as string | null | undefined) ?? null,
    responseType: (item['responseType'] as string | null | undefined) ?? null,
    respondedAt: (item['respondedAt'] as string | null | undefined) ?? null,
    opsConsentResult: (item['opsConsentResult'] as string | null | undefined) ?? null,
    opsMemo: (item['opsMemo'] as string | null | undefined) ?? null,
    acknowledgedAt:
      (item['acknowledgedAt'] as Record<string, string> | null | undefined) ?? null,
    emergencyStopped:
      (item['emergencyStopped'] as Record<string, unknown> | null | undefined) ?? null,
    escalatedAt: (item['escalatedAt'] as string | null | undefined) ?? null,
    status: statusResult.status,
    consentSource: statusResult.consentSource ?? null,
    reachedSubtype: statusResult.reachedSubtype ?? null,
    syncedAt: item['syncedAt'] as string,
    updatedAt: item['updatedAt'] as string,
  };
}

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const quarter = event.queryStringParameters?.['quarter'] ?? null;
    const today = new Date();
    let rawItems: Record<string, unknown>[] = [];

    if (quarter) {
      // 四半期指定: GSI1（gsi1-quarter-name）クエリ
      const result = await docClient.send(
        new QueryCommand({
          TableName: CURRENT_STATE_TABLE,
          IndexName: 'gsi1-quarter-name',
          KeyConditionExpression: 'quarter = :q',
          ExpressionAttributeValues: { ':q': quarter },
        }),
      );
      rawItems = (result.Items ?? []) as Record<string, unknown>[];
      // Scan と同じソート順を適用（ICU既定のHan照合順。localeCompare('ja')は読み仮名を考慮しないため五十音順にはならない）
      rawItems.sort((a, b) =>
        ((a['name'] as string) ?? '').localeCompare(
          (b['name'] as string) ?? '',
          'ja',
        ),
      );
    } else {
      // 四半期未指定: 全件スキャン（LastEvaluatedKey ループ）
      let lastKey: Record<string, unknown> | undefined;
      do {
        const result = await docClient.send(
          new ScanCommand({
            TableName: CURRENT_STATE_TABLE,
            ExclusiveStartKey: lastKey,
          }),
        );
        rawItems.push(...((result.Items ?? []) as Record<string, unknown>[]));
        lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (lastKey !== undefined);

      // 四半期（昇順）→ 名前（昇順）でソート（ICU既定のHan照合順。読み仮名順ではない）
      rawItems.sort((a, b) => {
        const qA = (a['quarter'] as string) ?? '';
        const qB = (b['quarter'] as string) ?? '';
        if (qA !== qB) return qA.localeCompare(qB);
        return ((a['name'] as string) ?? '').localeCompare(
          (b['name'] as string) ?? '',
          'ja',
        );
      });
    }

    const items = rawItems.map((item) => mapItem(item, today));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quarter, items }),
    };
  } catch (err) {
    console.error('GET /api/candidates error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Internal server error' }),
    };
  }
};
