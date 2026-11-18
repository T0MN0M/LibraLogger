// Libra Logger — static file server + REST API for Railway.
// Serves the repo root so cross-folder links like ../../Styles/... keep working.
// API routes (/api/*) are listed in API_ROUTES below (they match ENDPOINTS in
// Application/shared/api.js); their logic lives in backend/.

const http = require("http");
const fs = require("fs");
const path = require("path");
const auth = require("./backend/auth");
const data = require("./backend/data");
const sessions = require("./backend/sessions");
const { getPool, ensureSchema } = require("./backend/db");
const { HttpError } = require("./backend/errors");
const db = require("./db");

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
const BLOCKED = [/^\/\./, /\/\./, /^\/node_modules\b/, /^\/server\.js$/, /^\/db\.js$/i, /^\/backend\b/i, /^\/package(-lock)?\.json$/, /\.sql$/i];

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

function sendJSON(res, status, data) {
  send(res, status, JSON.stringify(data), "application/json; charset=utf-8");
}

const MAX_BODY_BYTES = 1024 * 1024; // room for a resized profile picture

function readJSONBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, "Request too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new HttpError(400, "Invalid JSON."));
      }
    });
    req.on("error", reject);
  });
}

// [method, path, handler, options]. ":id" in a path becomes ctx.params.id.
// Routes need a logged-in user unless options.public is true; handlers get
// ctx.user_ID from the session cookie. A handler returning null sends 204.
const API_ROUTES = [
  ["POST", "/api/auth/register", auth.register, { public: true, status: 201 }],
  ["POST", "/api/auth/login", auth.login, { public: true }],
  ["POST", "/api/auth/logout", auth.logout, { public: true }],
  ["POST", "/api/auth/password", auth.changePassword],
  ["GET", "/api/profile", data.getProfile],
  ["PATCH", "/api/profile", data.updateProfile],
  ["GET", "/api/budget", data.getBudget],
  ["PUT", "/api/budget", data.setBudget],
  ["GET", "/api/purchases", data.getTransactions],
  ["POST", "/api/purchases", data.addTransaction, { status: 201 }],
  ["PATCH", "/api/purchases/:id", data.editTransaction],
  ["DELETE", "/api/purchases/:id", data.removeTransaction],
  ["GET", "/api/categories", data.getCategories],
  ["GET", "/api/streak", data.getStreak],
  ["GET", "/api/resources", data.getResources, { public: true }],
  ["POST", "/api/user/reset", data.resetUserData],
  ["DELETE", "/api/user", data.deleteAccount],
  ["GET", "/api/version", data.getAppVersion, { public: true }],
].map(([method, pattern, handler, options = {}]) => ({
  method,
  handler,
  options,
  regex: new RegExp("^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$"),
}));

function matchRoute(method, urlPath) {
  let pathMatched = false;
  for (const route of API_ROUTES) {
    const m = route.regex.exec(urlPath);
    if (!m) continue;
    pathMatched = true;
    if (route.method === method) return { route, params: m.groups || {} };
  }
  throw new HttpError(pathMatched ? 405 : 404, pathMatched ? "Method not allowed." : "Not found.");
}

async function handleAPI(req, res, url) {
  const cookies = [];
  try {
    const { route, params } = matchRoute(req.method, url.pathname);

    const hasBody = Number(req.headers["content-length"] || 0) > 0 || req.headers["transfer-encoding"];
    if (hasBody && !/^application\/json\b/i.test(req.headers["content-type"] || ""))
      throw new HttpError(415, "Expected application/json.");
    const body = hasBody ? await readJSONBody(req) : {};
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Invalid request.");

    let user_ID = null;
    if (!route.options.public) {
      const pool = getPool();
      if (!pool) throw new HttpError(503, "The server's database isn't configured right now. Please try again later.");
      user_ID = await sessions.userFromRequest(pool, req);
      if (!user_ID) throw new HttpError(401, "Please log in.");
    }

    const ctx = {
      req,
      body,
      params,
      query: Object.fromEntries(url.searchParams),
      user_ID,
      setCookie: (c) => cookies.push(c),
    };
    const result = await route.handler(ctx);
    if (cookies.length) res.setHeader("Set-Cookie", cookies);
    if (result === null || result === undefined) {
      res.writeHead(204);
      return res.end();
    }
    sendJSON(res, route.options.status || 200, result);
  } catch (err) {
    if (cookies.length) res.setHeader("Set-Cookie", cookies);
    if (err instanceof HttpError) return sendJSON(res, err.status, { error: err.message });
    console.error(`${req.method} ${url.pathname} failed:`, err);
    sendJSON(res, 500, { error: "Something went wrong. Please try again." });
  }
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store"); // per-user data: never cache
    let url;
    try {
      url = new URL(req.url, "http://localhost");
    } catch {
      return sendJSON(res, 400, { error: "Bad request." });
    }
    return handleAPI(req, res, url);
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
  ensureSchema().catch((err) => console.error("Could not apply Database/schema.sql:", err.message));
});
