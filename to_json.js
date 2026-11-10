const fs = require("node:fs");
const path = require("node:path");

const inputPath = path.join(__dirname, "data", "A부_조직도_26개과.csv");
const outputPath = path.join(__dirname, "org.json");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

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
      if (character === "\r" && next === "\n") {
        index += 1;
      }
      row.push(field);
      if (row.some((value) => value !== "")) {
        rows.push(row);
      }
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const csvText = fs.readFileSync(inputPath, "utf8").replace(/^\uFEFF/, "");
const [headers, ...dataRows] = parseCsv(csvText);
const columnIndex = Object.fromEntries(headers.map((header, index) => [header, index]));

for (const required of ["실국", "과", "대표키워드"]) {
  if (!(required in columnIndex)) {
    throw new Error(`필수 열이 없습니다: ${required}`);
  }
}

const organizations = dataRows.map((row) => ({
  실국: row[columnIndex["실국"]].trim(),
  과: row[columnIndex["과"]].trim(),
  대표키워드: row[columnIndex["대표키워드"]]
    .split("|")
    .map((keyword) => keyword.trim())
    .filter(Boolean),
}));

fs.writeFileSync(outputPath, `${JSON.stringify(organizations, null, 2)}\n`, "utf8");

console.log(`원소 수: ${organizations.length}`);
console.log("첫 원소:");
console.log(JSON.stringify(organizations[0], null, 2));
