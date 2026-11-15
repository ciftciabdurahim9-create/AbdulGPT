const express = require("express");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.MODEL || "gemini-flash-latest";
const MODEL_GUCLU = process.env.MODEL_GUCLU || "gemini-pro-latest"; // "Derin düşün" için

const ORTAK = " Doğru, net ve dürüst ol; emin olmadığın bir şeyi uydurma, bilmiyorsan söyle. Soru belirsizse varsayımını belirt.";
const MODLAR = {
  genel: "Sen yardımsever, samimi bir Türkçe yapay zeka asistanısın. Kısa ve anlaşılır cevap ver.",
  kodlama: "Sen uzman bir yazılım geliştiricisin. Türkçe açıkla, kodu her zaman markdown kod bloğu içinde ver, kısa ve doğru ol.",
  cevirmen: "Sen profesyonel bir çevirmensin. Kullanıcı Türkçe yazarsa İngilizceye, başka dilde yazarsa Türkçeye çevir. Sadece çeviriyi ver.",
  ozetleyici: "Sen bir özetleme asistanısın. Verilen metni Türkçe, madde madde ve kısa özetle.",
  ders: "Sen sabırlı bir Türkçe öğretmensin (ilkokuldan üniversiteye ders ve ödevler). Soruyu önce kısaca anla, sonra adım adım çöz; adımları numarala ve nedenini açıkla. Sonda net sonucu ver ve cevabı kontrol et. Matematik ve fen formüllerini LaTeX ile yaz: satır içi $...$, ayrı satırda $$...$$."
};
const LATEXSIZ = " Matematik yazarken LaTeX ve dolar işareti ($) kullanma. Formülleri düz metinle yaz, örneğin: sin(30°) = 1/2, x^2, √9, 3 × 4.";
const HATIRLA = " Kullanıcı kendisi hakkında kalıcı bir bilgi paylaşırsa (adı, sınıfı, mesleği, ilgi alanı, tercihi gibi), cevabının EN SONUNA ayrı bir satırda [HATIRLA: kısa bilgi] ekle. Sıradan sorularda ekleme.";

// Render'da SIFRE değişkeni tanımlarsan uygulama şifreli olur (boşsa herkese açık)
const SIFRE = process.env.SIFRE || "";
const ozet = x => crypto.createHash("sha256").update(String(x)).digest();
const sifreTamam = g => !SIFRE || crypto.timingSafeEqual(ozet(g || ""), ozet(SIFRE));

app.use(express.json({ limit: "6mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Hız sınırı: IP başına dakikada 10 istek (ücretsiz kotayı korur)
const sayac = new Map();
setInterval(() => sayac.clear(), 60 * 1000);

app.get("/api/durum", (req, res) => res.json({ sifreli: !!SIFRE }));
app.post("/api/giris", (req, res) => {
  const k = "g" + (req.headers["x-forwarded-for"] || req.ip);
  const n = (sayac.get(k) || 0) + 1;
  sayac.set(k, n);
  if (n > 10) return res.status(429).json({ hata: "Çok fazla deneme, bir dakika bekle." });
  if (sifreTamam(req.body && req.body.sifre)) return res.json({ ok: true });
  res.status(401).json({ hata: "Şifre yanlış." });
});

const IMG_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+\/=]+)$/;
const url = m => `https://generativelanguage.googleapis.com/v1beta/models/${m}:streamGenerateContent?alt=sse`;

app.post("/api/chat", async (req, res) => {
  if (!API_KEY) return res.status(500).json({ hata: "Sunucuda GEMINI_API_KEY tanımlı değil." });

  const ip = req.headers["x-forwarded-for"] || req.ip;
  const n = (sayac.get(ip) || 0) + 1;
  sayac.set(ip, n);
  if (n > 10) return res.status(429).json({ hata: "Çok hızlı gidiyorsun, bir dakika bekle." });

  let gs = "";
  try { gs = decodeURIComponent(req.headers["x-sifre"] || ""); } catch {}
  if (!sifreTamam(gs)) return res.status(401).json({ hata: "Şifre gerekli veya yanlış." });

  const gelen = Array.isArray(req.body.messages) ? req.body.messages.slice(-20) : [];
  let ham = gelen
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map(m => {
      const o = { role: m.role, content: m.content.slice(0, 8000) };
      if (m.role === "user" && typeof m.image === "string" && m.image.length < 4000000) {
        const g = IMG_RE.exec(m.image);
        if (g) o.image = { mimeType: g[1], data: g[2] };
      }
      return o;
    })
    .filter(m => m.content.trim() || m.image);
  while (ham.length && ham[0].role !== "user") ham.shift();
  const messages = [];
  for (const m of ham) {
    const son = messages[messages.length - 1];
    if (son && son.role === m.role) { son.content += "\n" + m.content; if (m.image) son.image = m.image; }
    else messages.push({ ...m });
  }
  if (!messages.length || messages[messages.length - 1].role !== "user")
    return res.status(400).json({ hata: "Geçersiz mesaj." });

  const mod = req.body.mod;
  const profil = typeof req.body.profil === "string" ? req.body.profil.slice(0, 1200).replace(/\s*\n\s*/g, "; ") : "";
  const sistem = (MODLAR[mod] || MODLAR.genel) + ORTAK + (mod === "ders" ? "" : LATEXSIZ) + HATIRLA +
    (profil ? " Kullanıcı hakkında bildiklerin (işine yaradığında doğal biçimde kullan, her seferinde söyleme): " + profil : "");

  const body = {
    systemInstruction: { parts: [{ text: sistem }] },
    contents: messages.map(m => {
      const parts = [{ text: m.content.trim() || "Bu resmi anlat." }];
      if (m.image) parts.push({ inlineData: m.image });
      return { role: m.role === "assistant" ? "model" : "user", parts };
    }),
    generationConfig: { maxOutputTokens: 4000 }
  };
  if (req.body.ara === true) body.tools = [{ google_search: {} }]; // internetten arama

  const ac = new AbortController();
  res.on("close", () => { if (!res.writableEnded) ac.abort(); });

  try {
    const modeller = req.body.derin === true ? [MODEL_GUCLU, MODEL] : [MODEL];
    let r = null, dusuldu = false;
    for (let i = 0; i < modeller.length; i++) {
      r = await fetch(url(modeller[i]), {
        method: "POST", signal: ac.signal,
        headers: { "content-type": "application/json", "x-goog-api-key": API_KEY },
        body: JSON.stringify(body)
      });
      if (r.ok) { dusuldu = i > 0; break; }
      if (![403, 404, 429, 503].includes(r.status)) break; // güçlü model yoksa/doluysa normale düş
    }
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      const detay = (d.error?.message || "").slice(0, 300);
      const msg = r.status === 429 ? "Ücretsiz kota doldu, biraz bekleyip tekrar dene. (Google: " + detay + ")"
        : (detay || "API hatası (" + r.status + ")");
      return res.status(502).json({ hata: msg });
    }

    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const send = o => res.write("data: " + JSON.stringify(o) + "\n\n");
    if (dusuldu) send({ t: "(Derin model şu an kullanılamıyor, normal modelle cevapladım.)\n\n" });

    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      buf = buf.replace(/\r\n/g, "\n");
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const blok = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const satir = blok.split("\n").find(l => l.startsWith("data: "));
        if (!satir) continue;
        let ev;
        try { ev = JSON.parse(satir.slice(6)); } catch { continue; }
        if (ev.promptFeedback?.blockReason) { send({ hata: "Bu istek güvenlik nedeniyle engellendi." }); continue; }
        const parcalar = ev.candidates?.[0]?.content?.parts || [];
        const metin = parcalar.filter(p => p.text && !p.thought).map(p => p.text).join("");
        if (metin) send({ t: metin });
      }
    }
    send({ bitti: true });
    res.end();
  } catch (e) {
    if (res.headersSent) { res.end(); }
    else if (e.name !== "AbortError") res.status(500).json({ hata: "Sunucu hatası: " + e.message });
  }
});

app.listen(PORT, () => console.log("Çalışıyor: " + PORT));
