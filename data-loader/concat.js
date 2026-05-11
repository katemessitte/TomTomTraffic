const fs = require("fs");
const path = require("path");

const INPUT_DIR = path.join(__dirname, "data");
const OUTPUT_FILE = path.join(__dirname, "..", "data", "history.csv");

const files = fs.readdirSync(INPUT_DIR)
  .filter(f => f.endsWith(".csv") && !f.includes("-error"))
  .sort();

if (!files.length) {
  console.error("No valid CSV files found in", INPUT_DIR);
  process.exit(1);
}

let referenceHeader = null;
const outputLines = [];

for (const file of files) {
  const filePath = path.join(INPUT_DIR, file);
  const lines = fs.readFileSync(filePath, "utf8").trim().split(/\r?\n/);

  if (lines.length < 2) {
    console.warn(`Skipping ${file}: no data rows.`);
    continue;
  }

  const header = lines[0];

  if (referenceHeader === null) {
    referenceHeader = header;
    outputLines.push("id," + header + ",congestionPercent");
  } else if (header !== referenceHeader) {
    console.error(`Header mismatch in ${file}:\n  expected: ${referenceHeader}\n  got:      ${header}`);
    process.exit(1);
  }

  const cols = header.split(",");
  const latIndex = cols.indexOf("lat");
  const lonIndex = cols.indexOf("lon");
  const speedRatioIndex = cols.indexOf("speed_ratio");

  if (latIndex === -1 || lonIndex === -1) {
    console.error(`File ${file} is missing lat or lon column.`);
    process.exit(1);
  }

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const parts = line.split(",");
    const id = `${parts[latIndex]} ${parts[lonIndex]}`;
    const speedRatio = speedRatioIndex !== -1 ? Number(parts[speedRatioIndex]) : 0;
    const congestionPercent = (speedRatio * 100).toFixed(2);
    outputLines.push(`${id},${line},${congestionPercent}`);
  }

  console.log(`  + ${file} (${lines.length - 1} rows)`);
}

fs.writeFileSync(OUTPUT_FILE, outputLines.join("\n") + "\n", "utf8");
console.log(`\nWrote ${outputLines.length - 1} data rows to ${OUTPUT_FILE}`);
