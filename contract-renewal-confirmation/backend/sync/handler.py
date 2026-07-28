"""
週次同期Lambda エントリポイント

EventBridge Scheduler から週次で呼ばれる。
Excel台帳を取得・解析し、候補レコードをDynamoDBに書き込む。
"""
import json
import logging
import os

from candidate_extractor import extract_candidates
from fetch_excel import fetch_excel_bytes
from ledger_parser import load_config, parse_ledger

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config", "ledger_mapping.json")
_CURRENT_STATE_TABLE = os.environ["CURRENT_STATE_TABLE"]
_AUDIT_LOG_TABLE = os.environ["AUDIT_LOG_TABLE"]


def lambda_handler(event, context):
    logger.info("週次同期Lambda 開始")

    excel_bytes = fetch_excel_bytes()
    logger.info(f"Excel台帳取得: {len(excel_bytes):,} bytes")

    cfg = load_config(_CONFIG_PATH)
    records = parse_ledger(excel_bytes, cfg)
    logger.info(f"台帳解析: {len(records)} 件")

    result = extract_candidates(records, cfg, _CURRENT_STATE_TABLE, _AUDIT_LOG_TABLE)
    logger.info(f"候補抽出完了: {result}")

    return {
        "statusCode": 200,
        "body": json.dumps(result, ensure_ascii=False),
    }
