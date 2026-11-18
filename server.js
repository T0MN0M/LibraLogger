// Libra Logger — static file server + REST API for Railway.
// Serves the repo root so cross-folder links like ../../Styles/... keep working.
// API routes (/api/*) are listed in API_ROUTES below; their logic lives in backend/.
// As more endpoints from Application/shared/api.js (ENDPOINTS) are built, add them here.

const http = require("http");
const fs = require("fs");
const path = require("path");
const auth = require("./backend/auth");

const PORT = process.env.PORT || 3000; // Railway sets PORT automatically
const ROOT = __dirname;
const HOME_PAGE = "/Application/Registration_Page/registration.html"; // where "/" redirects

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
const BLOCKED = [/^\/\./, /\/\./, /^\/node_modules\b/, /^\/server\.js$/, /^\/backend\b/i, /^\/package(-lock)?\.json$/, /\.sql$/i];

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

function sendJSON(res, status, data) {
  send(res, status, JSON.stringify(data), "application/json; charset=utf-8");
}

const MAX_BODY_BYTES = 16 * 1024;

function readJSONBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new auth.HttpError(413, "Request too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new auth.HttpError(400, "Invalid JSON."));
      }
    });
    req.on("error", reject);
  });
}

// "METHOD /path" -> async handler(body) returning [status, json]
const API_ROUTES = {
  "POST /api/auth/register": async (body) => [201, await auth.register(body)],
};

async function handleAPI(req, res, urlPath) {
  const handler = API_ROUTES[`${req.method} ${urlPath}`];
  if (!handler) return sendJSON(res, 404, { error: "Not found." });
  if (!/^application\/json\b/i.test(req.headers["content-type"] || ""))
    return sendJSON(res, 415, { error: "Expected application/json." });
  try {
    const [status, data] = await handler(await readJSONBody(req));
    sendJSON(res, status, data);
  } catch (err) {
    if (err instanceof auth.HttpError) return sendJSON(res, err.status, { error: err.message });
    console.error(`${req.method} ${urlPath} failed:`, err);
    sendJSON(res, 500, { error: "Something went wrong. Please try again." });
  }
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    let apiPath;
    try {
      apiPath = new URL(req.url, "http://localhost").pathname;
    } catch {
      return sendJSON(res, 400, { error: "Bad request." });
    }
    return handleAPI(req, res, apiPath);
  }

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
