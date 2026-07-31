import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { deriveStatus } from './shared/status';

const CURRENT_STATE_TABLE = process.env.CURRENT_STATE_TABLE!;

const ddbClient = new DynamoDBClient({
  region: process.env.AWS_REGION ?? 'ap-northeast-1',
});
const docClient = DynamoDBDocumentClient.from(ddbClient);

/** 現在日時から四半期文字列（例: 2026Q3）を返す */
function currentQuarter(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  let q: number;
  if (month >= 4 && month <= 6) q = 2;
  else if (month >= 7 && month <= 9) q = 3;
  else if (month >= 10 && month <= 12) q = 4;
  else q = 1;
  const fiscalYear = month >= 4 ? year : year - 1;
  return `${fiscalYear}Q${q}`;
}

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const quarter =
      event.queryStringParameters?.['quarter'] ?? currentQuarter();

    const result = await docClient.send(
      new QueryCommand({
        TableName: CURRENT_STATE_TABLE,
        IndexName: 'gsi1-quarter-name',
        KeyConditionExpression: 'quarter = :q',
        ExpressionAttributeValues: { ':q': quarter },
      }),
    );

    const today = new Date();
    const items = (result.Items ?? []).map((item) => {
      const statusResult = deriveStatus(
        {
          sentAt: item['sentAt'] ?? null,
          responseType: item['responseType'] ?? null,
          opsConsentResult: item['opsConsentResult'] ?? null,
          opsConsentSource: item['opsConsentSource'] ?? null,
          escalatedAt: item['escalatedAt'] ?? null,
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
        opsConsentResult:
          (item['opsConsentResult'] as string | null | undefined) ?? null,
        opsMemo: (item['opsMemo'] as string | null | undefined) ?? null,
        acknowledgedAt:
          (item['acknowledgedAt'] as Record<string, string> | null | undefined) ?? null,
        emergencyStopped:
          (item['emergencyStopped'] as Record<string, unknown> | null | undefined) ??
          null,
        escalatedAt: (item['escalatedAt'] as string | null | undefined) ?? null,
        status: statusResult.status,
        consentSource: statusResult.consentSource ?? null,
        reachedSubtype: statusResult.reachedSubtype ?? null,
        syncedAt: item['syncedAt'] as string,
        updatedAt: item['updatedAt'] as string,
      };
    });

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
