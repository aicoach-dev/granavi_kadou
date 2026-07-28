"""
Excel台帳ファイルの取得 — SharePoint Graph API vs S3 の切り替え

環境変数 EXCEL_SOURCE:
  'S3'         : S3バケットからファイルを取得（テスト・初期実装用）
  'SHAREPOINT' : SharePoint Graph APIからファイルを取得（Entra IDアプリ登録完了後）

【SharePoint 接続に必要な環境変数】（EXCEL_SOURCE=SHAREPOINT 時のみ参照）
  GRAPH_API_SECRET_NAME : Secrets Manager のシークレット名
                          値の形式: {"tenantId": "...", "clientId": "...", "clientSecret": "..."}
  SHAREPOINT_SITE_HOST  : SharePoint ホスト名
                          例: gravityoffice365.sharepoint.com
  SHAREPOINT_SITE_PATH  : SharePoint サイトパス（サーバー相対パス）
                          例: /sites/granavi
  SHAREPOINT_FILE_PATH  : ドキュメントライブラリルートからのファイルパス
                          例: Shared Documents/2026年度台帳.xlsx

【Sites.Selected 権限について】
  このアプリは Microsoft Graph API の Sites.Selected 権限を使用する。
  通常の Sites.Read.All とは異なり、特定のサイトへの読み取り権限のみを
  付与する最小権限モデルである。

  Sites.Selected はアプリに対してテナント全体の同意（管理者同意）をしても
  それだけではサイトへのアクセスは拒否される。さらに以下の手順が別途必要:

    1. Entra ID ポータルでアプリの API permissions に Sites.Selected を追加し、
       テナント管理者が管理者同意を付与する（これだけではアクセス不可）。

    2. テナント管理者権限で Graph API を直接呼び出し、
       対象 SharePoint サイトへの読み取り権限を付与する:
         POST https://graph.microsoft.com/v1.0/sites/{site-id}/permissions
         Body: {
           "roles": ["read"],
           "grantedToIdentities": [{
             "application": {
               "id": "{clientId}",
               "displayName": "contract-renewal-sync"
             }
           }]
         }

    3. 上記のサイト単位のアクセス許可は Entra ID ポータルの「API のアクセス許可」
       画面には表示されず、Graph API（または Graph Explorer）でのみ確認・管理できる。
         確認: GET https://graph.microsoft.com/v1.0/sites/{site-id}/permissions

  このサイト単位付与は 2026年に実施済み（contract-renewal-graph-api シークレット参照）。
  新たなサイトへのアクセスが必要になった場合は、テナント管理者が同様の手順で付与する。
"""
import json
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
    """SharePoint Graph API からExcel台帳を取得する。

    認証: OAuth2 クライアント認証情報フロー (client_credentials)
    権限: Sites.Selected（サイト単位付与、詳細はモジュール冒頭コメント参照）
    """
    import requests  # Lambda パッケージ内でのみ利用

    # Secrets Manager から認証情報を取得
    secret_name = os.environ["GRAPH_API_SECRET_NAME"]
    sm = boto3.client("secretsmanager")
    creds = json.loads(sm.get_secret_value(SecretId=secret_name)["SecretString"])

    tenant_id = creds["tenantId"]
    client_id = creds["clientId"]
    client_secret = creds["clientSecret"]

    # OAuth2 クライアント認証情報フローでアクセストークン取得
    token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
    token_resp = requests.post(
        token_url,
        data={
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": "https://graph.microsoft.com/.default",
        },
        timeout=30,
    )
    token_resp.raise_for_status()
    access_token = token_resp.json()["access_token"]

    headers = {"Authorization": f"Bearer {access_token}"}

    # SharePoint 設定
    site_host = os.environ["SHAREPOINT_SITE_HOST"]  # 例: gravityoffice365.sharepoint.com
    site_path = os.environ["SHAREPOINT_SITE_PATH"]  # 例: /sites/granavi
    file_path = os.environ["SHAREPOINT_FILE_PATH"]  # 例: Shared Documents/2026年度台帳.xlsx

    # Graph API でファイルコンテンツを取得
    # /sites/{host}:{server-relative-path}:/drive/root:/{file-path}:/content
    file_url = (
        f"https://graph.microsoft.com/v1.0"
        f"/sites/{site_host}:{site_path}"
        f":/drive/root:/{file_path}:/content"
    )
    file_resp = requests.get(file_url, headers=headers, timeout=60, allow_redirects=True)
    file_resp.raise_for_status()
    return file_resp.content
