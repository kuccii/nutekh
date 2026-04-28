/**
 * Rewrites internal links from about.html → /about (extensionless, absolute-from-root).
 * Skips http(s), mailto, tel, javascript, anchors-only, and paths already starting with /
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function toCleanUrl(inner) {
  if (
    inner.includes("://") ||
    inner.startsWith("mailto:") ||
    inner.startsWith("tel:") ||
    inner.startsWith("javascript:") ||
    inner.startsWith("#") ||
    inner.startsWith("/")
  ) {
    return null;
  }
  let rest = inner;
  let hash = "";
  const hashIdx = rest.indexOf("#");
  if (hashIdx !== -1) {
    hash = rest.slice(hashIdx);
    rest = rest.slice(0, hashIdx);
  }
  if (!rest.endsWith(".html")) return null;
  const stem = rest.slice(0, -5);
  if (stem.includes("/")) return null;
  const cleanPath = stem === "index" ? "/" : `/${stem}`;
  return `${cleanPath}${hash}`;
}

function transform(html) {
  const attrPattern = (attr) =>
    new RegExp(`(${attr})=(["'])((?:(?!\\2).)*?)\\2`, "gs");

  return html.replace(attrPattern("href"), (match, attr, quote, inner) => {
    const u = toCleanUrl(inner);
    return u != null ? `${attr}=${quote}${u}${quote}` : match;
  }).replace(attrPattern("action"), (match, attr, quote, inner) => {
    const u = toCleanUrl(inner);
    return u != null ? `${attr}=${quote}${u}${quote}` : match;
  });
}

const targets = [];

for (const name of fs.readdirSync(root)) {
  if (name.endsWith(".html") && !name.startsWith(".")) {
    targets.push(path.join(root, name));
  }
}

function walkIncludes(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walkIncludes(full);
    else if (name.endsWith(".njk")) targets.push(full);
  }
}
walkIncludes(path.join(root, "_includes"));

let changed = 0;
for (const file of targets) {
  const before = fs.readFileSync(file, "utf8");
  const after = transform(before);
  if (after !== before) {
    fs.writeFileSync(file, after, "utf8");
    changed++;
    console.log("updated:", path.relative(root, file));
  }
}
console.log(`Done. ${changed} file(s) updated.`);
