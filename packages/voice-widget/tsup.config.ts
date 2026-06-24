import { defineConfig } from "tsup";

// Two build targets:
//  1. The npm library (ESM + CJS + types) — entry src/index.ts.
//  2. A self-initializing IIFE bundle for the one-line <script> embed — entry
//     src/embed.ts, output dist/widget.js. `build:cdn` copies it into the web
//     app's public/ so it's served at https://<domain>/widget.js.
export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: false,
    clean: true,
    target: "es2019",
    outExtension({ format }) {
      return { js: format === "cjs" ? ".cjs" : ".js" };
    },
  },
  {
    entry: { widget: "src/embed.ts" },
    format: ["iife"],
    globalName: "EnjoysVoiceWidget",
    minify: true,
    sourcemap: false,
    target: "es2019",
    outExtension() {
      return { js: ".js" };
    },
  },
]);
