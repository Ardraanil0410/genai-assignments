"use strict";

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = __dirname;
const MAX_REQUEST_BYTES = 16 * 1024;
const REQUEST_TIMEOUT_MS = 120_000;
const PORT = Number(process.env.PORT || 4173);
const MODE = process.env.N8N_WEBHOOK_MODE || "active";
const BASE_URL = process.env.N8N_BASE_URL || "http://localhost:5678";

function configuredWebhookUrl() {
  if (MODE !== "active" && MODE !== "test") {
    throw new Error('N8N_WEBHOOK_MODE must be "active" or "test".');
  }

  const base = new URL(BASE_URL);
  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  if (
    !isLoopback ||
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    (base.pathname !== "/" && base.pathname !== "")
  ) {
    throw new Error("N8N_BASE_URL must be an HTTP(S) localhost URL without a path, credentials, query, or fragment.");
  }

  base.pathname = MODE === "test" ? "/webhook-test/code_reviewer" : "/webhook/code_reviewer";
  return base;
}

let WEBHOOK_URL;
try {
  WEBHOOK_URL = configuredWebhookUrl();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

function validateRawFileUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== "raw.githubusercontent.com" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    return false;
  }

  const segments = url.pathname.split("/").slice(1);
  if (segments.length < 4) {
    return false;
  }

  try {
    return segments.every((segment) => {
      const decoded = decodeURIComponent(segment);
      return (
        decoded.length > 0 &&
        decoded !== "." &&
        decoded !== ".." &&
        !/[\\/\u0000-\u001f\u007f]/.test(decoded) &&
        !/%(?:2f|5c|2e)/i.test(decoded)
      );
    });
  } catch {
    return false;
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let tooLarge = false;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (Buffer.byteLength(body) + Buffer.byteLength(chunk) > MAX_REQUEST_BYTES) {
        tooLarge = true;
      } else if (!tooLarge) {
        body += chunk;
      }
    });
    request.on("end", () => {
      if (tooLarge) {
        reject(Object.assign(new Error("Request body exceeds the allowed size."), { status: 413 }));
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON."), { status: 400 }));
      }
    });
    request.on("error", reject);
  });
}

async function proxyReview(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Use POST for file reviews." }, { Allow: "POST" });
    return;
  }
  const mediaType = request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    sendJson(response, 415, { error: "Content-Type must be application/json." });
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(request);
  } catch (error) {
    sendJson(response, error.status || 400, { error: error.message });
    return;
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    Object.keys(payload).length !== 1 ||
    typeof payload.fileUrl !== "string" ||
    !validateRawFileUrl(payload.fileUrl)
  ) {
    sendJson(response, 400, {
      error: "Provide exactly one property, fileUrl, containing a public raw.githubusercontent.com file URL.",
    });
    return;
  }

  let upstream;
  try {
    upstream = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileUrl: payload.fileUrl }),
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timeout = error.name === "TimeoutError";
    sendJson(response, timeout ? 504 : 502, {
      error: timeout
        ? "The n8n workflow did not respond before the local proxy timed out."
        : `Could not connect to the configured n8n webhook at ${WEBHOOK_URL.origin}.`,
    });
    return;
  }

  let body;
  try {
    body = Buffer.from(await upstream.arrayBuffer());
  } catch (error) {
    console.error("Could not read the n8n response:", error);
    sendJson(response, 502, { error: "Could not read the response from the n8n webhook." });
    return;
  }

  response.writeHead(upstream.status, {
    "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-N8n-Reachable": "true",
  });
  response.end(body);
}

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

async function serveStatic(pathname, response) {
  const files = {
    "/": "index.html",
    "/index.html": "index.html",
    "/styles.css": "styles.css",
    "/app.js": "app.js",
  };
  const fileName = files[pathname];
  if (!fileName) {
    sendJson(response, 404, { error: "Not found." });
    return;
  }

  try {
    const filePath = path.join(ROOT, fileName);
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath)],
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    response.end(content);
  } catch (error) {
    console.error(`Could not serve ${fileName}:`, error);
    sendJson(response, 500, { error: "Could not load the application file." });
  }
}

const server = http.createServer((request, response) => {
  let pathname;
  try {
    pathname = new URL(request.url, "http://127.0.0.1").pathname;
  } catch {
    sendJson(response, 400, { error: "Invalid request URL." });
    return;
  }

  if (pathname === "/api/config") {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Use GET for development configuration." }, { Allow: "GET" });
      return;
    }
    sendJson(response, 200, { mode: MODE });
    return;
  }

  if (pathname === "/api/review") {
    void proxyReview(request, response).catch((error) => {
      console.error("Unexpected review proxy error:", error);
      if (!response.headersSent) {
        sendJson(response, 500, { error: "The local review proxy encountered an unexpected error." });
      } else {
        response.destroy(error);
      }
    });
    return;
  }

  if (pathname.startsWith("/api/")) {
    sendJson(response, 404, { error: "Not found." });
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { error: "Use GET to load application files." }, { Allow: "GET, HEAD" });
    return;
  }
  void serveStatic(pathname, response);
});

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error("PORT must be an integer between 1 and 65535.");
  process.exit(1);
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(`AI CodeReviewer available at http://127.0.0.1:${PORT}`);
  console.log(`n8n webhook mode: ${MODE}`);
});
