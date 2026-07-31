import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { writeAuditLog } from './shared/audit';

const CURRENT_STATE_TABLE = process.env.CURRENT_STATE_TABLE!;
const AUDIT_LOG_TABLE = process.env.AUDIT_LOG_TABLE!;

const ddbClient = new DynamoDBClient({
  region: process.env.AWS_REGION ?? 'ap-northeast-1',
});
const docClient = DynamoDBDocumentClient.from(ddbClient);

function getActor(event: APIGatewayProxyEventV2): string {
  const claims =
    event.requestContext.authorizer?.jwt?.claims as Record<string, string> | undefined;
  return (
    claims?.['preferred_username'] ??
    claims?.['unique_name'] ??
    claims?.['upn'] ??
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
    const now = new Date().toISOString();
    const actor = getActor(event);

    const acknowledgedAt = { at: now, by: actor };

    await docClient.send(
      new UpdateCommand({
        TableName: CURRENT_STATE_TABLE,
        Key: { subjectId },
        UpdateExpression: 'SET acknowledgedAt = :a, updatedAt = :now',
        ExpressionAttributeValues: {
          ':a': acknowledgedAt,
          ':now': now,
        },
      }),
    );

    await writeAuditLog({
      tableName: AUDIT_LOG_TABLE,
      subjectId,
      quarter,
      eventType: 'ACKNOWLEDGED',
      actor,
      detail: { acknowledgedAt },
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subjectId, acknowledgedAt }),
    };
  } catch (err) {
    console.error('PATCH /acknowledge error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Internal server error' }),
    };
  }
};
