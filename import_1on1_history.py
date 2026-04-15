from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET
from zipfile import ZipFile

print("START SCRIPT", flush=True)


NS_MAIN = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
MONTH_COLUMNS = {
    "D": "2025-04",
    "E": "2025-05",
    "F": "2025-06",
    "G": "2025-07",
    "H": "2025-08",
    "I": "2025-09",
    "J": "2025-10",
    "K": "2025-11",
    "L": "2025-12",
    "M": "2026-01",
    "N": "2026-02",
    "O": "2026-03",
}
MONTH_VALUE_MAP = {
    "◯": 1,
    "◯●": 1,
    "●": 0,
    "": 0,
}
SKIP_PREFIXES = ("待機", "入社月", "対象外", "退職")


@dataclass
class ImportBuildResult:
    records: list[dict[str, Any]]
    unmatched_names: list[dict[str, Any]]
    duplicate_name_hits: list[dict[str, Any]]
    summary: dict[str, Any]


def main() -> int:
    print("ENTER MAIN", flush=True)
    args = parse_args()
    print("STEP 1: args parsed", flush=True)
    try:
        html_path = args.html.resolve(strict=True)
        xlsx_path = args.xlsx.resolve(strict=True)
        output_dir = Path("import_output")

        print("STEP 2: reading excel", flush=True)
        members = extract_members_from_html(html_path)
        rows = read_excel_rows(xlsx_path)
        print("STEP 3: building records", flush=True)
        result = build_import_records(rows, members, xlsx_path, html_path)

        print("STEP 4: writing json", flush=True)
        output_dir.mkdir(parents=True, exist_ok=True)
        write_json(output_dir / "import_records.json", result.records)
        write_json(output_dir / "unmatched_names.json", result.unmatched_names)
        write_json(output_dir / "duplicate_name_hits.json", result.duplicate_name_hits)
        print(f"JSON written: import_records={len(result.records)} unmatched={len(result.unmatched_names)} duplicate={len(result.duplicate_name_hits)}", flush=True)

        print(f"STEP 5: apply mode: {args.apply}", flush=True)
        if args.apply:
            print("APPLY: extracting GAS settings", flush=True)
            gas_url, monthly_key = extract_gas_settings(html_path)
            print(f"APPLY: GET existing monthly records key={monthly_key}", flush=True)
            existing_records = fetch_existing_monthly_records(gas_url, monthly_key)
            merged_records = merge_monthly_records(existing_records, result.records)
            write_json(output_dir / "merged_monthly_records.json", merged_records)
            print(f"APPLY: merged existing={len(existing_records)} imported={len(result.records)} merged={len(merged_records)}", flush=True)
            print("APPLY: POST merged monthly records", flush=True)
            post_monthly_records(gas_url, monthly_key, merged_records)
            print("APPLY: POST completed", flush=True)
            verify_records = fetch_existing_monthly_records(gas_url, monthly_key)
            print(f"APPLY: reGET after POST count={len(verify_records)}", flush=True)
            if len(verify_records) <= len(existing_records):
                raise RuntimeError(
                    f"POST後の保存件数が増えていません: existing={len(existing_records)} reGET={len(verify_records)}"
                )
            result.summary["apply_executed"] = True
            result.summary["existing_record_count"] = len(existing_records)
            result.summary["merged_record_count"] = len(merged_records)
            result.summary["post_verify_count"] = len(verify_records)
        else:
            result.summary["apply_executed"] = False

        write_json(output_dir / "import_summary.json", result.summary)
        print("DONE: import_summary.json written", flush=True)
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", flush=True)
        raise


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import leader 1on1 history into monthlyRecords format.")
    parser.add_argument("--xlsx", type=Path, required=True, help="Source Excel file path.")
    parser.add_argument("--html", type=Path, required=True, help="Source kadou.html path.")
    parser.add_argument("--apply", action="store_true", help="Fetch, merge, and POST merged monthly records.")
    return parser.parse_args()


def extract_members_from_html(html_path: Path) -> dict[str, list[dict[str, str]]]:
    text = html_path.read_text(encoding="utf-8")
    match = re.search(r"function\s+getSampleData\s*\(\)\s*\{\s*return\s*\[(.*?)\];\s*\}", text, re.S)
    if not match:
        raise ValueError("kadou.html からメンバーマスタを抽出できませんでした。")

    members_by_name: dict[str, list[dict[str, str]]] = defaultdict(list)
    pattern = re.compile(r'\{id:"([^"]+)",name:"([^"]+)",team:"([^"]+)"')
    for member_id, name, team in pattern.findall(match.group(1)):
        members_by_name[name].append({"id": member_id, "name": name, "team": team})

    if not members_by_name:
        raise ValueError("kadou.html からメンバー情報を抽出できませんでした。")
    return dict(members_by_name)


def extract_gas_settings(html_path: Path) -> tuple[str, str]:
    text = html_path.read_text(encoding="utf-8")
    gas_match = re.search(r"const\s+GAS_URL\s*=\s*'([^']+)'", text)
    key_match = re.search(r"const\s+MONTHLY_KEY\s*=\s*'([^']+)'", text)
    if not gas_match or not key_match:
        raise ValueError("--apply に必要な GAS_URL または MONTHLY_KEY を kadou.html から抽出できませんでした。")
    return gas_match.group(1), key_match.group(1)


def read_excel_rows(xlsx_path: Path) -> list[dict[str, str]]:
    with ZipFile(xlsx_path) as zf:
        shared_strings = load_shared_strings(zf)
        workbook = ET.fromstring(zf.read("xl/workbook.xml"))
        sheets = workbook.find("a:sheets", NS_MAIN)
        if sheets is None or not list(sheets):
            raise ValueError("Excel にシートが見つかりません。")

        first_sheet_rel_id = list(sheets)[0].attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
        if not first_sheet_rel_id:
            raise ValueError("Excel の先頭シート参照を取得できませんでした。")

        rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
        target = None
        for rel in rels:
            if rel.attrib.get("Id") == first_sheet_rel_id:
                target = rel.attrib.get("Target")
                break
        if not target:
            raise ValueError("Excel のシート実体を取得できませんでした。")

        sheet_xml = ET.fromstring(zf.read(f"xl/{target}" if not target.startswith("xl/") else target))
        sheet_data = sheet_xml.find("a:sheetData", NS_MAIN)
        if sheet_data is None:
            raise ValueError("Excel シートにデータがありません。")

        rows: list[dict[str, str]] = []
        for row in list(sheet_data):
            cell_map: dict[str, str] = {}
            for cell in row.findall("a:c", NS_MAIN):
                ref = cell.attrib.get("r", "")
                col = "".join(ch for ch in ref if ch.isalpha())
                cell_map[col] = read_cell_value(cell, shared_strings)
            rows.append(cell_map)

    if len(rows) <= 1:
        raise ValueError("Excel にデータ行がありません。")
    return rows


def load_shared_strings(zf: ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    strings: list[str] = []
    for item in root.findall("a:si", NS_MAIN):
        text = "".join(node.text or "" for node in item.iterfind(".//a:t", NS_MAIN))
        strings.append(text)
    return strings


def read_cell_value(cell: ET.Element, shared_strings: list[str]) -> str:
    cell_type = cell.attrib.get("t")
    value_node = cell.find("a:v", NS_MAIN)
    if value_node is None or value_node.text is None:
        inline = cell.find("a:is", NS_MAIN)
        if inline is not None:
            return "".join(node.text or "" for node in inline.iterfind(".//a:t", NS_MAIN)).strip()
        return ""

    raw = value_node.text
    if cell_type == "s":
        return shared_strings[int(raw)].strip()
    return raw.strip()


def build_import_records(
    rows: list[dict[str, str]],
    members_by_name: dict[str, list[dict[str, str]]],
    xlsx_path: Path,
    html_path: Path,
) -> ImportBuildResult:
    header = rows[0]
    validate_header(header)

    today_str = date.today().isoformat()
    records: list[dict[str, Any]] = []
    unmatched_names: list[dict[str, Any]] = []
    duplicate_name_hits: list[dict[str, Any]] = []
    skipped_month_count = 0
    import_row_count = 0

    for excel_row_num, row in enumerate(rows[1:], start=2):
        name = row.get("A", "").strip()
        if not name:
            continue
        import_row_count += 1
        member_hits = members_by_name.get(name, [])

        if len(member_hits) > 1:
            duplicate_name_hits.append(
                {
                    "excel_row": excel_row_num,
                    "name": name,
                    "member_hits": member_hits,
                }
            )
            continue

        if not member_hits:
            unmatched_names.append(
                {
                    "excel_row": excel_row_num,
                    "name": name,
                    "team": row.get("B", ""),
                }
            )
            continue

        member = member_hits[0]
        for col, year_month in MONTH_COLUMNS.items():
            raw_value = normalize_month_value(row.get(col, ""))
            if is_skip_value(raw_value):
                skipped_month_count += 1
                continue
            if raw_value not in MONTH_VALUE_MAP:
                raise ValueError(
                    f"想定外の月セル値を検出しました: row={excel_row_num}, col={col}, name={name}, value={raw_value!r}"
                )

            count = MONTH_VALUE_MAP[raw_value]
            records.append(
                {
                    "id": f"{member['id']}__{year_month}",
                    "member_id": member["id"],
                    "year_month": year_month,
                    "one_on_one_count": count,
                    "monthly_report_count": 0,
                    "plus_customer": 0,
                    "plus_blog": 0,
                    "plus_interview": 0,
                    "memo": "",
                    "created_at": today_str,
                    "updated_at": today_str,
                }
            )

    if import_row_count == 0:
        raise ValueError("Excel に変換対象のデータ行がありません。")

    records.sort(key=lambda item: (item["member_id"], item["year_month"]))
    unmatched_names.sort(key=lambda item: (item["name"], item["excel_row"]))
    duplicate_name_hits.sort(key=lambda item: (item["name"], item["excel_row"]))

    summary = {
        "source_xlsx": str(xlsx_path),
        "source_html": str(html_path),
        "input_row_count": import_row_count,
        "generated_record_count": len(records),
        "skipped_month_count": skipped_month_count,
        "unmatched_count": len(unmatched_names),
        "duplicate_name_hit_count": len(duplicate_name_hits),
        "rules": {
            "target_scope": "リーダー1on1のみ",
            "month_columns": list(MONTH_COLUMNS.keys()),
            "month_mapping": MONTH_COLUMNS,
            "cell_value_mapping": {
                "◯": 1,
                "◯●": 1,
                "●": 0,
                "空白": 0,
            },
            "skip_values": ["待機", "入社月", "対象外", "退職"],
        },
    }
    return ImportBuildResult(records, unmatched_names, duplicate_name_hits, summary)


def validate_header(header: dict[str, str]) -> None:
    if header.get("A", "")[:2] != "氏名":
        raise ValueError("Excel ヘッダ A列が氏名ではありません。")
    if len(MONTH_COLUMNS) != 12:
        raise ValueError("月列定義が不正です。")
    for col in MONTH_COLUMNS:
        if col not in header:
            raise ValueError(f"Excel ヘッダに月列 {col} が見つかりません。")


def normalize_month_value(raw: str) -> str:
    value = raw.strip().replace(" ", "").replace("\u3000", "")
    for prefix in SKIP_PREFIXES:
        if value.startswith(prefix):
            return prefix
    return value


def is_skip_value(value: str) -> bool:
    return value in SKIP_PREFIXES


def fetch_existing_monthly_records(gas_url: str, monthly_key: str) -> list[dict[str, Any]]:
    url = f"{gas_url}?{urlencode({'key': monthly_key})}"
    try:
        with urlopen(url) as response:
            payload = json.load(response)
    except (HTTPError, URLError) as exc:
        raise RuntimeError(f"既存 monthlyRecords の取得に失敗しました: {exc}") from exc

    raw_value = payload.get("value")
    if not raw_value:
        return []

    parsed = json.loads(raw_value)
    if not isinstance(parsed, list):
        raise ValueError("既存 monthlyRecords の形式が配列ではありません。")
    return parsed


def merge_monthly_records(existing: list[dict[str, Any]], imported: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[tuple[str, str], dict[str, Any]] = {}

    for record in existing:
        key = (str(record.get("member_id", "")), str(record.get("year_month", "")))
        if not key[0] or not key[1]:
            continue
        merged[key] = dict(record)

    for record in imported:
        key = (record["member_id"], record["year_month"])
        if key in merged:
            updated = dict(merged[key])
            updated["one_on_one_count"] = record["one_on_one_count"]
            updated["id"] = record["id"]
            if not updated.get("created_at"):
                updated["created_at"] = record["created_at"]
            updated["updated_at"] = record["updated_at"]
            merged[key] = updated
        else:
            merged[key] = dict(record)

    return sorted(merged.values(), key=lambda item: (str(item.get("member_id", "")), str(item.get("year_month", ""))))


def post_monthly_records(gas_url: str, monthly_key: str, merged_records: list[dict[str, Any]]) -> None:
    payload = json.dumps(merged_records, ensure_ascii=False)
    body_text = json.dumps({"key": monthly_key, "value": payload}, ensure_ascii=False)
    print(f"APPLY: POST body length={len(body_text)} payload length={len(payload)}", flush=True)
    request = Request(gas_url, data=body_text.encode("utf-8"), method="POST")
    try:
        with urlopen(request) as response:
            response_text = response.read().decode("utf-8", errors="replace")
            print(f"APPLY: POST response status={response.status}", flush=True)
            print(f"APPLY: POST response body={response_text}", flush=True)
            if response.status < 200 or response.status >= 300:
                raise RuntimeError(f"POST failed: {response.status}")
    except (HTTPError, URLError) as exc:
        raise RuntimeError(f"既存 monthlyRecords の保存に失敗しました: {exc}") from exc


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
