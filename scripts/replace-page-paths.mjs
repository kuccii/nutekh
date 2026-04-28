/**
 * One-off bulk replace for /page-* routes → short slugs (after renaming source HTML files).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const pairs = [
  ["/page-services", "/services"],
  ["/page-about", "/about"],
  ["/page-contact", "/contact"],
  ["/page-pricing", "/pricing"],
  ["/page-team", "/team"],
  ["/page-faqs", "/faqs"],
];

function walk(dir, acc) {
  for (const name of fs.readdirSync(dir)) {
    if (name === "_site" || name === "node_modules") continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (/\.(html|njk|json|md|xml)$/i.test(name)) acc.push(full);
  }
}

const files = [];
walk(root, files);

let total = 0;
for (const file of files) {
  let s = fs.readFileSync(file, "utf8");
  const before = s;
  for (const [from, to] of pairs) {
    s = s.split(from).join(to);
  }
  if (s !== before) {
    fs.writeFileSync(file, s, "utf8");
    total++;
    console.log("updated:", path.relative(root, file));
  }
}
console.log(`Done. ${total} file(s).`);
