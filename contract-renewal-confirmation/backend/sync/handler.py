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
from team_csv import apply_team_updates, read_team_csv

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config", "ledger_mapping.json")
_CURRENT_STATE_TABLE = os.environ["CURRENT_STATE_TABLE"]
_AUDIT_LOG_TABLE = os.environ["AUDIT_LOG_TABLE"]
_SYNC_BUCKET = os.environ.get("EXCEL_BUCKET", "")
_TEAM_CSV_KEY = os.environ.get("TEAM_CSV_KEY", "team-data/team.csv")


def lambda_handler(event, context):
    logger.info("週次同期Lambda 開始")

    excel_bytes = fetch_excel_bytes()
    logger.info(f"Excel台帳取得: {len(excel_bytes):,} bytes")

    cfg = load_config(_CONFIG_PATH)
    records = parse_ledger(excel_bytes, cfg)
    logger.info(f"台帳解析: {len(records)} 件")

    result = extract_candidates(records, cfg, _CURRENT_STATE_TABLE, _AUDIT_LOG_TABLE)
    logger.info(f"候補抽出完了: {result}")

    # チームCSV連携（S3 にファイルが存在する週のみ更新）
    if _SYNC_BUCKET and _TEAM_CSV_KEY:
        team_map = read_team_csv(_SYNC_BUCKET, _TEAM_CSV_KEY)
        team_result = apply_team_updates(
            records, cfg, team_map, _CURRENT_STATE_TABLE
        )
        result["team"] = team_result
        logger.info(f"チームCSV連携完了: {team_result}")

    return {
        "statusCode": 200,
        "body": json.dumps(result, ensure_ascii=False),
    }
