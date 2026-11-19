
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

const GORSEL_GUNLUK = Number(process.env.GORSEL_GUNLUK) || 200;


// GÜNCEL TÜRKİYE SAATİ

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


// SİSTEM TALİMATLARI

const ORTAK =
  " Doğru, net ve dürüst ol; emin olmadığın şeyi uydurma." +
  " Güncel bilgi gerekiyorsa internet araması yap." +
  " İnternet kaynaklarını doğru aktar ve kaynakları belirt.";

const MODLAR = {
  genel: "Sen AbdulGPT adında yardımsever, samimi ve gelişmiş bir Türkçe yapay zeka asistanısın.",
  kodlama: "Sen uzman bir yazılım geliştiricisin. Türkçe açıkla, kodu markdown kod bloğunda ver.",
  cevirmen: "Sen profesyonel bir çevirmensin. Türkçe yazıyı İngilizceye, diğer dilleri Türkçeye çevir. Sadece çeviriyi ver.",
  ozetleyici: "Verilen metni Türkçe, madde madde ve kısa özetle.",
  ders: "Sen sabırlı bir Türkçe öğretmensin. Soruyu adım adım çöz, nedenini açıkla ve sonucu kontrol et. Formülleri LaTeX ile yaz."
};

const LATEXSIZ =
  " Matematik yazarken LaTeX ve dolar işareti kullanma. Formülleri düz metinle yaz.";

const HATIRLA =
  " Kullanıcı kendisi hakkında kalıcı bir bilgi paylaşırsa cevabının sonuna [HATIRLA: kısa bilgi] ekle.";

const SIFRE = process.env.SIFRE || "";

const ozet = x =>
  crypto.createHash("sha256").update(String(x)).digest();

const sifreTamam = g =>
  !SIFRE || crypto.timingSafeEqual(ozet(g || ""), ozet(SIFRE));

app.use(express.json({ limit: "6mb" }));
app.use(express.static(path.join(__dirname, "public")));


// İSTEK SINIRLANDIRMA

const sayac = new Map();

setInterval(() => sayac.clear(), 60 * 1000).unref();

function limitKontrol(key, max = 10) {
  const n = (sayac.get(key) || 0) + 1;
  sayac.set(key, n);
  return n <= max;
}


// OTOMATİK İNTERNET ARAMASI

function internetGerekli(mesaj) {
  const s = mesaj.toLocaleLowerCase("tr-TR");

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
    /güncel başkan|güncel yönetici/,
    /yeni çıkan|en yeni|en son çıkan/,
    /araştır|kaynakları bul|kaynakları göster/,
    /google'da ara|google da ara/,
    /son.*(fiyat|model|sürüm|haber)/
  ];

  return kaliplar.some(k => k.test(s));
}


// GELİŞMİŞ ARAŞTIRMA - KAYNAK SINIFLANDIRMA

function kaynakTuru(urlString) {
  try {
    const host = new URL(urlString)
      .hostname.toLowerCase()
      .replace(/^www\./, "");

    const resmiAlanlar = [
      "openai.com", "anthropic.com", "google.com",
      "deepmind.google", "blog.google", "cloud.google.com",
      "ai.meta.com", "about.fb.com", "microsoft.com",
      "blogs.microsoft.com", "nvidia.com", "apple.com",
      "who.int", "un.org", "europa.eu", "gov.tr", "edu.tr"
    ];

    if (
      resmiAlanlar.some(d => host === d || host.endsWith("." + d)) ||
      host.endsWith(".gov") ||
      host.endsWith(".edu")
    ) {
      return "Resmî kurum veya şirket kaynağı";
    }

    const haberAlanlari = [
      "reuters.com", "apnews.com", "bbc.com",
      "bbc.co.uk", "theguardian.com", "nytimes.com",
      "bloomberg.com", "techcrunch.com",
      "theverge.com", "wired.com"
    ];

    if (
      haberAlanlari.some(d => host === d || host.endsWith("." + d))
    ) {
      return "Haber kaynağı";
    }

    return "Diğer kaynak";

  } catch {
    return "Kaynağın alan adı belirlenemedi";
  }
}


// KAYNAKLARI METNE DÖNÜŞTÜRME

function kaynaklariMetneCevir(kaynaklar) {
  return kaynaklar.map((k, i) => [
    "[" + (i + 1) + "]",
    "Başlık: " + (k.title || "Başlıksız"),
    "URL: " + (k.url || ""),
    "Kaynak türü: " + kaynakTuru(k.url || ""),
    "Yayın tarihi: " + (k.published_date || k.date || "Belirtilmemiş"),
    "İçerik: " + String(k.content || "").slice(0, 2200)
  ].join("\n")).join("\n\n");
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
      "content-type": "application/json",
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
      data.error?.message ||
      "Gemini araştırma kontrolü başarısız (" + response.status + ")."
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
    googleSearch: false,
    tavilySearch: !!TAVILY_API_KEY,
    gelismisArastirma: !!TAVILY_API_KEY,
    kaynakDogrulama: !!API_KEY,
    gorsel: !!CF_HESAP && !!CF_TOKEN,
    tarih: turkiyeZamani(),
    saatDilimi: "Europe/Istanbul"
  });
});


// GİRİŞ API

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
  

// CHAT API

app.post("/api/chat", async (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.ip;

  if (!limitKontrol("chat:" + ip, 30)) {
    return res.status(429).json({ hata: "Çok fazla istek gönderdin. Biraz bekle." });
  }

  if (!sifreTamam(req.headers["x-sifre"])) {
    return res.status(401).json({ hata: "Giriş gerekli." });
  }

  if (!API_KEY) {
    return res.status(500).json({ hata: "Gemini API anahtarı ayarlanmamış." });
  }

  const {
    mesaj,
    gecmis = [],
    mod = "genel",
    latex = true,
    guclu = false
  } = req.body || {};

  if (!mesaj || typeof mesaj !== "string") {
    return res.status(400).json({ hata: "Mesaj boş olamaz." });
  }

  const secilenMod = MODLAR[mod] || MODLAR.genel;
  const matematikTalimat = latex ? "" : LATEXSIZ;

  const tarihTalimat =
    "\n\nŞu anki Türkiye tarihi ve saati: " +
    turkiyeZamani() +
    ". Tarih sorularında bu bilgiyi esas al.";

  const systemInstruction =
    secilenMod +
    ORTAK +
    HATIRLA +
    matematikTalimat +
    tarihTalimat;

  let kaynaklar = [];
  let aramaMetni = "";
  let aramaYapildi = false;

  // İNTERNET ARAŞTIRMASI

  if (internetGerekli(mesaj) && TAVILY_API_KEY) {
    try {
      const aramaSorgulari = [
        mesaj,
        mesaj + " güncel gelişmeler",
        mesaj + " resmi açıklama ve güvenilir kaynaklar"
      ];

      const tumSonuclar = [];

      for (const sorgu of aramaSorgulari) {
        const arama = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            api_key: TAVILY_API_KEY,
            query: sorgu,
            search_depth: "basic",
            topic: "general",
            max_results: 5,
            include_answer: false,
            include_raw_content: false
          })
        });

        if (!arama.ok) continue;

        const veri = await arama.json();
        tumSonuclar.push(...(veri.results || []));
      }

      const benzersiz = new Map();

      for (const sonuc of tumSonuclar) {
        if (sonuc.url && !benzersiz.has(sonuc.url)) {
          benzersiz.set(sonuc.url, sonuc);
        }
      }

      kaynaklar = [...benzersiz.values()].slice(0, 10);
      aramaMetni = kaynaklariMetneCevir(kaynaklar);
      aramaYapildi = kaynaklar.length > 0;

    } catch (hata) {
      console.error("Tavily arama hatası:", hata.message);
    }
  }

  const arastirmaTalimatı = aramaYapildi
    ? `

İNTERNET ARAŞTIRMASI SONUÇLARI:

${aramaMetni}

ARAŞTIRMA KURALLARI:
- Cevabını bulunan kaynaklara dayandır.
- Kaynaklarda olmayan bilgileri kesin gerçek gibi sunma.
- Resmî kaynakları önceliklendir.
- Birden fazla kaynak birbiriyle çelişiyorsa bunu belirt.
- Güncel olmayan bilgileri güncelmiş gibi gösterme.
- Kaynak numaralarını [1], [2] şeklinde kullan.
- Kaynakların türünü değerlendirirken alan adı sınıflandırmasının tek başına güvenilirlik kanıtı olmadığını unutma.
`
    : "";

  const sonSystem = systemInstruction + arastirmaTalimatı;

  const sonGecmis = Array.isArray(gecmis)
    ? gecmis.slice(-20).map(x => ({
        role: x.role === "model" ? "model" : "user",
        parts: [{
          text: String(x.text || "").slice(0, 8000)
        }]
      })).filter(x => x.parts[0].text)
    : [];

  const contents = [
    ...sonGecmis,
    { role: "user", parts: [{ text: mesaj }] }
  ];

  const model = guclu ? MODEL_GUCLU : MODEL;

  // GELİŞMİŞ ARAŞTIRMA: TASLAK VE İKİNCİ KONTROL

  let denetimTalimatı = "";

  if (aramaYapildi && guclu) {
    try {
      const taslak = await geminiTekSefer(
        model,
        sonSystem +
          "\nÖnce araştırma sonuçlarına dayanarak kısa bir cevap taslağı oluştur. " +
          "Kaynaklarda bulunmayan bilgileri ekleme.",
        contents,
        2500
      );

      const denetim = await geminiTekSefer(
        MODEL,
        `Sen bağımsız bir bilgi doğrulama denetçisisin.
Aşağıdaki cevap taslağını kaynaklarla karşılaştır.
Yanlış, desteklenmeyen, eski veya abartılı iddiaları belirle.
Kaynakların doğrulamadığı iddiaları açıkça işaretle.
Yeni bilgi uydurma.

KAYNAKLAR:
${aramaMetni}

CEVAP TASLAĞI:
${taslak}

Denetim sonucunu kısa ve maddeler halinde yaz.`,
        [{ role: "user", parts: [{ text: "Taslağı denetle." }] }],
        1500
      );

      denetimTalimatı = `

BAĞIMSIZ DENETİM SONUCU:
${denetim}

Son cevabını hazırlarken bu denetimi dikkate al.
Desteklenmeyen iddiaları çıkar veya belirsiz olduklarını belirt.
`;

    } catch (hata) {
      console.error("Araştırma denetimi hatası:", hata.message);
    }
  }

  const finalSystem = sonSystem + denetimTalimatı;

  // GEMINI SSE AKIŞI

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  let kapandi = false;

  req.on("close", () => {
    kapandi = true;
  });

  try {
    const response = await fetch(url(model), {
      method: "POST",
      headers: {
        "content-type": "application/json",
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
    });

    if (!response.ok) {
      const hata = await response.json().catch(() => ({}));
      throw new Error(
        hata.error?.message || "Gemini API hatası: " + response.status
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let biriken = "";
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

          if (metin) {
            biriken += metin;

            if (!kapandi) {
              res.write(
                "data: " + JSON.stringify({ text: metin }) + "\n\n"
              );
            }
          }
        } catch {
          // Tamamlanmamış SSE satırlarını sonraki okumada işle.
        }
      }
    }

    if (!kapandi) {
      res.write(
        "data: " +
        JSON.stringify({
          kaynaklar: kaynaklar.map((k, i) => ({
            sira: i + 1,
            baslik: k.title || "Başlıksız",
            url: k.url || "",
            tur: kaynakTuru(k.url || ""),
            tarih: k.published_date || k.date || ""
          })),
          internetKullanildi: aramaYapildi,
          gelismisArastirma: !!denetimTalimatı
        }) +
        "\n\n"
      );

      res.write("data: [DONE]\n\n");
      res.end();
    }

  } catch (hata) {
    console.error("Chat hatası:", hata);

    if (!kapandi) {
      res.write(
        "data: " +
        JSON.stringify({ hata: hata.message || "Bir hata oluştu." }) +
        "\n\n"
      );
      res.end();
    }
  }
});


// GÖRSEL OLUŞTURMA VE DÜZENLEME

app.post("/api/gorsel", async (req, res) => {
  if (!sifreTamam(req.headers["x-sifre"])) {
    return res.status(401).json({ hata: "Giriş gerekli." });
  }

  if (!CF_HESAP || !CF_TOKEN) {
    return res.status(500).json({
      hata: "Cloudflare ayarları eksik."
    });
  }

  const { prompt, gorsel, duzenle } = req.body || {};

  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ hata: "Görsel açıklaması gerekli." });
  }

  const model = duzenle ? CF_DUZEN_MODEL : CF_MODEL;

  const endpoint =
    `https://api.cloudflare.com/client/v4/accounts/${CF_HESAP}/ai/run/${model}`;

  try {
    const body = { prompt };

    if (gorsel && typeof gorsel === "string") {
      const eslesme = gorsel.match(IMG_RE);

      if (!eslesme) {
        return res.status(400).json({
          hata: "Desteklenmeyen görsel formatı."
        });
      }

      body.image = Array.from(
        Buffer.from(eslesme[2], "base64")
      );
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${CF_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const veri = await response.json().catch(() => ({}));

    if (!response.ok || !veri.success) {
      throw new Error(
        veri.errors?.[0]?.message ||
        "Cloudflare görsel API hatası."
      );
    }

    let sonuc = veri.result;

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
        gorsel: "data:image/png;base64," + sonuc.response
      });
    }

    res.status(500).json({
      hata: "Görsel sonucu beklenen formatta değil."
    });

  } catch (hata) {
    console.error("Görsel API hatası:", hata);
    res.status(500).json({
      hata: hata.message || "Görsel oluşturulamadı."
    });
  }
});


// SUNUCUYU BAŞLAT

app.listen(PORT, () => {
  console.log("AbdulGPT sunucusu " + PORT + " portunda çalışıyor.");
});
    
