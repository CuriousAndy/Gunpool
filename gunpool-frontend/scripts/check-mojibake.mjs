import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const TARGET_DIRS = ["app", "src/components"];
const TARGET_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".css", ".md"]);

const KEY_FILES = [
  "app/page.tsx",
  "app/console/page.tsx",
  "app/apy/page.tsx",
  "app/history/page.tsx",
  "app/principle/page.tsx",
  "src/components/ui/home-insights-section.tsx",
  "src/components/layout/public-layout.tsx",
  "src/components/layout/console-layout.tsx",
  "src/components/ui/wallet-menu.tsx",
  "src/components/ui/action-panel.tsx",
];

const CP1252_SPECIALS = new Map([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f],
]);

const CJK_PUNCT = new Set([
  0x3001,
  0x3002,
  0xff0c,
  0xff1b,
  0xff1a,
  0xff01,
  0xff1f,
  0xff08,
  0xff09,
  0x3010,
  0x3011,
  0x300a,
  0x300b,
  0x201c,
  0x201d,
  0x2018,
  0x2019,
  0x2192,
  0x00b7,
]);

function walk(dir) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out = out.concat(walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function isCandidateCodePoint(cp) {
  return (cp >= 0x80 && cp <= 0x024f) || CP1252_SPECIALS.has(cp);
}

function toCp1252Byte(cp) {
  if (cp <= 0xff) return cp;
  return CP1252_SPECIALS.get(cp) ?? null;
}

function hasHanOrCjkPunct(text) {
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if ((cp >= 0x4e00 && cp <= 0x9fff) || CJK_PUNCT.has(cp)) {
      return true;
    }
  }
  return false;
}

function findMojibakeRuns(content) {
  const findings = [];
  let i = 0;

  while (i < content.length) {
    const cp = content.codePointAt(i);
    const step = cp > 0xffff ? 2 : 1;

    if (!isCandidateCodePoint(cp)) {
      i += step;
      continue;
    }

    let j = i;
    const bytes = [];

    while (j < content.length) {
      const cp2 = content.codePointAt(j);
      const step2 = cp2 > 0xffff ? 2 : 1;
      if (!isCandidateCodePoint(cp2)) break;
      const b = toCp1252Byte(cp2);
      if (b === null) break;
      bytes.push(b);
      j += step2;
    }

    if (bytes.length >= 2) {
      const raw = content.slice(i, j);
      const decoded = Buffer.from(bytes).toString("utf8");
      if (decoded !== raw && !decoded.includes("�") && hasHanOrCjkPunct(decoded)) {
        findings.push({ raw, decoded, index: i });
      }
    }

    i = j > i ? j : i + step;
  }

  return findings;
}

function countHan(content) {
  const hits = content.match(/\p{Script=Han}/gu);
  return hits ? hits.length : 0;
}

const files = TARGET_DIRS
  .filter((dir) => fs.existsSync(path.join(ROOT, dir)))
  .flatMap((dir) => walk(path.join(ROOT, dir)))
  .filter((file) => TARGET_EXTS.has(path.extname(file)));

let hasError = false;

for (const abs of files) {
  const rel = path.relative(ROOT, abs).replaceAll("\\", "/");
  const raw = fs.readFileSync(abs);
  if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    hasError = true;
    console.error(`[encoding] ${rel} has UTF-8 BOM; expected UTF-8 without BOM`);
  }

  const content = raw.toString("utf8");
  const findings = findMojibakeRuns(content);
  if (findings.length > 0) {
    hasError = true;
    console.error(`[mojibake] ${rel} (${findings.length})`);
    for (const item of findings.slice(0, 3)) {
      console.error(`  raw=${JSON.stringify(item.raw)} -> decoded=${JSON.stringify(item.decoded)}`);
    }
  }
}

for (const rel of KEY_FILES) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    hasError = true;
    console.error(`[missing] key file not found: ${rel}`);
    continue;
  }
  const content = fs.readFileSync(abs, "utf8");
  const han = countHan(content);
  if (han < 20) {
    hasError = true;
    console.error(`[han-check] ${rel} has too few Chinese characters (${han})`);
  }
}

if (hasError) {
  console.error("Text quality check failed.");
  process.exit(1);
}

console.log(`check:text passed (${files.length} files scanned)`);
