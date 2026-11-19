
const express = require("express");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const API_KEY = process.env.GEMINI_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || "";

const MODEL = process.env.MODEL || "gemini-flash-latest";
const MODEL_GUCLU = process.env.MODEL_GUCLU || "gemini-pro-latest";

const CF_HESAP = process.env.CLOUDFLARE_ACCOUNT_ID || "";
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";

const CF_MODEL =
  process.env.CF_GORSEL_MODEL ||
  "@cf/black-forest-labs/flux-1-schnell";

const CF_DUZEN_MODEL =
  process.env.CF_DUZEN_MODEL ||
  "@cf/black-forest-labs/flux-1-kontext-pro";

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));


// GÜVENLİK

const SIFRE = process.env.SIFRE || "";

function ozet(metin) {
  return crypto
    .createHash("sha256")
    .update(String(metin))
    .digest();
}

function sifreTamam(gelen) {
  return crypto.timingSafeEqual(
    ozet(gelen || ""),
    ozet(SIFRE)
  );
}


// İSTEK SINIRLANDIRMA

const sayac = new Map();

setInterval(() => {
  sayac.clear();
}, 60000).unref();

function limitKontrol(key, max = 30) {
  const sayi = (sayac.get(key) || 0) + 1;
  sayac.set(key, sayi);
  return sayi <= max;
}

function istemciIP(req) {
  return String(
    req.headers["x-forwarded-for"] || req.ip
  ).split(",")[0].trim();
}


// TÜRKİYE SAATİ

function turkiyeZamani() {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).format(new Date());
}


// MODEL TALİMATLARI

const MODLAR = {
  genel:
    "Sen AbdulGPT adında gelişmiş, yardımsever ve Türkçe konuşan bir yapay zeka asistanısın.",

  kodlama:
    "Sen uzman bir yazılım geliştiricisin. Kodları eksiksiz, düzenli ve açıklamalı ver.",

  cevirmen:
    "Sen profesyonel bir çevirmensin. İstenen metni doğru ve doğal biçimde çevir.",

  ozetleyici:
    "Sen profesyonel bir özetleme asistanısın. Metinleri önemli noktaları koruyarak özetle.",

  ders:
    "Sen sabırlı bir öğretmensin. Konuları adım adım, anlaşılır Türkçe ile açıkla."
};

const ORTAK_TALIMAT =
  " Doğru ve dürüst ol. Bilmediğin bilgileri uydurma." +
  " Güncel bilgi gerekiyorsa internet araştırmasını kullan." +
  " Kaynakları açıkça belirt. Emin olmadığın konularda belirsizliği açıkla.";

const LATEXSIZ =
  " Matematik ifadelerini LaTeX kullanmadan düz metinle yaz.";


// İNTERNET ARAMASI GEREKLİ Mİ?

function internetGerekli(mesaj) {
  const s = String(mesaj).toLocaleLowerCase("tr-TR");

  const kaliplar = [
    /hava durumu|hava nasıl|yağmur yağacak mı/,
    /son dakika|güncel haber|bugünkü haber/,
    /internette ara|internetten araştır|webde ara/,
    /güncel bilgi|güncel olarak|şu anki/,
    /dolar kaç|euro kaç|altın fiyat|gram altın/,
    /maç sonucu|canlı skor|puan durumu|fikstür/,
    /en son gelişmeler|kaynak göster/,
    /kaç derece|hava tahmini/,
    /kim kazandı|güncel fiyat/,
    /bugün.*(hava|haber|maç|fiyat)/,
    /yarın.*(hava|maç|etkinlik)/,
    /yeni çıkan|en yeni|en son çıkan/,
    /araştır|kaynakları bul|kaynakları göster/,
    /son.*(fiyat|model|sürüm|haber)/
  ];

  return kaliplar.some(k => k.test(s));
}


// KAYNAK SINIFLANDIRMA

function kaynakTuru(urlString) {
  try {
    const host = new URL(urlString)
      .hostname.toLowerCase()
      .replace(/^www\./, "");

    const resmiAlanlar = [
      "openai.com",
      "anthropic.com",
      "google.com",
      "deepmind.google",
      "blog.google",
      "cloud.google.com",
      "ai.meta.com",
      "about.fb.com",
      "microsoft.com",
      "nvidia.com",
      "apple.com",
      "who.int",
      "un.org",
      "europa.eu",
      "gov.tr",
      "edu.tr"
    ];

    if (
      resmiAlanlar.some(d => host === d || host.endsWith("." + d)) ||
      host.endsWith(".gov") ||
      host.endsWith(".edu")
    ) {
      return "Resmî kurum veya şirket kaynağı";
    }

    const haberAlanlari = [
      "reuters.com",
      "apnews.com",
      "bbc.com",
      "bbc.co.uk",
      "theguardian.com",
      "nytimes.com",
      "bloomberg.com",
      "techcrunch.com",
      "theverge.com",
      "wired.com"
    ];

    if (
      haberAlanlari.some(d => host === d || host.endsWith("." + d))
    ) {
      return "Haber kaynağı";
    }

    return "Diğer kaynak";

  } catch {
    return "Bilinmeyen kaynak";
  }
}


// KAYNAKLARI METNE DÖNÜŞTÜR

function kaynaklariMetneCevir(kaynaklar) {
  return kaynaklar.map((k, i) => {
    return [
      `[${i + 1}]`,
      "Başlık: " + (k.title || "Başlıksız"),
      "URL: " + (k.url || ""),
      "Kaynak türü: " + kaynakTuru(k.url || ""),
      "Tarih: " + (k.published_date || "Belirtilmemiş"),
      "İçerik: " + String(k.content || "").slice(0, 2200)
    ].join("\n");
  }).join("\n\n");
}


// GEMINI TEK SEFERLİK İSTEK

async function geminiTekSefer(
  model,
  systemInstruction,
  contents,
  maxOutputTokens = 3000
) {
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": API_KEY
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      contents,
      generationConfig: {
        maxOutputTokens,
        temperature: 0.2
      }
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error?.message || "Gemini API hatası: " + response.status
    );
  }

  return (data.candidates?.[0]?.content?.parts || [])
    .filter(p => p.text && !p.thought)
    .map(p => p.text)
    .join("\n")
    .trim();
}


// DURUM API

app.get("/api/durum", (req, res) => {
  res.json({
    sifreli: !!SIFRE,
    internetArama: !!TAVILY_API_KEY,
    tavilySearch: !!TAVILY_API_KEY,
    gelismisArastirma: !!TAVILY_API_KEY && !!API_KEY,
    gorsel: !!CF_HESAP && !!CF_TOKEN,
    tarih: turkiyeZamani(),
    saatDilimi: "Europe/Istanbul"
  });
});


// GİRİŞ API

app.post("/api/giris", (req, res) => {
  if (!limitKontrol("giris:" + istemciIP(req), 10)) {
    return res.status(429).json({
      hata: "Çok fazla deneme yaptın. Biraz bekle."
    });
  }

  if (sifreTamam(req.body?.sifre)) {
    return res.json({ ok: true });
  }

  return res.status(401).json({
    hata: "Şifre yanlış."
  });
});


// GÖRSEL VERİ KONTROLÜ

const IMG_RE =
  /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

const geminiStreamURL = model =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;


// CHAT API

app.post("/api/chat", async (req, res) => {
  const ip = istemciIP(req);

  if (!limitKontrol("chat:" + ip, 30)) {
    return res.status(429).json({
      hata: "Çok fazla istek gönderdin. Biraz bekle."
    });
  }

  if (!sifreTamam(req.headers["x-sifre"])) {
    return res.status(401).json({
      hata: "Giriş gerekli."
    });
  }

  if (!API_KEY) {
    return res.status(500).json({
      hata: "Gemini API anahtarı ayarlanmamış."
    });
  }

  const body = req.body || {};

  // FARKLI ÖN YÜZ MESAJ FORMATLARINI DESTEKLE

  const messages = Array.isArray(body.messages)
    ? body.messages
    : [];

  const sonMesaj = [...messages]
    .reverse()
    .find(m =>
      m &&
      (m.role === "user" || m.role === "human") &&
      typeof (m.content || m.text) === "string"
    );

  const mesaj = String(
    body.mesaj ||
    body.message ||
    body.prompt ||
    sonMesaj?.content ||
    sonMesaj?.text ||
    ""
  ).trim();

  if (!mesaj) {
    return res.status(400).json({
      hata: "Mesaj boş olamaz. Ön yüzden mesaj alanı kontrol edilmeli."
    });
  }

  const gecmisKaynak = Array.isArray(body.gecmis)
    ? body.gecmis
    : messages;

  const gecmis = gecmisKaynak
    .filter(m => m && m !== sonMesaj)
    .slice(-20)
    .map(m => {
      const role =
        m.role === "assistant" || m.role === "model"
          ? "model"
          : "user";

      const text = String(
        m.content || m.text || ""
      ).trim();

      return {
        role,
        parts: [{ text: text.slice(0, 8000) }]
      };
    })
    .filter(m => m.parts[0].text);

  const mod = body.mod || "genel";
  const latex = body.latex !== false;

  const guclu =
    body.derin === true ||
    body.guclu === true ||
    body.deepResearch === true ||
    body.gelismisArastirma === true;

  const systemInstruction =
    (MODLAR[mod] || MODLAR.genel) +
    ORTAK_TALIMAT +
    (latex ? "" : LATEXSIZ) +
    "\n\nTürkiye tarihi ve saati: " +
    turkiyeZamani() +
    ". Güncel tarih sorularında bu bilgiyi kullan.";

  let kaynaklar = [];
  let aramaYapildi = false;

  // TAVILY İNTERNET ARAŞTIRMASI

  if (internetGerekli(mesaj) && TAVILY_API_KEY) {
    try {
      const sorgular = [
        mesaj,
        mesaj + " güncel gelişmeler",
        mesaj + " resmî açıklamalar güvenilir kaynaklar"
      ];

      const bulunanlar = [];

      for (const sorgu of sorgular) {
        const response = await fetch(
          "https://api.tavily.com/search",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              api_key: TAVILY_API_KEY,
              query: sorgu,
              search_depth: "basic",
              topic: "general",
              max_results: 5,
              include_answer: false,
              include_raw_content: false
            })
          }
        );

        if (!response.ok) {
          console.error("Tavily HTTP:", response.status);
          continue;
        }

        const data = await response.json();
        bulunanlar.push(...(data.results || []));
      }

      const benzersiz = new Map();

      for (const k of bulunanlar) {
        if (k.url && !benzersiz.has(k.url)) {
          benzersiz.set(k.url, k);
        }
      }

      kaynaklar = [...benzersiz.values()].slice(0, 10);
      aramaYapildi = kaynaklar.length > 0;

    } catch (error) {
      console.error("Tavily araştırma hatası:", error.message);
    }
  }

  const kaynakMetni = kaynaklariMetneCevir(kaynaklar);

  const arastirmaTalimatı = aramaYapildi
    ? `

İNTERNET ARAŞTIRMASI:

${kaynakMetni}

KURALLAR:
- Cevabını kaynaklara dayandır.
- Kaynakta olmayan bilgileri uydurma.
- Resmî kaynakları önceliklendir.
- Çelişkili bilgileri belirt.
- Tarihi belli olmayan bilgileri güncelmiş gibi sunma.
- Kaynak numaralarını [1], [2] şeklinde göster.
- Kaynak türü sınıflandırmasını kesin güvenilirlik kanıtı olarak görme.
- Cevabın sonunda kaynak bağlantılarını ver.
`
    : "";

  const sonSystem =
    systemInstruction + arastirmaTalimatı;

  const contents = [
    ...gecmis,
    {
      role: "user",
      parts: [{ text: mesaj }]
    }
  ];

  const secilenModel = guclu
    ? MODEL_GUCLU
    : MODEL;

  // GELİŞMİŞ ARAŞTIRMA VE İKİNCİ DENETİM

  let denetimTalimatı = "";

  if (guclu && aramaYapildi) {
    try {
      const taslak = await geminiTekSefer(
        secilenModel,
        sonSystem +
          "\nKaynaklara dayanarak cevap taslağı oluştur. " +
          "Desteklenmeyen iddiaları ekleme.",
        contents,
        2500
      );

      const denetim = await geminiTekSefer(
        MODEL,
        `Bağımsız bilgi doğrulama denetçisi olarak çalış.

Aşağıdaki taslağı kaynaklarla karşılaştır.
Yanlış, eski veya desteklenmeyen iddiaları belirle.
Kaynaklarda bulunmayan bilgileri işaretle.
Yeni bilgi uydurma.

KAYNAKLAR:
${kaynakMetni}

TASLAK:
${taslak}

Denetim sonucunu maddeler halinde yaz.`,
        [{
          role: "user",
          parts: [{ text: "Taslağı denetle." }]
        }],
        1500
      );

      denetimTalimatı = `

İKİNCİ DENETİM SONUCU:
${denetim}

Son cevabında bu denetimi dikkate al.
Desteklenmeyen iddiaları çıkar veya belirsiz olduklarını belirt.
`;

    } catch (error) {
      console.error("Denetim hatası:", error.message);
    }
  }

  const finalSystem =
    sonSystem + denetimTalimatı;

  // STREAMING YANIT

  res.setHeader(
    "Content-Type",
    "text/event-stream; charset=utf-8"
  );

  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  res.flushHeaders?.();

  let kapandi = false;

  req.on("close", () => {
    kapandi = true;
  });

  try {
    const response = await fetch(
      geminiStreamURL(secilenModel),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": API_KEY
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: finalSystem }]
          },
          contents,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 6000
          }
        })
      }
    );

    if (!response.ok) {
      const hata = await response.json().catch(() => ({}));

      throw new Error(
        hata.error?.message ||
        "Gemini API hatası: " + response.status
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let tampon = "";

    while (true) {
      const { done, value } = await reader.read();

      if (done || kapandi) break;

      tampon += decoder.decode(value, { stream: true });

      const satirlar = tampon.split("\n");
      tampon = satirlar.pop() || "";

      for (const satir of satirlar) {
        if (!satir.startsWith("data:")) continue;

        const veri = satir.slice(5).trim();

        if (!veri || veri === "[DONE]") continue;

        try {
          const json = JSON.parse(veri);

          const metin = (
            json.candidates?.[0]?.content?.parts || []
          )
            .filter(p => p.text && !p.thought)
            .map(p => p.text)
            .join("");

          if (metin && !kapandi) {
            // Hem eski hem yeni ön yüz formatı

            res.write(
              "data: " +
              JSON.stringify({
                t: metin,
                text: metin
              }) +
              "\n\n"
            );
          }

        } catch (error) {
          console.error("SSE veri okuma hatası:", error.message);
        }
      }
    }

    if (!kapandi) {
      res.write(
        "data: " +
        JSON.stringify({
          bitti: true,
          kaynaklar: kaynaklar.map((k, i) => ({
            sira: i + 1,
            baslik: k.title || "Başlıksız",
            url: k.url || "",
            tur: kaynakTuru(k.url || ""),
            tarih: k.published_date || ""
          })),
          internetKullanildi: aramaYapildi,
          gelismisArastirma: !!denetimTalimatı
        }) +
        "\n\n"
      );

      res.write("data: [DONE]\n\n");
      res.end();
    }

  } catch (error) {
    console.error("Chat API hatası:", error);

    if (!kapandi) {
      res.write(
        "data: " +
        JSON.stringify({
          hata: error.message || "Bir hata oluştu."
        }) +
        "\n\n"
      );

      res.end();
    }
  }
});


// GÖRSEL OLUŞTURMA VE DÜZENLEME

app.post("/api/gorsel", async (req, res) => {
  if (!sifreTamam(req.headers["x-sifre"])) {
    return res.status(401).json({
      hata: "Giriş gerekli."
    });
  }

  if (!CF_HESAP || !CF_TOKEN) {
    return res.status(500).json({
      hata: "Cloudflare ayarları eksik."
    });
  }

  const { prompt, gorsel, duzenle } = req.body || {};

  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({
      hata: "Görsel açıklaması gerekli."
    });
  }

  const model = duzenle
    ? CF_DUZEN_MODEL
    : CF_MODEL;

  const endpoint =
    `https://api.cloudflare.com/client/v4/accounts/${CF_HESAP}/ai/run/${model}`;

  try {
    const body = { prompt };

    if (gorsel) {
      const eslesme = String(gorsel).match(IMG_RE);

      if (!eslesme) {
        return res.status(400).json({
          hata: "Görsel formatı desteklenmiyor."
        });
      }

      body.image = Array.from(
        Buffer.from(eslesme[2], "base64")
      );
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CF_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.success) {
      throw new Error(
        data.errors?.[0]?.message ||
        "Cloudflare görsel API hatası."
      );
    }

    let sonuc = data.result;

    if (sonuc && sonuc.image) {
      sonuc = sonuc.image;
    }

    if (typeof sonuc === "string") {
      return res.json({
        ok: true,
        gorsel: sonuc.startsWith("data:")
          ? sonuc
          : "data:image/png;base64," + sonuc
      });
    }

    if (sonuc && sonuc.response) {
      return res.json({
        ok: true,
        gorsel:
          "data:image/png;base64," + sonuc.response
      });
    }

    return res.status(500).json({
      hata: "Görsel sonucu beklenen formatta değil."
    });

  } catch (error) {
    console.error("Görsel API hatası:", error);

    return res.status(500).json({
      hata: error.message || "Görsel oluşturulamadı."
    });
  }
});


// SUNUCUYU BAŞLAT

app.listen(PORT, () => {
  console.log(
    "AbdulGPT sunucusu " + PORT + " portunda çalışıyor."
  );
});
                    
