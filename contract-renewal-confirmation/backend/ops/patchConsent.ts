import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { writeAuditLog } from './shared/audit';
import type { ConsentResult } from './shared/status';

const CURRENT_STATE_TABLE = process.env.CURRENT_STATE_TABLE!;
const AUDIT_LOG_TABLE = process.env.AUDIT_LOG_TABLE!;

const ddbClient = new DynamoDBClient({
  region: process.env.AWS_REGION ?? 'ap-northeast-1',
});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const VALID_RESULTS = new Set(['consent', 'pending', 'no_renewal', null]);

function getActor(event: APIGatewayProxyEventV2): string {
  const claims =
    event.requestContext.authorizer?.jwt?.claims as Record<string, string> | undefined;
  return (
    claims?.['preferred_username'] ??
    claims?.['unique_name'] ??
    claims?.['upn'] ??
    claims?.['oid'] ??
    'unknown'
  );
}

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const subjectId = event.pathParameters?.['subjectId'];
  if (!subjectId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'subjectId is required' }),
    };
  }

  let body: { result?: unknown };
  try {
    body = JSON.parse(event.body ?? '{}') as { result?: unknown };
  } catch {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Invalid JSON body' }),
    };
  }

  const result = Object.prototype.hasOwnProperty.call(body, 'result')
    ? body.result
    : '__missing__';

  if (result === '__missing__' || !VALID_RESULTS.has(result as ConsentResult)) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'result must be "consent", "pending", "no_renewal", or null',
      }),
    };
  }

  const consentResult = result as ConsentResult;

  try {
    const existing = await docClient.send(
      new GetCommand({
        TableName: CURRENT_STATE_TABLE,
        Key: { subjectId },
      }),
    );

    if (!existing.Item) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Candidate not found' }),
      };
    }

    const quarter = existing.Item['quarter'] as string;
    const prevResult = (existing.Item['opsConsentResult'] as ConsentResult | undefined) ?? null;
    const now = new Date().toISOString();
    const actor = getActor(event);
    const valueChanged = consentResult !== prevResult;

    if (consentResult !== null) {
      await docClient.send(
        new UpdateCommand({
          TableName: CURRENT_STATE_TABLE,
          Key: { subjectId },
          UpdateExpression: valueChanged
            ? 'SET opsConsentResult = :r, opsConsentSource = :src, updatedAt = :now REMOVE acknowledgedAt'
            : 'SET opsConsentResult = :r, opsConsentSource = :src, updatedAt = :now',
          ExpressionAttributeValues: {
            ':r': consentResult,
            ':src': 'OPS',
            ':now': now,
          },
        }),
      );
    } else {
      // null = 未選択に戻す: opsConsentResult・opsConsentSource を削除
      await docClient.send(
        new UpdateCommand({
          TableName: CURRENT_STATE_TABLE,
          Key: { subjectId },
          UpdateExpression: valueChanged
            ? 'SET updatedAt = :now REMOVE opsConsentResult, opsConsentSource, acknowledgedAt'
            : 'SET updatedAt = :now REMOVE opsConsentResult, opsConsentSource',
          ExpressionAttributeValues: { ':now': now },
        }),
      );
    }

    await writeAuditLog({
      tableName: AUDIT_LOG_TABLE,
      subjectId,
      quarter,
      eventType: 'CONSENT_UPDATED',
      actor,
      detail: { prev: prevResult, next: consentResult },
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subjectId, opsConsentResult: consentResult }),
    };
  } catch (err) {
    console.error('PATCH /consent error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Internal server error' }),
    };
  }
};
