// Tiny static server for the download page. No dependencies, works with
// both `node website/serve.mjs` and `bun website/serve.mjs`.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT) || 3000;
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
};

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const rel = normalize(path === "/" ? "index.html" : path).replace(
    /^([/\\]|\.\.[/\\])+/,
    "",
  );
  try {
    const body = await readFile(join(root, rel));
    res.writeHead(200, {
      "Content-Type": types[extname(rel)] || "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(port, () => {
  console.log(`Cravin site running at http://localhost:${port}`);
});
