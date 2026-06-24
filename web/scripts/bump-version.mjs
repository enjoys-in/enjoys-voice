// Bumps the patch version in web/package.json.
//
// Run by the git pre-commit hook (.githooks/pre-commit) whenever a commit
// touches the web app, so the version shown in the UI footer always reflects
// the latest change. Dependency-free (Node only) to match the rest of scripts/.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(here, "..", "package.json");

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

const [major, minor, patch] = String(pkg.version ?? "0.0.0")
  .split(".")
  .map((n) => parseInt(n, 10) || 0);
pkg.version = `${major}.${minor}.${patch + 1}`;

// Keep 2-space indentation + a trailing newline to match the existing file.
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log(`web version -> ${pkg.version}`);
