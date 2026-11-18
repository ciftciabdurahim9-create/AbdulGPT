
const express = require("express");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.MODEL || "gemini-flash-latest";
const MODEL_GUCLU = process.env.MODEL_GUCLU || "gemini-pro-latest";

const CF_HESAP = process.env.CLOUDFLARE_ACCOUNT_ID || "";
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CF_MODEL = process.env.CF_GORSEL_MODEL || "@cf/black-forest-labs/flux-1-schnell";
const CF_DUZEN_MODEL = process.env.CF_DUZEN_MODEL || "@cf/black-forest-labs/flux-2-klein-4b";
const GORSEL_GUNLUK = +process.env.GORSEL_GUNLUK || 200;

const ORTAK =
  " Doğru, net ve dürüst ol; emin olmadığın bir şeyi uydurma, bilmiyorsan söyle. " +
  "Güncel bilgi gerekiyorsa internet arama sonuçlarını kullan. " +
  "İnternetten aldığın bilgileri doğru şekilde aktar ve kaynakları belirt.";

const MODLAR = {
  genel: "Sen yardımsever, samimi bir Türkçe yapay zeka asistanısın. Kısa ve anlaşılır cevap ver.",
  kodlama: "Sen uzman bir yazılım geliştiricisin. Türkçe açıkla, kodu her zaman markdown kod bloğu içinde ver, kısa ve doğru ol.",
  cevirmen: "Sen profesyonel bir çevirmensin. Kullanıcı Türkçe yazarsa İngilizceye, başka dilde yazarsa Türkçeye çevir. Sadece çeviriyi ver.",
  ozetleyici: "Sen bir özetleme asistanısın. Verilen metni Türkçe, madde madde ve kısa özetle.",
  ders: "Sen sabırlı bir Türkçe öğretmensin. Soruyu önce kısaca anla, sonra adım adım çöz; nedenini açıkla. Sonda net sonucu ver ve cevabı kontrol et. Matematik ve fen formüllerini LaTeX ile yaz."
};

const LATEXSIZ =
  " Matematik yazarken LaTeX ve dolar işareti ($) kullanma. Formülleri düz metinle yaz, örneğin: sin(30°) = 1/2, x^2, √9, 3 × 4.";

const HATIRLA =
  " Kullanıcı kendisi hakkında kalıcı bir bilgi paylaşırsa (adı, sınıfı, mesleği, ilgi alanı, tercihi gibi), cevabının EN SONUNA ayrı bir satırda [HATIRLA: kısa bilgi] ekle. Sıradan sorularda ekleme.";

const SIFRE = process.env.SIFRE || "";

const ozet = x => crypto.createHash("sha256").update(String(x)).digest();

const sifreTamam = g =>
  !SIFRE || crypto.timingSafeEqual(ozet(g || ""), ozet(SIFRE));

app.use(express.json({ limit: "6mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Hız sınırı
const sayac = new Map();

setInterval(() => sayac.clear(), 60 * 1000).unref();

function limitKontrol(key, max = 10) {
  const n = (sayac.get(key) || 0) + 1;
  sayac.set(key, n);
  return n <= max;
}

// Otomatik internet araması
function internetGerekli(mesaj) {
  const s = mesaj.toLocaleLowerCase("tr-TR");

  const kaliplar = [
    /hava durumu|hava nasıl|yağmur yağacak mı|sıcaklık kaç/,
    /son dakika|güncel haber|bugünkü haber|haberleri/,
    /internette ara|internetten araştır|webde ara/,
    /güncel bilgi|güncel olarak|şu anki|şu anda/,
    /dolar kaç|euro kaç|sterlin kaç|altın fiyat|gram altın/,
    /maç sonucu|canlı skor|puan durumu|fikstür/,
    /en son gelişmeler|son gelişmeler|kaynak göster/,
    /hava tahmini|kaç derece|ne zaman yayınlanacak/,
    /kim kazandı|sonuçları ne|güncel fiyat/,
    /2026 gelişmeleri|2025 gelişmeleri/,
    /bugün.*(hava|haber|maç|fiyat|sonuç)/,
    /yarın.*(hava|maç|etkinlik|sıcaklık)/,
    /son seçim|güncel başkan|güncel yönetici/,
    /yeni çıkan|en yeni|en son çıkan/
  ];

  return kaliplar.some(k => k.test(s));
}

// Sistem durumu
app.get("/api/durum", (req, res) => {
  res.json({
    sifreli: !!SIFRE,
    internetArama: true
  });
});

// Giriş
app.post("/api/giris", (req, res) => {
  const k = "g" + (req.headers["x-forwarded-for"] || req.ip);

  if (!limitKontrol(k, 10)) {
    return res.status(429).json({
      hata: "Çok fazla deneme, bir dakika bekle."
    });
  }

  if (sifreTamam(req.body && req.body.sifre)) {
    return res.json({ ok: true });
  }

  res.status(401).json({ hata: "Şifre yanlış." });
});

const IMG_RE =
  /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+\/=]+)$/;

const url = m =>
  `https://generativelanguage.googleapis.com/v1beta/models/${m}:streamGenerateContent?alt=sse`;

// --------------------------------------------------
// ABDULGPT CHAT + İNTERNET ARAMASI
// --------------------------------------------------

app.post("/api/chat", async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({
      hata: "Sunucuda GEMINI_API_KEY tanımlı değil."
    });
  }

  const ip = req.headers["x-forwarded-for"] || req.ip;

  if (!limitKontrol(ip, 10)) {
    return res.status(429).json({
      hata: "Çok hızlı gidiyorsun, bir dakika bekle."
    });
  }

  let gs = "";

  try {
    gs = decodeURIComponent(req.headers["x-sifre"] || "");
  } catch {}

  if (!sifreTamam(gs)) {
    return res.status(401).json({
      hata: "Şifre gerekli veya yanlış."
    });
  }

  const gelen = Array.isArray(req.body.messages)
    ? req.body.messages.slice(-20)
    : [];

  let ham = gelen
    .filter(m =>
      m &&
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string"
    )
    .map(m => {
      const o = {
        role: m.role,
        content: m.content.slice(0, 8000)
      };

      if (
        m.role === "user" &&
        typeof m.image === "string" &&
        m.image.length < 4000000
      ) {
        const g = IMG_RE.exec(m.image);

        if (g) {
          o.image = {
            mimeType: g[1],
            data: g[2]
          };
        }
      }

      return o;
    })
    .filter(m => m.content.trim() || m.image);

  while (ham.length && ham[0].role !== "user") {
    ham.shift();
  }

  const messages = [];

  for (const m of ham) {
    const son = messages[messages.length - 1];

    if (son && son.role === m.role) {
      son.content += "\n" + m.content;
      if (m.image) son.image = m.image;
    } else {
      messages.push({ ...m });
    }
  }

  if (
    !messages.length ||
    messages[messages.length - 1].role !== "user"
  ) {
    return res.status(400).json({
      hata: "Geçersiz mesaj."
    });
  }

  const mod = req.body.mod;

  const profil =
    typeof req.body.profil === "string"
      ? req.body.profil.slice(0, 1200).replace(/\s*\n\s*/g, "; ")
      : "";

  const sistem =
    (MODLAR[mod] || MODLAR.genel) +
    ORTAK +
    (mod === "ders" ? "" : LATEXSIZ) +
    HATIRLA +
    (profil
      ? " Kullanıcı hakkında bildiklerin (işine yaradığında doğal biçimde kullan): " + profil
      : "");

  const body = {
    systemInstruction: {
      parts: [{ text: sistem }]
    },

    contents: messages.map(m => {
      const parts = [
        { text: m.content.trim() || "Bu resmi anlat." }
      ];

      if (m.image) {
        parts.push({ inlineData: m.image });
      }

      return {
        role: m.role === "assistant" ? "model" : "user",
        parts
      };
    }),

    generationConfig: {
      maxOutputTokens: 4000
    }
  };

  // Otomatik veya manuel internet araması
  const sonMesaj = messages[messages.length - 1].content;

  const ara =
    req.body.ara === true ||
    internetGerekli(sonMesaj);

  if (ara) {
    body.tools = [{ google_search: {} }];
  }

  const ac = new AbortController();

  res.on("close", () => {
    if (!res.writableEnded) ac.abort();
  });

  try {
    const modeller =
      req.body.derin === true
        ? [MODEL_GUCLU, MODEL]
        : [MODEL];

    let r = null;
    let dusuldu = false;

    for (let i = 0; i < modeller.length; i++) {
      r = await fetch(url(modeller[i]), {
        method: "POST",
        signal: ac.signal,
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": API_KEY
        },
        body: JSON.stringify(body)
      });

      if (r.ok) {
        dusuldu = i > 0;
        break;
      }

      if (![403, 404, 429, 503].includes(r.status)) {
        break;
      }
    }

    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      const detay = (d.error?.message || "").slice(0, 300);

      const msg =
        r.status === 429
          ? "Ücretsiz kota doldu, biraz bekleyip tekrar dene. (Google: " + detay + ")"
          : detay || "API hatası (" + r.status + ")";

      return res.status(502).json({ hata: msg });
    }

    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    const send = o => {
      if (!res.destroyed) {
        res.write("data: " + JSON.stringify(o) + "\n\n");
      }
    };

    if (dusuldu) {
      send({
        t: "(Derin model şu an kullanılamıyor, normal modelle cevapladım.)\n\n"
      });
    }

    if (ara) {
      send({ arama: true });
    }

    const reader = r.body.getReader();
    const dec = new TextDecoder();

    let buf = "";
    const kaynaklar = new Map();

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buf += dec.decode(value, { stream: true });
      buf = buf.replace(/\r\n/g, "\n");

      let i;

      while ((i = buf.indexOf("\n\n")) >= 0) {
        const blok = buf.slice(0, i);
        buf = buf.slice(i + 2);

        const satir = blok
          .split("\n")
          .find(l => l.startsWith("data: "));

        if (!satir) continue;

        let ev;

        try {
          ev = JSON.parse(satir.slice(6));
        } catch {
          continue;
        }

        if (ev.promptFeedback?.blockReason) {
          send({
            hata: "Bu istek güvenlik nedeniyle engellendi."
          });
          continue;
        }

        const aday = ev.candidates?.[0];

        // Metni gönder
        const parcalar = aday?.content?.parts || [];

        const metin = parcalar
          .filter(p => p.text && !p.thought)
          .map(p => p.text)
          .join("");

        if (metin) {
          send({ t: metin });
        }

        // Google arama kaynaklarını yakala
        const meta = aday?.groundingMetadata;

        if (meta) {
          const yeniKaynaklar = meta.groundingChunks || [];

          for (const item of yeniKaynaklar) {
            const web = item.web;

            if (web?.uri) {
              kaynaklar.set(web.uri, {
                baslik: web.title || "İnternet kaynağı",
                url: web.uri
              });
            }
          }

          const data = {
            kaynaklar: Array.from(kaynaklar.values()),
            aramaSorgulari: meta.webSearchQueries || []
          };

          // Google'ın arama önerisi HTML içeriği
          if (meta.searchEntryPoint?.renderedContent) {
            data.aramaOnerileriHtml =
              meta.searchEntryPoint.renderedContent;
          }

          send(data);
        }
      }
    }

    send({ bitti: true });
    res.end();

  } catch (e) {
    if (res.headersSent) {
      res.end();
    } else if (e.name !== "AbortError") {
      res.status(500).json({
        hata: "Sunucu hatası: " + e.message
      });
    }
  }
});

// --------------------------------------------------
// GÖRSEL OLUŞTURMA VE DÜZENLEME
// --------------------------------------------------

const gorselSayac = {
  gun: "",
  adet: 0
};

async function gorselIstemi(istem, signal, resim) {
  const SISTEM_YENI =
    "You write prompts for an image generator. Translate the user's request into one vivid English image prompt (max 60 words), adding helpful visual detail (style, lighting, composition) without changing the meaning. Output only the prompt. If the request is sexual, graphically violent, hateful, or shows a real person in a harmful way, output exactly REFUSE.";

  const SISTEM_DUZEN =
    "You write instructions for an image editing model. The user gives an edit request for the attached image. Translate it into one clear English instruction (max 40 words) that describes only the change, and end with: Keep everything else unchanged. Output only the instruction. Output exactly REFUSE if the request or the image involves sexual content, graphic violence, hate, or if the edit could embarrass, sexualize, impersonate or harm a real, identifiable person.";

  try {
    const parts = [{ text: istem }];

    if (resim) {
      parts.push({ inlineData: resim });
    }

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": API_KEY
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: resim ? SISTEM_DUZEN : SISTEM_YENI
            }]
          },
          contents: [{
            role: "user",
            parts
          }],
          generationConfig: {
            maxOutputTokens: 1000
          }
        })
      }
    );

    const v = await r.json().catch(() => ({}));

    const m = (v.candidates?.[0]?.content?.parts || [])
      .filter(p => p.text && !p.thought)
      .map(p => p.text)
      .join("")
      .trim();

    return m || (resim ? "REFUSE" : istem);

  } catch (e) {
    if (e.name === "AbortError") throw e;
    return resim ? "REFUSE" : istem;
  }
}

app.post("/api/gorsel", async (req, res) => {
  if (!CF_HESAP || !CF_TOKEN) {
    return res.status(500).json({
      hata: "Sunucuda CLOUDFLARE_ACCOUNT_ID ve CLOUDFLARE_API_TOKEN tanımlı değil."
    });
  }

  let gs = "";

  try {
    gs = decodeURIComponent(req.headers["x-sifre"] || "");
  } catch {}

  if (!sifreTamam(gs)) {
    return res.status(401).json({
      hata: "Şifre gerekli veya yanlış."
    });
  }

  const k = "r" + (req.headers["x-forwarded-for"] || req.ip);

  if (!limitKontrol(k, 4)) {
    return res.status(429).json({
      hata: "Çok hızlı gidiyorsun, bir dakika bekle."
    });
  }

  const istem = req.body && req.body.istem;

  if (
    !istem ||
    typeof istem !== "string" ||
    !istem.trim() ||
    istem.length > 800
  ) {
    return res.status(400).json({
      hata: "İstem boş ya da çok uzun (en fazla 800 karakter)."
    });
  }

  let resim = null;
  const kaynak = req.body.kaynak;

  if (kaynak !== undefined && kaynak !== null) {
    const g =
      typeof kaynak === "string" && kaynak.length < 1500000
        ? IMG_RE.exec(kaynak)
        : null;

    if (!g) {
      return res.status(400).json({
        hata: "Düzenlenecek görsel geçersiz."
      });
    }

    resim = {
      mimeType: g[1],
      data: g[2]
    };
  }

  const agirlik = resim ? 3 : 1;

  const bugun = new Date().toISOString().slice(0, 10);

  if (gorselSayac.gun !== bugun) {
    gorselSayac.gun = bugun;
    gorselSayac.adet = 0;
  }

  if (gorselSayac.adet + agirlik > GORSEL_GUNLUK) {
    return res.status(429).json({
      hata: "Bugünlük görsel limiti doldu, yarın tekrar dene."
    });
  }

  const ac = new AbortController();
  const zaman = setTimeout(() => ac.abort(), 60000);

  res.on("close", () => {
    if (!res.writableEnded) ac.abort();
  });

  try {
    const ing = await gorselIstemi(
      istem.trim(),
      ac.signal,
      resim
    );

    if (/^REFUSE\b/i.test(ing)) {
      return res.status(422).json({
        hata: "Bu istek güvenlik kuralları nedeniyle reddedildi."
      });
    }

    let r;

    const cfUrl = m =>
      `https://api.cloudflare.com/client/v4/accounts/${CF_HESAP}/ai/run/${m}`;

    if (resim) {
      const en = +req.body.en;
      const boy = +req.body.boy;

      let w = 1024;
      let h = 1024;

      if (en > 0 && boy > 0) {
        const o = 1024 / Math.max(en, boy);

        const kenet = x =>
          Math.min(1024, Math.max(256, Math.round(x / 64) * 64));

        w = kenet(en * o);
        h = kenet(boy * o);
      }

      const form = new FormData();

      form.append("prompt", ing.slice(0, 1500));

      form.append(
        "input_image_0",
        new Blob(
          [Buffer.from(resim.data, "base64")],
          { type: resim.mimeType }
        ),
        "kaynak.jpg"
      );

      form.append("width", String(w));
      form.append("height", String(h));

      r = await fetch(cfUrl(CF_DUZEN_MODEL), {
        method: "POST",
        signal: ac.signal,
        headers: {
          "Authorization": "Bearer " + CF_TOKEN
        },
        body: form
      });

    } else {
      r = await fetch(cfUrl(CF_MODEL), {
        method: "POST",
        signal: ac.signal,
        headers: {
          "Authorization": "Bearer " + CF_TOKEN,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          prompt: ing.slice(0, 1500),
          steps: 6
        })
      });
    }

    const v = await r.json().catch(() => ({}));
    const b64 = v.result && v.result.image;

    if (!r.ok || v.success === false || !b64) {
      const detay =
        (v.errors?.[0]?.message || "").slice(0, 200);

      const msg =
        r.status === 429
          ? "Günlük ücretsiz görsel kotası doldu, yarın tekrar dene."
          : /nsfw|flag|safety/i.test(detay)
            ? "Bu istek güvenlik kuralları nedeniyle reddedildi."
            : detay || "Görsel oluşturulamadı (" + r.status + ")";

      return res.status(502).json({
        hata: msg
      });
    }

    gorselSayac.adet += agirlik;

    res.json({
      gorsel:
        "data:" +
        (b64.startsWith("iVBOR") ? "image/png" : "image/jpeg") +
        ";base64," +
        b64
    });

  } catch (e) {
    if (res.headersSent) {
      return;
    }

    if (e.name === "AbortError") {
      res.status(504).json({
        hata: "Görsel çok uzun sürdü, tekrar dene."
      });
    } else {
      res.status(500).json({
        hata: "Görsel servisine ulaşılamadı: " + e.message
      });
    }

  } finally {
    clearTimeout(zaman);
  }
});

// --------------------------------------------------
// SUNUCUYU BAŞLAT
// --------------------------------------------------

app.listen(PORT, () => {
  console.log("AbdulGPT çalışıyor: " + PORT);
  console.log("İnternet araması: Aktif");
  console.log("Görsel oluşturma: " + (!!CF_HESAP && !!CF_TOKEN));
});
         
