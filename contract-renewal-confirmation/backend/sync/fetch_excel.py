"""
Excel台帳ファイルの取得 — SharePoint Graph API vs S3 の切り替え

環境変数 EXCEL_SOURCE:
  'S3'         : S3バケットからファイルを取得（テスト・初期実装用）
  'SHAREPOINT' : SharePoint Graph APIからファイルを取得（本番環境）

【SharePoint 接続に必要な環境変数】（EXCEL_SOURCE=SHAREPOINT 時のみ参照）
  GRAPH_API_SECRET_NAME : Secrets Manager のシークレット名
                          値の形式: {"tenantId": "...", "clientId": "...", "clientSecret": "..."}
  SHAREPOINT_SITE_HOST  : SharePoint ホスト名
                          例: gravityoffice365.sharepoint.com
  SHAREPOINT_SITE_PATH  : SharePoint サイトパス（サーバー相対パス）
                          例: /sites/01_
  SHAREPOINT_ITEM_GUID  : ファイルの SharePoint UniqueId（GUID）。
                          SharePoint でファイルを開いた際の URL の sourcedoc パラメータ
                          （URLデコード後の {} で括られた部分）から取得する。
                          例: ...?sourcedoc=%7B438071B4-9178-4A3F-A9D2-28F285C9FE1C%7D
                          → SHAREPOINT_ITEM_GUID = 438071B4-9178-4A3F-A9D2-28F285C9FE1C

                          パス指定ではなく GUID 指定にしているため、ファイルが移動・
                          リネームされても GUID は変わらない。変更が必要な場合は
                          CDK の environment.SHAREPOINT_ITEM_GUID を更新して cdk deploy する。

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
import logging
import os

import boto3

logger = logging.getLogger(__name__)

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

    ファイル特定方式: SharePoint リストアイテムの UniqueId（GUID）によるドライブアイテム検索。
    ファイル名・フォルダパスの変更に依存しない。詳細はモジュール冒頭コメント参照。

    認証: OAuth2 クライアント認証情報フロー (client_credentials)
    権限: Sites.Selected（サイト単位付与、詳細はモジュール冒頭コメント参照）
    """
    import requests

    # Secrets Manager から認証情報を取得
    secret_name = os.environ["GRAPH_API_SECRET_NAME"]
    sm = boto3.client("secretsmanager")
    creds = json.loads(sm.get_secret_value(SecretId=secret_name)["SecretString"])

    # OAuth2 クライアント認証情報フローでアクセストークン取得
    token_resp = requests.post(
        f"https://login.microsoftonline.com/{creds['tenantId']}/oauth2/v2.0/token",
        data={
            "grant_type": "client_credentials",
            "client_id": creds["clientId"],
            "client_secret": creds["clientSecret"],
            "scope": "https://graph.microsoft.com/.default",
        },
        timeout=30,
    )
    token_resp.raise_for_status()
    h = {"Authorization": f"Bearer {token_resp.json()['access_token']}"}
    g = "https://graph.microsoft.com/v1.0"

    site_host = os.environ["SHAREPOINT_SITE_HOST"]
    site_path = os.environ["SHAREPOINT_SITE_PATH"]
    # GUID は {} なしで設定（例: 438071B4-9178-4A3F-A9D2-28F285C9FE1C）
    # SharePoint の UniqueId フィールドは OData フィルターで {} 付き形式を使用する
    item_guid = os.environ["SHAREPOINT_ITEM_GUID"]
    # Step 1: サイトID解決
    site_resp = requests.get(f"{g}/sites/{site_host}:{site_path}", headers=h, timeout=30)
    site_resp.raise_for_status()
    site_id = site_resp.json()["id"]
    logger.info(f"SharePoint サイトID解決: {site_id}")

    # Step 2: "Shared Documents" リストアイテムを全件取得して UniqueId 照合でファイルを特定
    #
    #   試みた方式と却下理由:
    #     A) $filter=fields/UniqueId eq '{guid}' → 400 Bad Request（listItems では OData フィルター非対応）
    #     B) /drive/root/search(q='.xlsx')       → 500 Internal Server Error（Sites.Selected 権限下ではサーチインデックス不可）
    #     C) 採用: リストアイテム全件取得 + fields.UniqueId クライアント側照合
    #        search に依存しない基本的なリスト操作のみ使用するため Sites.Selected でも動作する。
    #        GUID はパス・ファイル名変更に依存しないため最も安定した識別子である。
    lists_resp = requests.get(
        f"{g}/sites/{site_id}/lists?$select=id,name",
        headers=h, timeout=30,
    )
    lists_resp.raise_for_status()
    all_lists = lists_resp.json().get("value", [])
    doc_lib_names = {"shared documents", "documents", "ドキュメント"}
    doc_lib = next((l for l in all_lists if l["name"].lower() in doc_lib_names), None)
    if doc_lib is None:
        doc_lib = all_lists[0] if all_lists else None
    if doc_lib is None:
        raise ValueError(f"ドキュメントライブラリが {site_path} に見つかりません")
    logger.info(f"ドキュメントライブラリ: {doc_lib['name']} (id={doc_lib['id']})")

    drive_item_id = None
    next_url: str | None = (
        f"{g}/sites/{site_id}/lists/{doc_lib['id']}/items"
        f"?$select=id&$expand=driveItem($select=id,name),fields($select=UniqueId)"
        f"&$top=500"
    )
    pages = 0
    while next_url and drive_item_id is None:
        pages += 1
        resp = requests.get(next_url, headers=h, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        for item in data.get("value", []):
            uid = item.get("fields", {}).get("UniqueId", "")
            if uid.strip("{}").upper() == item_guid.upper():
                di = item.get("driveItem")
                if di:
                    drive_item_id = di["id"]
                    logger.info(f"ファイル特定成功: {di['name']} (page={pages}, GUID={item_guid})")
                break
        next_url = data.get("@odata.nextLink")

    if drive_item_id is None:
        raise ValueError(
            f"GUID={item_guid} のファイルが {doc_lib['name']} で見つかりません（{pages} ページ検索）。"
            f"ファイルが移動・削除された場合は SHAREPOINT_ITEM_GUID 環境変数を更新して cdk deploy する。"
        )

    # Step 3: ファイルコンテンツ取得（ダウンロード）
    content_resp = requests.get(
        f"{g}/sites/{site_id}/drive/items/{drive_item_id}/content",
        headers=h, timeout=60, allow_redirects=True,
    )
    content_resp.raise_for_status()
    logger.info(f"ファイルダウンロード完了: {len(content_resp.content):,} bytes")
    return content_resp.content
