// Copies the built IIFE bundle (dist/widget.js) into the Next.js web app's
// public/ directory so it is served at https://<domain>/widget.js — the URL the
// dashboard's embed snippet points at. Run via `npm run build:cdn`.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "..", "dist", "widget.js");
const destDir = resolve(here, "..", "..", "..", "web", "public");
const dest = resolve(destDir, "widget.js");

if (!existsSync(src)) {
  console.error(`[copy-cdn] build output not found: ${src}\nRun "npm run build" first.`);
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`[copy-cdn] copied ${src} -> ${dest}`);
