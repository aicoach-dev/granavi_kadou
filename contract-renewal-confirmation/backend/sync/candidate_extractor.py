"""
候補抽出ロジック — DynamoDB 現在状態テーブル・監査ログテーブルへの書き込み

主なロジック:
  1. 基準日 = 契約開始日 − 1ヶ月 − 15日 (≒ 1.5ヶ月前)
     暦月で 1ヶ月を引いた後、さらに 15日を引く。
     45日固定に比べて月の日数ゆれが少なく、「1.5ヶ月前」という業務感覚との一致度が高い。
     例: 2026-07-01 開始 → 06-01 → 05-17 が基準日。当日以降なら候補作成。
  2. 基準日を過ぎた行のみ候補レコードを作成（基準日前は次回以降の週次実行で拾われる）
  3. 委託種別は commissioning_allowlist の客先のみ対象（それ以外はデフォルト除外）
  4. subjectId が既存の行は作成しない（冪等）
  5. Excel 本人確認列が recognized な値の行は opsConsentResult='consent' をプリセット
  6. 未知の値は 'unknown:...' として記録し、通常候補として扱う（送信対象に含める）
"""
import hashlib
import json
import logging
import uuid
from calendar import monthrange
from datetime import date, datetime, timedelta, timezone

import boto3
from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)

CONTRACT_TYPE_COMMISSION = "委託"


def compute_subject_id(company: str, name: str, period_start: str) -> str:
    """subjectId = SHA-256(company#name#periodStart)"""
    content = f"{company}#{name}#{period_start}"
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def compute_quarter(period_start: str) -> str:
    """期間開始日から四半期文字列（例: '2026Q3'）を返す。"""
    d = date.fromisoformat(period_start)
    q = (d.month - 1) // 3 + 1
    return f"{d.year}Q{q}"


def compute_threshold(period_start: str) -> date:
    """
    基準日 = 契約開始日 − 1ヶ月 − 15日
    暦月で 1ヶ月を引いた後、さらに 15日を引く。
    月末日をまたぐ場合は該当月の末日に丸める（例: 3/31 → 2/28 → 2/13）。
    """
    start = date.fromisoformat(period_start)
    y, m = start.year, start.month - 1
    if m == 0:
        y, m = y - 1, 12
    max_day = monthrange(y, m)[1]
    one_month_before = date(y, m, min(start.day, max_day))
    return one_month_before - timedelta(days=15)


def is_due(period_start: str, reference_date: date | None = None) -> bool:
    """基準日を過ぎているか（今回の候補作成対象か）を判定する。"""
    ref = reference_date or date.today()
    return ref >= compute_threshold(period_start)


def is_included(record: dict, cfg: dict) -> bool:
    """
    委託種別のデフォルト除外・許可リスト判定。
    True → 候補対象, False → 対象外
    """
    ct = str(record.get("contract_type") or "").strip()
    if ct != CONTRACT_TYPE_COMMISSION:
        return True
    allowlist = cfg.get("commissioning_allowlist", {}).get("companies", [])
    return record.get("block_company", "") in allowlist


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _put_candidate(
    current_state_table,
    audit_log_table,
    state_item: dict,
    audit_items: list[dict],
) -> bool:
    """
    候補レコードを新規作成する。subjectId が既存なら何もしない（冪等）。
    Returns: True if created, False if already existed.

    注: 現在状態テーブルへの書き込み成功後に監査ログを書く2-phase設計。
    監査ログ書き込みが失敗した場合は例外が伝播し、Lambdaが失敗扱いになる。
    （DynamoDBトランザクションへの移行は将来のRoundで検討）
    """
    try:
        current_state_table.put_item(
            Item=state_item,
            ConditionExpression=Attr("subjectId").not_exists(),
        )
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return False
        raise

    for audit_item in audit_items:
        audit_log_table.put_item(Item=audit_item)
    return True


def extract_candidates(
    records: list[dict],
    cfg: dict,
    current_state_table_name: str,
    audit_log_table_name: str,
    reference_date: date | None = None,
) -> dict:
    """
    レコードリストから候補を抽出し DynamoDB へ書き込む。
    Returns: 集計辞書
    """
    dynamodb = boto3.resource("dynamodb")
    current_state_table = dynamodb.Table(current_state_table_name)
    audit_log_table = dynamodb.Table(audit_log_table_name)

    counts = {
        "total": len(records),
        "due": 0,
        "excluded_not_due": 0,
        "excluded_commission": 0,
        "created": 0,
        "created_consent_preset": 0,
        "skipped_existing": 0,
    }

    for rec in records:
        period_start = rec.get("period_start")
        period_end = rec.get("period_end")
        name = rec.get("name", "")
        company = rec.get("company", "")
        block_company = rec.get("block_company", "")
        contract_type = str(rec.get("contract_type") or "").strip()
        consent = rec.get("consent")
        consent_raw = rec.get("consent_raw")
        consent_raw_str = str(consent_raw).strip() if consent_raw is not None else ""

        # period_start が null の行（グローバルプレナーズ等）はスキップ
        if not period_start:
            logger.warning(f"period_start が null のためスキップ: {name} / {company}")
            continue

        # 基準日判定
        if not is_due(period_start, reference_date):
            counts["excluded_not_due"] += 1
            logger.debug(f"基準日前スキップ: {name} / start={period_start}")
            continue

        # 委託除外判定
        if not is_included(rec, cfg):
            counts["excluded_commission"] += 1
            logger.info(f"委託除外: {name} / {company} / block={block_company}")
            continue

        counts["due"] += 1
        subject_id = compute_subject_id(company, name, period_start)
        quarter = compute_quarter(period_start)
        now = _now_iso()

        # 現在状態テーブル アイテム
        state_item: dict = {
            "subjectId": subject_id,
            "quarter": quarter,
            "dataType": "SUBJECT",
            "name": name,
            "company": company,
            "contractType": contract_type,
            "periodStart": period_start,
            "periodEnd": period_end or "",
            "excelConsentRaw": consent_raw_str,
            "excelConsentSource": block_company,
            "syncedAt": now,
            "updatedAt": now,
        }
        # 認識済み本人確認値（confirmed）をプリセット（2026-07-28決定）
        if consent == "confirmed":
            state_item["opsConsentResult"] = "consent"
            state_item["opsConsentSource"] = "EXCEL_SYNC"

        # 監査ログ — EXCEL_SYNC（全候補に記録）
        audit_items: list[dict] = [
            {
                "subjectId": subject_id,
                "eventId": f"{now}#{uuid.uuid4()}",
                "eventType": "EXCEL_SYNC",
                "timestamp": now,
                "actor": "SYSTEM",
                "quarter": quarter,
                "name": name,
                "company": company,
                "payload": json.dumps(
                    {
                        "periodStart": period_start,
                        "periodEnd": period_end,
                        "contractType": contract_type,
                        "excelConsentRaw": consent_raw_str,
                        "excelConsentSource": block_company,
                        "consentNormalized": consent,
                        "opsConsentPreset": consent == "confirmed",
                    },
                    ensure_ascii=False,
                ),
            }
        ]
        # 認識済みの場合、追加で SYNC_CONSENT_RESOLVED を記録
        if consent == "confirmed":
            audit_items.append(
                {
                    "subjectId": subject_id,
                    "eventId": f"{now}#{uuid.uuid4()}",
                    "eventType": "SYNC_CONSENT_RESOLVED",
                    "timestamp": now,
                    "actor": "SYSTEM",
                    "quarter": quarter,
                    "name": name,
                    "company": company,
                    "payload": json.dumps(
                        {
                            "opsConsentResult": "consent",
                            "source": "EXCEL_SYNC",
                            "excelConsentRaw": consent_raw_str,
                            "excelConsentSource": block_company,
                        },
                        ensure_ascii=False,
                    ),
                }
            )

        created = _put_candidate(
            current_state_table, audit_log_table, state_item, audit_items
        )
        if created:
            counts["created"] += 1
            if consent == "confirmed":
                counts["created_consent_preset"] += 1
            logger.info(
                f"候補作成: {name} / {company} / quarter={quarter} / consent={consent}"
            )
        else:
            counts["skipped_existing"] += 1
            logger.info(f"既存スキップ（冪等）: {name} / {company}")

    logger.info(f"extract_candidates 完了: {counts}")
    return counts
