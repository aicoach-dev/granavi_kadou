"""
チームCSV読み込み + DynamoDB team フィールド更新

フォーマット: CSV（UTF-8 BOM対応）、列: 社員番号, name（氏名）, team（所属チーム名）
マッチキー : 氏名（name）のみ
更新対象   : 当週の Excel 台帳で is_due / is_included を満たしたレコードのみ

CSVなし週の扱い:
  S3 に team-data/team.csv が存在しない場合は空辞書を返し、
  apply_team_updates() が呼ばれても何もせず終了する（team フィールド維持）。
"""
import csv
import io
import logging
from datetime import date, datetime, timezone

import boto3
from botocore.exceptions import ClientError

from candidate_extractor import compute_subject_id, is_due, is_included

logger = logging.getLogger(__name__)


def read_team_csv(bucket: str, key: str) -> dict:
    """
    S3 からチームCSVを読み込み name → team の辞書を返す。
    ファイルが存在しない場合は空辞書を返す（CSVなし週）。
    """
    s3 = boto3.client("s3")
    try:
        obj = s3.get_object(Bucket=bucket, Key=key)
        content = obj["Body"].read().decode("utf-8-sig")
    except ClientError as e:
        if e.response["Error"]["Code"] in ("NoSuchKey", "404"):
            logger.info(
                f"チームCSVが存在しないため team 更新をスキップ: s3://{bucket}/{key}"
            )
            return {}
        raise

    team_map: dict[str, str] = {}
    reader = csv.DictReader(io.StringIO(content))
    # ヘッダー行を先読みして必須列の存在を確認
    fieldnames = reader.fieldnames or []
    if "name" not in fieldnames or "team" not in fieldnames:
        raise ValueError(
            f"チームCSVのヘッダーが不正。'name'・'team' 列が必要ですが実際の列は: {list(fieldnames)}"
        )
    for row in reader:
        name = (row.get("name") or "").strip()
        team = (row.get("team") or "").strip()
        if name and team:
            team_map[name] = team

    logger.info(f"チームCSV読み込み完了: {len(team_map)} 件")
    return team_map


def apply_team_updates(
    records: list,
    cfg: dict,
    team_map: dict,
    current_state_table_name: str,
    reference_date: date | None = None,
) -> dict:
    """
    Excel 台帳のレコードに対し、team_map を参照して DynamoDB の team フィールドを更新する。

    処理対象: is_due かつ is_included を満たすレコード（extract_candidates と同じフィルタ）
    team_map が空の場合（CSVなし週）は即座に終了し team フィールドを維持する。
    DynamoDB にレコードが存在しない場合（subjectId が未作成）はスキップ。
    氏名が一致しない場合はエラーとせず team 欄を空欄として処理を継続する（team_no_match）。
    """
    if not team_map:
        return {"team_updated": 0, "team_no_match": 0, "team_not_found": 0}

    dynamodb = boto3.resource("dynamodb")
    table = dynamodb.Table(current_state_table_name)
    now = datetime.now(timezone.utc).isoformat()

    counts = {"team_updated": 0, "team_no_match": 0, "team_not_found": 0}

    for rec in records:
        period_start = rec.get("period_start")
        name = rec.get("name", "")
        company = rec.get("company", "")

        if not period_start:
            continue
        if not is_due(period_start, reference_date):
            continue
        if not is_included(rec, cfg):
            continue

        team = team_map.get(name)
        if team is None:
            counts["team_no_match"] += 1
            logger.debug(f"team マッチなし: {name}")
            continue

        subject_id = compute_subject_id(company, name, period_start)
        try:
            table.update_item(
                Key={"subjectId": subject_id},
                UpdateExpression="SET #t = :team, updatedAt = :now",
                ConditionExpression="attribute_exists(subjectId)",
                ExpressionAttributeNames={"#t": "team"},
                ExpressionAttributeValues={":team": team, ":now": now},
            )
            counts["team_updated"] += 1
            logger.debug(f"team 更新: {name} → {team}")
        except ClientError as e:
            if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
                counts["team_not_found"] += 1
                logger.debug(f"team 更新スキップ（レコード未存在）: {name}/{company}")
            else:
                raise

    logger.info(f"apply_team_updates 完了: {counts}")
    return counts

