// E-posta + şifre ile kayıt/giriş ve sohbetleri bulutta (Firestore) saklama. Ayarlar: firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification, updateProfile, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, deleteDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const kutu = document.getElementById("hesap");
const cfg = window.FIREBASE_CONFIG;

const HATA = {
  "auth/invalid-credential": "E-posta veya şifre hatalı.",
  "auth/wrong-password": "E-posta veya şifre hatalı.",
  "auth/user-not-found": "E-posta veya şifre hatalı.",
  "auth/invalid-email": "E-posta adresi geçersiz.",
  "auth/missing-email": "E-posta adresini yaz.",
  "auth/missing-password": "Şifreni yaz.",
  "auth/email-already-in-use": "Bu e-posta ile zaten bir hesap var. Giriş yapmayı dene.",
  "auth/weak-password": "Şifre en az 6 karakter olmalı.",
  "auth/too-many-requests": "Çok fazla deneme yapıldı, biraz bekleyip tekrar dene.",
  "auth/network-request-failed": "İnternet bağlantını kontrol et.",
  "auth/operation-not-allowed": "E-posta ile giriş Firebase'de açık değil (Authentication > Sign-in method)."
};
const hataMetni = e => HATA[e.code] || ("Bir hata oluştu: " + (e.code || e.message));

if (cfg && cfg.apiKey) {
  kutu.hidden = false;
  const auth = getAuth(initializeApp(cfg)), fs = getFirestore();
  auth.languageCode = "tr"; // e-postalar Türkçe gelsin
  let kul = null, zaman = null;
  const yol = id => doc(fs, "kullanicilar", kul.uid, "sohbetler", id);
  const temiz = s => JSON.parse(JSON.stringify(s, (k, v) => k === "img" ? undefined : v));

  const st = document.createElement("style");
  st.textContent = "#hdlg a{color:var(--a2);cursor:pointer;text-decoration:underline}";
  document.head.appendChild(st);

  function pencere(mod){
    let d = document.getElementById("hdlg");
    if (!d) { d = document.createElement("dialog"); d.id = "hdlg"; document.body.appendChild(d); }
    const kayit = mod === "kayit";
    d.innerHTML =
      '<h2>' + (kayit ? "Kayıt ol" : "Giriş yap") + '</h2>' +
      (kayit ? '<input id="hnm" placeholder="Adın" autocomplete="name">' : '') +
      '<input id="hem" type="email" placeholder="E-posta" autocomplete="email">' +
      '<input id="hsf" type="password" placeholder="Şifre" autocomplete="' + (kayit ? "new-password" : "current-password") + '">' +
      '<div id="hms" style="min-height:1.3em;font-size:.85rem;margin-bottom:8px"></div>' +
      '<button class="ib" id="hok" type="button">' + (kayit ? "Kayıt ol" : "Giriş yap") + '</button>' +
      '<div style="margin-top:12px;font-size:.85rem;display:flex;flex-direction:column;gap:6px;align-items:flex-start">' +
      (kayit ? '' : '<a id="hunut">Şifremi unuttum</a>') +
      '<a id="hdeg">' + (kayit ? "Zaten hesabın var mı? Giriş yap" : "Hesabın yok mu? Kayıt ol") + '</a>' +
      '<a id="hkpt">Vazgeç</a></div>';
    const q = id => d.querySelector("#" + id);
    const mesaj = (m, iyi) => { q("hms").style.color = iyi ? "#4ade80" : "#ff7b86"; q("hms").textContent = m; };

    q("hok").onclick = async () => {
      const em = q("hem").value.trim(), sf = q("hsf").value;
      q("hok").disabled = true; mesaj("");
      try {
        if (kayit) {
          const ad = q("hnm").value.trim();
          const c = await createUserWithEmailAndPassword(auth, em, sf);
          if (ad) await updateProfile(c.user, { displayName: ad });
          sendEmailVerification(c.user).catch(() => {});
          window.UYG.ad = ad; ciz(); window.UYG.ciz();
        } else await signInWithEmailAndPassword(auth, em, sf);
        d.close();
      } catch (e) { mesaj(hataMetni(e)); }
      q("hok").disabled = false;
    };
    d.querySelectorAll("input").forEach(i => i.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); q("hok").click(); } }));
    if (!kayit) q("hunut").onclick = async () => {
      const em = q("hem").value.trim();
      if (!em) { mesaj("Önce e-posta adresini yaz."); return; }
      try { await sendPasswordResetEmail(auth, em); mesaj("Şifre sıfırlama bağlantısı gönderildi. Gelen kutunu ve spam klasörünü kontrol et.", true); }
      catch (e) { mesaj(hataMetni(e)); }
    };
    q("hdeg").onclick = () => pencere(kayit ? "giris" : "kayit");
    q("hkpt").onclick = () => d.close();
    if (!d.open) d.showModal();
  }

  function ciz(){
    kutu.textContent = "";
    if (!kul) {
      const a = document.createElement("button"); a.className = "gb"; a.textContent = "🔐 Giriş yap"; a.onclick = () => pencere("giris");
      const b = document.createElement("button"); b.className = "gb"; b.textContent = "✨ Kayıt ol"; b.onclick = () => pencere("kayit");
      const p = document.createElement("div"); p.textContent = "Girmeden de kullanabilirsin. Giriş yaparsan sohbetlerin hesabında saklanır, her cihazdan ulaşırsın.";
      kutu.append(a, b, p);
    } else {
      const d = document.createElement("div"); d.className = "kul";
      const n = document.createElement("span"); n.textContent = kul.displayName || kul.email; d.append(n);
      const c = document.createElement("button"); c.className = "gb"; c.textContent = "Çıkış";
      c.onclick = async () => { await signOut(auth); window.UYG.sifirla(); };
      d.append(c);
      const p = document.createElement("div"); p.textContent = "☁️ Sohbetlerin hesabında kaydediliyor";
      kutu.append(d, p);
    }
  }

  window.Hesap = {
    kaydet(db){
      if (!kul) return;
      clearTimeout(zaman);
      zaman = setTimeout(() => {
        const s = db.sohbetler.find(x => x.id === db.aktif);
        if (s && s.m.length) setDoc(yol(s.id), temiz(s)).catch(e => console.error(e));
      }, 1200);
    },
    sil(id){ if (kul) deleteDoc(yol(id)).catch(e => console.error(e)); }
  };

  onAuthStateChanged(auth, async u => {
    kul = u; window.UYG.ad = u ? (u.displayName || "") : ""; ciz();
    if (!u) return;
    try {
      const snap = await getDocs(collection(fs, "kullanicilar", u.uid, "sohbetler"));
      window.UYG.birlestir(snap.docs.map(d => d.data()));
      for (const s of window.UYG.al().sohbetler) if (s.m.length) await setDoc(yol(s.id), temiz(s));
    } catch (e) {
      console.error(e);
      alert("Sohbetler buluttan alınamadı: " + e.code + "\nFirestore veritabanını ve kuralları kontrol et.");
    }
  });
  ciz();
}
