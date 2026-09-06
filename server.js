// server.js
// TrackNow-Lite: a small affiliate-tracking + support-ticket simulator.
//
// Built with zero external dependencies (Node's built-in http + node:sqlite)
// so it runs immediately with `node server.js` — no npm install required.
//
// Endpoints:
//   GET    /api/affiliates              list affiliates
//   POST   /api/clicks                  register an affiliate click -> tracking_id
//   POST   /api/webhook/conversion      simulate a merchant's conversion webhook
//   GET    /api/stats                   aggregate performance per affiliate
//   GET    /api/tickets                 list support tickets
//   PATCH  /api/tickets/:id             update a ticket's status
//
// Static dashboard is served from /public.

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const db = require("./db/database");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

// ---------- helpers ----------

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = "";
    req.on("data", (chunk) => (chunks += chunk));
    req.on("end", () => {
      if (!chunks) return resolve({});
      try {
        resolve(JSON.parse(chunks));
      } catch (err) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(req, res) {
  let filePath = req.url === "/" ? "/index.html" : req.url;
  filePath = path.join(PUBLIC_DIR, filePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found");
    }
    const ext = path.extname(filePath);
    const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function createTicket({ tracking_id, subject, details, priority = "normal" }) {
  const stmt = db.prepare(`
    INSERT INTO tickets (tracking_id, subject, details, priority)
    VALUES (?, ?, ?, ?)
  `);
  const info = stmt.run(tracking_id || null, subject, details || null, priority);
  return db.prepare("SELECT * FROM tickets WHERE id = ?").get(info.lastInsertRowid);
}

// ---------- route handlers ----------

async function handleCreateClick(req, res) {
  const body = await readBody(req);
  const { affiliate_id, target_url } = body;

  if (!affiliate_id || !target_url) {
    return sendJson(res, 400, { error: "affiliate_id and target_url are required" });
  }

  const affiliate = db.prepare("SELECT * FROM affiliates WHERE id = ?").get(affiliate_id);
  if (!affiliate) {
    return sendJson(res, 404, { error: `No affiliate with id ${affiliate_id}` });
  }

  const tracking_id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO clicks (tracking_id, affiliate_id, target_url)
    VALUES (?, ?, ?)
  `).run(tracking_id, affiliate_id, target_url);

  sendJson(res, 201, {
    tracking_id,
    redirect_url: `${target_url}${target_url.includes("?") ? "&" : "?"}tn_ref=${tracking_id}`,
  });
}

async function handleConversionWebhook(req, res) {
  const body = await readBody(req);
  const { tracking_id, order_id, amount } = body;

  if (!tracking_id || !order_id || amount === undefined) {
    return sendJson(res, 400, { error: "tracking_id, order_id and amount are required" });
  }

  const click = db.prepare("SELECT * FROM clicks WHERE tracking_id = ?").get(tracking_id);

  if (!click) {
    // This is the "integration failure" path: a merchant's site fired a
    // conversion webhook that references a tracking_id we've never seen —
    // e.g. the merchant's integration is misconfigured, or the click
    // expired. Instead of silently dropping it, auto-open a support ticket
    // so a Customer Success Engineer can follow up with the client.
    const ticket = createTicket({
      tracking_id,
      subject: `Unmatched conversion webhook (tracking_id: ${tracking_id})`,
      details: `Received a conversion for order ${order_id} ($${amount}) referencing an unknown tracking_id. Likely causes: expired click, tracking script misconfigured on the client's checkout page, or a tampered tracking parameter. Needs follow-up with the client's integration team.`,
      priority: "high",
    });
    return sendJson(res, 202, {
      status: "ticket_created",
      message: "tracking_id not recognized — a support ticket was opened automatically",
      ticket,
    });
  }

  db.prepare(`
    INSERT INTO conversions (tracking_id, order_id, amount)
    VALUES (?, ?, ?)
  `).run(tracking_id, order_id, amount);

  sendJson(res, 201, { status: "conversion_recorded", tracking_id, order_id, amount });
}

function handleStats(req, res) {
  const rows = db.prepare(`
    SELECT
      a.id AS affiliate_id,
      a.name AS affiliate_name,
      COUNT(DISTINCT c.id) AS clicks,
      COUNT(DISTINCT v.id) AS conversions,
      COALESCE(SUM(v.amount), 0) AS revenue
    FROM affiliates a
    LEFT JOIN clicks c ON c.affiliate_id = a.id
    LEFT JOIN conversions v ON v.tracking_id = c.tracking_id
    GROUP BY a.id
    ORDER BY revenue DESC
  `).all();

  const stats = rows.map((r) => ({
    ...r,
    conversion_rate: r.clicks > 0 ? +((r.conversions / r.clicks) * 100).toFixed(1) : 0,
  }));

  sendJson(res, 200, stats);
}

function handleListAffiliates(req, res) {
  sendJson(res, 200, db.prepare("SELECT * FROM affiliates").all());
}

function handleListTickets(req, res) {
  sendJson(res, 200, db.prepare("SELECT * FROM tickets ORDER BY created_at DESC").all());
}

async function handleUpdateTicket(req, res, ticketId) {
  const body = await readBody(req);
  const { status } = body;
  const allowed = ["open", "in_progress", "resolved"];

  if (!allowed.includes(status)) {
    return sendJson(res, 400, { error: `status must be one of: ${allowed.join(", ")}` });
  }

  const existing = db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticketId);
  if (!existing) {
    return sendJson(res, 404, { error: `No ticket with id ${ticketId}` });
  }

  db.prepare(`
    UPDATE tickets SET status = ?, updated_at = datetime('now') WHERE id = ?
  `).run(status, ticketId);

  sendJson(res, 200, db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticketId));
}

// ---------- router ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;
  const method = req.method;

  try {
    if (method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      return res.end();
    }

    if (pathname === "/api/affiliates" && method === "GET") {
      return handleListAffiliates(req, res);
    }
    if (pathname === "/api/clicks" && method === "POST") {
      return await handleCreateClick(req, res);
    }
    if (pathname === "/api/webhook/conversion" && method === "POST") {
      return await handleConversionWebhook(req, res);
    }
    if (pathname === "/api/stats" && method === "GET") {
      return handleStats(req, res);
    }
    if (pathname === "/api/tickets" && method === "GET") {
      return handleListTickets(req, res);
    }
    const ticketMatch = pathname.match(/^\/api\/tickets\/(\d+)$/);
    if (ticketMatch && method === "PATCH") {
      return await handleUpdateTicket(req, res, Number(ticketMatch[1]));
    }

    if (pathname.startsWith("/api/")) {
      return sendJson(res, 404, { error: "Unknown API route" });
    }

    return serveStatic(req, res);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err.message || "Internal server error" });
  }
});

server.listen(PORT, () => {
  console.log(`TrackNow-Lite running at http://localhost:${PORT}`);
});
