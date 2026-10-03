// Downloads the dcm2niix browser build into vendor/dcm2niix so the viewer can use
// a same-origin Web Worker (cross-origin workers are blocked by browsers).
// Usage: node vendor/fetch-dcm2niix.js
const fs = require("fs");
const path = require("path");

const VERSION = "1.3.20260724";
const BASE = `https://cdn.jsdelivr.net/npm/@niivue/dcm2niix@${VERSION}/dist/`;
const FILES = ["index.js", "worker.js", "dcm2niix.js", "dcm2niix.wasm"];
const OUT = path.join(__dirname, "dcm2niix");

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of FILES) {
    const r = await fetch(BASE + f);
    if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(path.join(OUT, f), buf);
    console.log(`${f} ${buf.length} bytes`);
  }
})().catch(e => { console.error(e); process.exit(1); });
