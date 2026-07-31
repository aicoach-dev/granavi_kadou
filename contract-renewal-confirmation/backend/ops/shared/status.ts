export type ConsentResult = 'consent' | 'pending' | 'no_renewal' | null;
export type ResponseType = 'consent' | 'consult' | null;

export type Status =
  | 'NOT_SENT'        // 未送信
  | 'NO_RESPONSE'     // 未回答
  | 'WANTS_CONSULT'   // 相談したい
  | 'ESCALATED'       // エスカレーション対応中
  | 'CONSENTED'       // 本人承諾
  | 'NO_RENEWAL'      // 更新しない
  | 'PERIOD_REACHED'; // 無反応のまま契約開始日到達

export type ConsentSource = 'ONLINE' | 'OPS' | 'EXCEL_SYNC';

export interface StatusResult {
  status: Status;
  consentSource?: ConsentSource;
  reachedSubtype?: 'no_contact' | 'pending_at_reached';
}

export interface CandidateStatusFields {
  sentAt?: string | null;
  responseType?: ResponseType;
  opsConsentResult?: ConsentResult;
  opsConsentSource?: string | null;
  escalatedAt?: string | null;
  periodStart: string;
}

/**
 * DynamoDB のフィールド群からステータスを純粋関数として導出する。
 * ステータスは DB に保存せず、参照時に都度計算する。
 *
 * 優先順位（上位が下位を上書き）:
 *   1. opsConsentResult === 'consent'  → 本人承諾（個別確認 or Excel同期）
 *   2. opsConsentResult === 'no_renewal' → 更新しない
 *   3. responseType === 'consent'      → 本人承諾（オンライン）
 *   4. today >= periodStart            → 無反応のまま契約開始日到達（未送信・相談中含む）
 *   5. responseType === 'consult'      → 相談したい（契約開始日未到達の場合のみ）
 *   6. !sentAt                         → 未送信
 *   7. escalatedAt が設定済み          → エスカレーション対応中
 *   8. それ以外                         → 未回答
 *
 * 注意: 「保留」(opsConsentResult === 'pending') は表示ステータスを変えない。
 *       自動通知の停止条件にはなるが、ステータス7種には含まれない。
 * 注意: PERIOD_REACHED の reachedSubtype は
 *       opsConsentResult === 'pending' または responseType === 'consult' の場合は
 *       'pending_at_reached'（未定のまま到達）、それ以外は 'no_contact'（接触できず）。
 */
export function deriveStatus(
  fields: CandidateStatusFields,
  today: Date = new Date(),
): StatusResult {
  const {
    sentAt,
    responseType,
    opsConsentResult,
    opsConsentSource,
    escalatedAt,
    periodStart,
  } = fields;

  if (opsConsentResult === 'consent') {
    return {
      status: 'CONSENTED',
      consentSource: opsConsentSource === 'EXCEL_SYNC' ? 'EXCEL_SYNC' : 'OPS',
    };
  }

  if (opsConsentResult === 'no_renewal') {
    return { status: 'NO_RENEWAL' };
  }

  if (responseType === 'consent') {
    return { status: 'CONSENTED', consentSource: 'ONLINE' };
  }

  const periodStartDate = new Date(periodStart);
  if (today >= periodStartDate) {
    return {
      status: 'PERIOD_REACHED',
      reachedSubtype:
        opsConsentResult === 'pending' || responseType === 'consult'
          ? 'pending_at_reached'
          : 'no_contact',
    };
  }

  if (responseType === 'consult') {
    return { status: 'WANTS_CONSULT' };
  }

  if (!sentAt) {
    return { status: 'NOT_SENT' };
  }

  if (escalatedAt) {
    return { status: 'ESCALATED' };
  }

  return { status: 'NO_RESPONSE' };
}
