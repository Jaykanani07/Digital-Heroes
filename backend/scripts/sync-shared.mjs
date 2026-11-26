// Copies the shared pricing + design engine to the frontend so both sides run identical code.
import fs from "node:fs";
import path from "node:path";
const src = path.resolve("src/shared");
const dest = path.resolve("../frontend/src/shared");
fs.mkdirSync(dest, { recursive: true });
for (const f of fs.readdirSync(src)) {
  fs.copyFileSync(path.join(src, f), path.join(dest, f));
  console.log(`synced ${f}`);
}
