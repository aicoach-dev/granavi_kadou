from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen


TARGET_NAMES = ["小熊 峰明", "大野 圭祐", "宮本 孝", "柏木 浩司"]
TARGET_MONTH = "2026-02"
MONTHS_TO_SHOW = [
    "2025-04",
    "2025-05",
    "2025-06",
    "2025-07",
    "2025-08",
    "2025-09",
    "2025-10",
    "2025-11",
    "2025-12",
    "2026-01",
    "2026-02",
    "2026-03",
]


def extract_gas_settings(html_path: Path) -> tuple[str, str]:
    text = html_path.read_text(encoding="utf-8")
    gas_match = re.search(r"const\s+GAS_URL\s*=\s*'([^']+)'", text)
    key_match = re.search(r"const\s+MONTHLY_KEY\s*=\s*'([^']+)'", text)
    if not gas_match or not key_match:
        raise ValueError("kadou.html から GAS_URL / MONTHLY_KEY を抽出できませんでした。")
    return gas_match.group(1), key_match.group(1)


def extract_member_map(html_path: Path) -> dict[str, str]:
    text = html_path.read_text(encoding="utf-8")
    match = re.search(r"function\s+getSampleData\s*\(\)\s*\{\s*return\s*\[(.*?)\];\s*\}", text, re.S)
    if not match:
        raise ValueError("kadou.html から getSampleData を抽出できませんでした。")
    pattern = re.compile(r'\{id:"([^"]+)",name:"([^"]+)",team:"([^"]+)"')
    member_map: dict[str, str] = {}
    for member_id, name, _team in pattern.findall(match.group(1)):
        if name not in member_map:
            member_map[name] = member_id
    return member_map


def fetch_monthly_records(gas_url: str, monthly_key: str) -> list[dict]:
    url = f"{gas_url}?{urlencode({'key': monthly_key})}"
    with urlopen(url) as response:
        payload = json.load(response)
    raw_value = payload.get("value")
    if not raw_value:
        return []
    records = json.loads(raw_value)
    if not isinstance(records, list):
        raise ValueError("monthlyRecords が配列ではありません。")
    return records


def main() -> None:
    html_path = Path("kadou.html").resolve(strict=True)
    gas_url, monthly_key = extract_gas_settings(html_path)
    member_map = extract_member_map(html_path)
    records = fetch_monthly_records(gas_url, monthly_key)
    counter = Counter(str(record.get("year_month", "")) for record in records)

    print(f"total monthlyRecords count: {len(records)}")
    print("year_month counts:")
    for year_month in MONTHS_TO_SHOW:
        print(f"  {year_month}: {counter.get(year_month, 0)}")

    print(f"{TARGET_MONTH} count: {counter.get(TARGET_MONTH, 0)}")
    print(f"{TARGET_MONTH} target records:")
    for name in TARGET_NAMES:
        member_id = member_map.get(name)
        matched = [
            record for record in records
            if record.get("member_id") == member_id and record.get("year_month") == TARGET_MONTH
        ]
        print(f"  {name} ({member_id}):")
        if matched:
            for record in matched:
                print("   ", json.dumps(record, ensure_ascii=False, sort_keys=True))
        else:
            print("    NOT FOUND")


if __name__ == "__main__":
    main()
