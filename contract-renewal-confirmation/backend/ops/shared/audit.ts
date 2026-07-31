import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const ddbClient = new DynamoDBClient({
  region: process.env.AWS_REGION ?? 'ap-northeast-1',
});
const docClient = DynamoDBDocumentClient.from(ddbClient);

export type AuditEventType =
  | 'CONSENT_UPDATED'
  | 'EMERGENCY_STOP_ON'
  | 'EMERGENCY_STOP_OFF'
  | 'MEMO_UPDATED'
  | 'ACKNOWLEDGED';

export async function writeAuditLog(params: {
  tableName: string;
  subjectId: string;
  quarter: string;
  eventType: AuditEventType;
  actor: string;
  detail: Record<string, unknown>;
}): Promise<void> {
  const now = new Date().toISOString();
  const eventId = `${now}#${randomUUID()}`;

  await docClient.send(
    new PutCommand({
      TableName: params.tableName,
      Item: {
        subjectId: params.subjectId,
        eventId,
        quarter: params.quarter,
        eventType: params.eventType,
        actor: params.actor,
        timestamp: now,
        detail: params.detail,
      },
    }),
  );
}
