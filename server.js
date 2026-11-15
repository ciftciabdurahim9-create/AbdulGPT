const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.MODEL || "gemini-flash-latest";

const MODLAR = {
  genel: "Sen yardımsever, samimi bir Türkçe yapay zeka asistanısın. Kısa ve anlaşılır cevap ver.",
  kodlama: "Sen uzman bir yazılım geliştiricisin. Türkçe açıkla, kodu her zaman markdown kod bloğu içinde ver, kısa ve doğru ol.",
  cevirmen: "Sen profesyonel bir çevirmensin. Kullanıcı Türkçe yazarsa İngilizceye, başka dilde yazarsa Türkçeye çevir. Sadece çeviriyi ver.",
  ozetleyici: "Sen bir özetleme asistanısın. Verilen metni Türkçe, madde madde ve kısa özetle."
};

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

// Hız sınırı: IP başına dakikada 10 istek (ücretsiz kotayı korur)
const sayac = new Map();
setInterval(() => sayac.clear(), 60 * 1000);

app.post("/api/chat", async (req, res) => {
  if (!API_KEY) return res.status(500).json({ hata: "Sunucuda GEMINI_API_KEY tanımlı değil." });

  const ip = req.headers["x-forwarded-for"] || req.ip;
  const n = (sayac.get(ip) || 0) + 1;
  sayac.set(ip, n);
  if (n > 10) return res.status(429).json({ hata: "Çok hızlı gidiyorsun, bir dakika bekle." });

  const gelen = Array.isArray(req.body.messages) ? req.body.messages.slice(-20) : [];
  const messages = gelen
    .filter(m => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content)
    .map(m => ({ role: m.role, content: m.content.slice(0, 8000) }));
  if (!messages.length || messages[0].role !== "user" || messages[messages.length - 1].role !== "user")
    return res.status(400).json({ hata: "Geçersiz mesaj." });

  const body = {
    systemInstruction: { parts: [{ text: MODLAR[req.body.mod] || MODLAR.genel }] },
    contents: messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    generationConfig: { maxOutputTokens: 2000 }
  };

  const ac = new AbortController();
  res.on("close", () => { if (!res.writableEnded) ac.abort(); });

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse`;
    const r = await fetch(url, {
      method: "POST",
      signal: ac.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": API_KEY },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      const msg = r.status === 429
        ? "Ücretsiz kota doldu, biraz bekleyip tekrar dene."
        : (d.error?.message || "API hatası (" + r.status + ")");
      return res.status(502).json({ hata: msg });
    }

    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const send = o => res.write("data: " + JSON.stringify(o) + "\n\n");

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
