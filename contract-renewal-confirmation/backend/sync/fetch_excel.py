"""
Excel台帳ファイルの取得 — SharePoint Graph API vs S3 の切り替え

環境変数 EXCEL_SOURCE:
  'S3'         : S3バケットからファイルを取得（テスト・初期実装用）
  'SHAREPOINT' : SharePoint Graph APIからファイルを取得（Entra IDアプリ登録完了後）

SHAREPOINT モードは Entra ID アプリ登録が完了するまで NotImplementedError を送出する。
"""
import os

import boto3

EXCEL_SOURCE = os.environ.get("EXCEL_SOURCE", "S3")


def fetch_excel_bytes() -> bytes:
    if EXCEL_SOURCE == "SHAREPOINT":
        return _fetch_from_sharepoint()
    return _fetch_from_s3()


def _fetch_from_s3() -> bytes:
    bucket = os.environ["EXCEL_BUCKET"]
    key = os.environ["EXCEL_KEY"]
    s3 = boto3.client("s3")
    response = s3.get_object(Bucket=bucket, Key=key)
    return response["Body"].read()


def _fetch_from_sharepoint() -> bytes:
    """SharePoint Graph APIからExcel台帳を取得する。

    Entra IDアプリ登録（テナント管理者の同意取得）が完了次第、
    Secrets Managerから認証情報を取得して実装する予定。
    現時点では EXCEL_SOURCE=S3 で動作させること。
    """
    raise NotImplementedError(
        "SharePoint Graph API連携は未実装です。"
        "Entra IDアプリ登録（client_id, tenant_id, client_secret）が確認できたら実装します。"
        "現在は EXCEL_SOURCE=S3 で動作させてください。"
    )
