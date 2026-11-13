// Libra Logger — static file server for Railway.
// Serves the repo root so cross-folder links like ../../Styles/... keep working.
// No dependencies: uses only Node's built-in modules.
//
// Later, when the MySQL backend is built, add the /api/* routes from
// Application/shared/api.js (ENDPOINTS) here.

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000; // Railway sets PORT automatically
const ROOT = __dirname;
const HOME_PAGE = "/Application/Login_Page/login.html"; // where "/" redirects

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".otf": "font/otf",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

// Never serve these (secrets, git internals, server code).
const BLOCKED = [/^\/\./, /\/\./, /^\/node_modules\b/, /^\/server\.js$/, /^\/package(-lock)?\.json$/, /\.sql$/i];

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method Not Allowed");

  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    return send(res, 400, "Bad Request");
  }

  if (urlPath === "/health") return send(res, 200, "ok");
  if (urlPath === "/") {
    res.writeHead(302, { Location: HOME_PAGE });
    return res.end();
  }
  if (BLOCKED.some((re) => re.test(urlPath))) return send(res, 404, "Not Found");

  let filePath = path.join(ROOT, urlPath);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) return send(res, 403, "Forbidden");

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) {
      if (!urlPath.endsWith("/")) {
        res.writeHead(301, { Location: urlPath + "/" });
        return res.end();
      }
      filePath = path.join(filePath, "index.html");
    }
    fs.readFile(filePath, (readErr, data) => {
      if (readErr) return send(res, 404, "Not Found");
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
        "Content-Length": data.length,
      });
      res.end(req.method === "HEAD" ? undefined : data);
    });
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Libra Logger running on port ${PORT}`);
});
