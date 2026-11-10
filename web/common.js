const STORAGE_KEY = "assembly-request-cases-v1";

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (character === '"') {
      if (quoted && next === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
  );
}

export async function loadCsv(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}을 읽지 못했습니다 (${response.status})`);
  return parseCsv(await response.text());
}

export async function loadReferenceData() {
  const [departments, rules] = await Promise.all([
    loadCsv("./data/A부_조직도_26개과.csv"),
    loadCsv("./data/배분기준표_소관키워드_304건.csv"),
  ]);
  return { departments, rules };
}

export function getCases() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function saveCases(cases) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cases));
  window.dispatchEvent(new CustomEvent("cases-updated", { detail: cases }));
}

export function caseId(item) {
  return `${item.파일명}::${item.문항번호}`;
}

export function registerCases(items) {
  const current = getCases();
  const known = new Set(current.map((item) => item.id || caseId(item)));
  const now = new Date().toISOString();
  const additions = [];
  for (const item of items) {
    const id = caseId(item);
    if (known.has(id)) continue;
    additions.push({
      ...item,
      id,
      상태: "접수",
      후보: item.후보 || [],
      주관과: item.주관과 || item.후보?.[0]?.과 || "",
      협조과: item.협조과 || [],
      확정방법: "",
      로그: [{ 일시: now, 작업: "접수", 문항: `${item.의원}-${item.문항번호}` }],
    });
    known.add(id);
  }
  saveCases([...current, ...additions]);
  return { added: additions.length, skipped: items.length - additions.length };
}

function normalize(text) {
  return String(text || "").toLocaleLowerCase("ko-KR").replace(/\s+/g, " ").trim();
}

export function rankCandidates(requirement, rules, departments) {
  const text = normalize(requirement);
  const allowed = new Set(departments.map((row) => row.과));
  const scores = new Map();
  for (const rule of rules) {
    const keyword = normalize(rule.키워드);
    const exclusions = String(rule.제외어 || "")
      .split("|")
      .map(normalize)
      .filter(Boolean);
    if (!keyword || !text.includes(keyword) || exclusions.some((word) => text.includes(word))) continue;
    if (!allowed.has(rule.과)) continue;
    const previous = scores.get(rule.과) || { 과: rule.과, 우선순위: 0, 길이: 0, 키워드: [] };
    previous.우선순위 = Math.max(previous.우선순위, Number(rule.우선순위) || 0);
    previous.길이 = Math.max(previous.길이, keyword.length);
    if (!previous.키워드.includes(rule.키워드)) previous.키워드.push(rule.키워드);
    scores.set(rule.과, previous);
  }
  return [...scores.values()]
    .sort((a, b) => b.우선순위 - a.우선순위 || b.길이 - a.길이 || a.과.localeCompare(b.과, "ko"))
    .slice(0, 3)
    .map((item, index) => ({
      순위: index + 1,
      과: item.과,
      근거: `키워드 ${item.키워드.join("·")} · 우선순위 ${item.우선순위}`,
    }));
}

export function confirmAssignment(id, mainDepartment, supportingDepartments, candidates) {
  const cases = getCases();
  const target = cases.find((item) => item.id === id);
  if (!target) throw new Error("확정할 문항을 찾지 못했습니다.");
  const before = { 상태: target.상태, 주관과: target.주관과, 협조과: target.협조과 || [] };
  const method = candidates[0]?.과 === mainDepartment ? "규칙" : "수정";
  target.상태 = "배분확정";
  target.주관과 = mainDepartment;
  target.협조과 = supportingDepartments.filter((department) => department !== mainDepartment);
  target.확정방법 = method;
  target.후보 = candidates;
  target.로그 = target.로그 || [];
  target.로그.push({
    일시: new Date().toISOString(),
    작업: "배분",
    변경전: before,
    변경후: { 상태: target.상태, 주관과: target.주관과, 협조과: target.협조과 },
    확정방법: method,
  });
  saveCases(cases);
  return target;
}

export function statusCounts(cases = getCases()) {
  const counts = { 전체: cases.length, 접수: 0, 배분확정: 0, 회신중: 0, 회신완료: 0, 확정: 0 };
  for (const item of cases) counts[item.상태] = (counts[item.상태] || 0) + 1;
  return counts;
}

export function showToast(message, type = "success") {
  const old = document.querySelector(".toast");
  if (old) old.remove();
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.setAttribute("role", "status");
  toast.textContent = message;
  document.body.append(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => toast.classList.remove("show"), 2600);
  setTimeout(() => toast.remove(), 3000);
}
