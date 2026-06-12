// Minimal static file server for the Asterisk WebRTC test client.
// Run with:  bun run docker/asterisk/test-client/server.mjs
// Then open: http://localhost:8080
//
// Serving from http://localhost is a "secure context", so browsers allow
// microphone access (getUserMedia) and plain ws:// signaling — no TLS needed.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent((req.url || "/").split("?")[0]);
    if (path === "/") path = "/index.html";
    // Prevent path traversal.
    const filePath = normalize(join(__dirname, path));
    if (!filePath.startsWith(__dirname)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    const data = await readFile(filePath);
    const ext = filePath.slice(filePath.lastIndexOf("."));
    res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`Asterisk WebRTC test client → http://localhost:${PORT}`);
});
