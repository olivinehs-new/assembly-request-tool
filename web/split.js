const HEADER_RE = /^(?<committee>.+위원회)\s+(?<member>\S+)\s+의원실\s+자료요구서$/;
const DEADLINE_RE = /제출기한:\s*(?<year>\d{4})\.\s*(?<month>\d{1,2})\.\s*(?<day>\d{1,2})\./;
const ITEM_RE = /^(?<number>\d+)\.\s*(?<text>.*)$/;
const SUBITEM_RE = /^(?<label>[가나다라마바사아자차카타파하])\.\s*(?<text>.*)$/;
const EXPECTED_RE = /_(?<count>\d+)문항\.pdf$/i;

function appendText(item, field, text, newEntry = false) {
  const value = String(text || "").trim();
  if (!value) return;
  const separator = newEntry && item[field] ? " / " : item[field] ? " " : "";
  item[field] += separator + value;
}

export function splitRequestLines(lines, fileName) {
  let committee = "";
  let member = "";
  let deadline = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const header = line.match(HEADER_RE);
    if (header) {
      committee = header.groups.committee;
      member = header.groups.member;
    }
    const deadlineMatch = line.match(DEADLINE_RE);
    if (deadlineMatch) {
      deadline = `${deadlineMatch.groups.year}-${deadlineMatch.groups.month.padStart(2, "0")}-${deadlineMatch.groups.day.padStart(2, "0")}`;
    }
  }
  if (!committee || !member || !deadline) throw new Error(`${fileName}: 머리글 또는 제출기한을 읽지 못했습니다.`);

  const items = [];
  let current = null;
  let activeField = "요구내용";
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || HEADER_RE.test(line)) continue;
    if (line.startsWith("수신:") || line.startsWith("담당 보좌관:") || line === "끝.") continue;

    const itemMatch = line.match(ITEM_RE);
    if (itemMatch) {
      if (current) items.push(current);
      current = {
        파일명: fileName,
        위원회: committee,
        의원: member,
        제출기한: deadline,
        문항번호: itemMatch.groups.number,
        요구내용: itemMatch.groups.text.trim(),
        세부항목: "",
        비고: "",
      };
      activeField = "요구내용";
      continue;
    }
    if (!current) continue;

    const subitem = line.match(SUBITEM_RE);
    if (subitem) {
      appendText(current, "세부항목", `${subitem.groups.label}. ${subitem.groups.text.trim()}`, true);
      activeField = "세부항목";
    } else if (line.startsWith("※")) {
      appendText(current, "비고", line.replace(/^※\s*/, ""), true);
      activeField = "비고";
    } else {
      appendText(current, activeField, line);
    }
  }
  if (current) items.push(current);

  const numbers = items.map((item) => Number(item.문항번호));
  const continuous = numbers.every((number, index) => number === index + 1);
  const expected = Number(fileName.match(EXPECTED_RE)?.groups.count || 0);
  const last = numbers.at(-1) || 0;
  return {
    items,
    check: {
      파일명: fileName,
      파일명의문항수: expected || "확인필요",
      뽑은문항수: items.length,
      마지막번호: last,
      번호연속: continuous,
      일치: Boolean(expected) && expected === items.length && expected === last && continuous,
    },
  };
}

function textItemsToLines(items) {
  const lines = [];
  let line = "";
  for (const item of items) {
    const value = item.str || "";
    if (value) {
      const needsSpace = line && !/\s$/.test(line) && !/^\s/.test(value);
      line += (needsSpace ? " " : "") + value;
    }
    if (item.hasEOL) {
      if (line.trim()) lines.push(line.trim());
      line = "";
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

export async function extractPdfFile(file, pdfjsLib) {
  const data = new Uint8Array(await file.arrayBuffer());
  const document = await pdfjsLib.getDocument({ data }).promise;
  const lines = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    lines.push(...textItemsToLines(content.items));
  }
  return splitRequestLines(lines, file.name);
}

export function rowsFromQuestionCsv(rows) {
  const required = ["파일명", "위원회", "의원", "제출기한", "문항번호", "요구내용", "세부항목", "비고"];
  if (!rows.length || required.some((field) => !(field in rows[0]))) {
    throw new Error("문항목록.csv의 필수 열을 확인해 주세요.");
  }
  return rows.map((row) => Object.fromEntries(required.map((field) => [field, String(row[field] || "").trim()])));
}
