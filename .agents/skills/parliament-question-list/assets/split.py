import csv
import re
from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parent
SOURCE_DIR = ROOT / "원문"
OUTPUT_PATH = ROOT / "data" / "문항목록.csv"
FIELDS = ["파일명", "위원회", "의원", "제출기한", "문항번호", "요구내용", "세부항목", "비고"]

HEADER_RE = re.compile(r"^(?P<committee>.+위원회)\s+(?P<member>\S+)\s+의원실\s+자료요구서$")
DEADLINE_RE = re.compile(r"제출기한:\s*(?P<year>\d{4})\.\s*(?P<month>\d{1,2})\.\s*(?P<day>\d{1,2})\.")
ITEM_RE = re.compile(r"^(?P<number>\d+)\.\s*(?P<text>.*)$")
SUBITEM_RE = re.compile(r"^(?P<label>[가나다라마바사아자차카타파하])\.\s*(?P<text>.*)$")
EXPECTED_RE = re.compile(r"_(?P<count>\d+)문항\.pdf$")


def append_text(
    current: dict[str, str],
    field: str,
    text: str,
    new_entry: bool = False,
    entry_separator: str = " / ",
) -> None:
    text = text.strip()
    if not text:
        return
    separator = entry_separator if new_entry and current[field] else " " if current[field] else ""
    current[field] += separator + text


def parse_pdf(path: Path) -> tuple[list[dict[str, str]], dict[str, object]]:
    reader = PdfReader(path)
    lines: list[str] = []
    for page in reader.pages:
        lines.extend((page.extract_text() or "").splitlines())

    committee = ""
    member = ""
    deadline = ""
    for raw_line in lines:
        line = raw_line.strip()
        header_match = HEADER_RE.match(line)
        if header_match:
            committee = header_match.group("committee")
            member = header_match.group("member")
        deadline_match = DEADLINE_RE.search(line)
        if deadline_match:
            deadline = (
                f"{deadline_match.group('year')}-"
                f"{int(deadline_match.group('month')):02d}-"
                f"{int(deadline_match.group('day')):02d}"
            )

    if not committee or not member or not deadline:
        raise ValueError(f"머리글 또는 제출기한을 읽지 못했습니다: {path.name}")

    rows: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    active_field = "요구내용"

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            continue
        if HEADER_RE.match(line):
            continue
        if line.startswith("수신:") or line.startswith("담당 보좌관:") or line == "끝.":
            continue

        item_match = ITEM_RE.match(line)
        if item_match:
            if current is not None:
                rows.append(current)
            current = {
                "파일명": path.name,
                "위원회": committee,
                "의원": member,
                "제출기한": deadline,
                "문항번호": item_match.group("number"),
                "요구내용": item_match.group("text").strip(),
                "세부항목": "",
                "비고": "",
            }
            active_field = "요구내용"
            continue

        if current is None:
            continue

        subitem_match = SUBITEM_RE.match(line)
        if subitem_match:
            append_text(
                current,
                "세부항목",
                f"{subitem_match.group('label')}. {subitem_match.group('text').strip()}",
                new_entry=True,
            )
            active_field = "세부항목"
        elif line.startswith("※"):
            append_text(current, "비고", line.removeprefix("※").strip(), new_entry=True)
            active_field = "비고"
        else:
            append_text(current, active_field, line)

    if current is not None:
        rows.append(current)

    expected_match = EXPECTED_RE.search(path.name)
    if not expected_match:
        raise ValueError(f"파일명에서 문항 수를 읽지 못했습니다: {path.name}")
    expected_count = int(expected_match.group("count"))
    numbers = [int(row["문항번호"]) for row in rows]
    continuous = numbers == list(range(1, len(numbers) + 1))
    last_number = numbers[-1] if numbers else 0
    matched = expected_count == len(rows) == last_number and continuous
    check = {
        "파일명": path.name,
        "파일명의 문항 수": expected_count,
        "뽑은 문항 수": len(rows),
        "마지막 번호": last_number,
        "번호 연속": continuous,
        "일치": matched,
    }
    return rows, check


def main() -> None:
    pdf_paths = sorted(SOURCE_DIR.glob("*.pdf"))
    if not pdf_paths:
        raise ValueError(f"원문 PDF가 없습니다: {SOURCE_DIR}")

    all_rows: list[dict[str, str]] = []
    checks: list[dict[str, object]] = []
    for path in pdf_paths:
        rows, check = parse_pdf(path)
        all_rows.extend(rows)
        checks.append(check)

    if any(not check["일치"] for check in checks):
        for check in checks:
            print(check)
        raise ValueError("문항 수 또는 번호 연속성 검사가 일치하지 않습니다.")

    if OUTPUT_PATH.exists():
        raise FileExistsError(f"기존 파일을 덮어쓰지 않습니다: {OUTPUT_PATH}")
    with OUTPUT_PATH.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(all_rows)

    for check in checks:
        print(
            f"{check['파일명']} | {check['파일명의 문항 수']} | "
            f"{check['뽑은 문항 수']} | {check['마지막 번호']} | "
            f"{'O' if check['번호 연속'] else 'X'} | {'O' if check['일치'] else 'X'}"
        )
    print(f"합계 {len(all_rows)}문항을 {OUTPUT_PATH}에 저장했습니다.")


if __name__ == "__main__":
    main()
