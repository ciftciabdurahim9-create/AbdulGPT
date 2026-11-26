
const express = require("express");
const crypto = require("crypto");
const net = require("net");

const router = express.Router();
function istemciIp(req) {
  const forwarded = req.headers["x-forwarded-for"];

  if (typeof forwarded === "string") {
    const ip = forwarded.split(",")[0].trim();

    if (net.isIP(ip)) {
      return ip;
    }
  }

  return req.socket?.remoteAddress || "Bilinmiyor";
}

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const logs = [];
const sessions = new Map();
const loginAttempts = new Map();

const MAX_LOGS = 1000;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_MS = 30 * 60 * 1000;

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest();
}

function passwordMatches(value) {
  return crypto.timingSafeEqual(
    hash(value || ""),
    hash(ADMIN_PASSWORD)
  );
}

function cleanOldLogs() {
  const limit = Date.now() - RETENTION_MS;

  while (logs.length && logs[0].time < limit) {
    logs.shift();
  }

  if (logs.length > MAX_LOGS) {
    logs.splice(0, logs.length - MAX_LOGS);
  }
}

function logMiddleware(req, res, next) {
  const p = req.path || "";

  // Yönetici paneli ve API'si ziyaret kaydına girmez.
  if (
    req.method === "GET" &&
    p !== "/admin.html" &&
    (p === "/" || /\.html$/i.test(p))
  ) {
    logs.push({
      ip: istemciIp(req),
      time: Date.now(),
      page: p,
      browser: String(req.headers["user-agent"] || "Bilinmiyor").slice(0, 300)
    });

    cleanOldLogs();
  }

  next();
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : "";

  const expires = sessions.get(token);

  if (!expires || expires < Date.now()) {
    sessions.delete(token);
    return res.status(401).json({ hata: "Oturum sona erdi. Tekrar giriş yap." });
  }

  next();
}

router.post("/login", (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({
      hata: "Render ortam değişkenlerinde ADMIN_PASSWORD tanımlanmamış."
    });
  }

  const ip = istemciIp(req);
  const attempt = loginAttempts.get(ip) || {
    count: 0,
    until: Date.now() + 60_000
  };

  if (attempt.until < Date.now()) {
    attempt.count = 0;
    attempt.until = Date.now() + 60_000;
  }

  if (attempt.count >= 5) {
    return res.status(429).json({
      hata: "Çok fazla giriş denemesi. Bir dakika bekle."
    });
  }

  attempt.count++;
  loginAttempts.set(ip, attempt);

  if (!passwordMatches(req.body?.password)) {
    return res.status(401).json({ hata: "Şifre yanlış." });
  }

  loginAttempts.delete(ip);

  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, Date.now() + SESSION_MS);

  res.json({
    ok: true,
    token,
    expiresIn: SESSION_MS
  });
});

router.get("/logs", auth, (req, res) => {
  cleanOldLogs();

  res.json({
    logs: [...logs].reverse(),
    count: logs.length
  });
});

router.post("/logout", auth, (req, res) => {
  const token = (req.headers.authorization || "").slice(7);
  sessions.delete(token);
  res.json({ ok: true });
});

// Süresi dolan oturumları ve eski giriş denemelerini temizle.
setInterval(() => {
  const now = Date.now();

  for (const [token, expires] of sessions) {
    if (expires < now) sessions.delete(token);
  }

  for (const [ip, attempt] of loginAttempts) {
    if (attempt.until < now) loginAttempts.delete(ip);
  }

  cleanOldLogs();
}, 60_000).unref();

module.exports = {
  router,
  logMiddleware
};
           
