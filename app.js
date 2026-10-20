import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, connectAuthEmulator, signInWithCustomToken, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js";
import { firebaseConfig } from "./firebase-config.js";

(() => {
  const root = document.documentElement;
  const languageToggle = document.getElementById("languageToggle");
  const loginForm = document.getElementById("loginForm");
  const loginView = document.getElementById("loginView");
  const dashboardView = document.getElementById("dashboardView");
  const loginNotice = document.getElementById("loginNotice");
  const logoutButton = document.getElementById("logoutButton");
  const demoNote = document.querySelector(".demo-note");
  let language = "de";
  let auth;
  let functions;
  let loginStudent;
  let getStudentSummary;

  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  functions = getFunctions(app, "europe-west3");

  // This branch is deliberately locked to the Firebase Emulator Suite.
  // Do not add production fallbacks to this test build.
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  } else {
    loginForm.querySelector("button[type='submit']").disabled = true;
    loginNotice.textContent = "Lokaler Test erforderlich: Bitte diese Testversion nur über localhost mit laufenden Firebase-Emulatoren öffnen.";
  }

  loginStudent = httpsCallable(functions, "loginRewardStudent");
  getStudentSummary = httpsCallable(functions, "getRewardStudentSummary");

  function setLanguage(nextLanguage) {
    language = nextLanguage;
    root.lang = language;
    root.dir = language === "ar" ? "rtl" : "ltr";
    document.querySelectorAll("[data-de][data-ar]").forEach((element) => {
      element.textContent = element.dataset[language];
    });
    languageToggle.textContent = language === "de" ? "العربية" : "Deutsch";
    languageToggle.setAttribute("aria-label", language === "de" ? "العربية" : "Switch to German");
    document.title = language === "de" ? "Ava Kerolos Rewards · Lokaler Test" : "مكافآت آفا كيرلس · اختبار محلي";
    if (dashboardView && !dashboardView.hidden) {
      const balance = Number(document.getElementById("balanceValue")?.textContent) || 0;
      const goal = Number(document.getElementById("goalValue")?.textContent) || 200;
      const remaining = Math.max(0, goal - balance);
      setText("remainingMessage", language === "de"
        ? "Noch " + remaining + " Punkte bis zu deinem nächsten Ziel."
        : "تبقّى " + remaining + " نقطة للوصول إلى هدفك القادم.");
    }
  }

  function showNotice(message) {
    loginNotice.textContent = message;
  }

  function safeError(error) {
    const code = String(error && error.code || "");
    if (code.includes("unauthenticated")) {
      return language === "de" ? "Schülercode oder PIN ist ungültig." : "كود الطالب أو الرقم السري غير صحيح.";
    }
    if (code.includes("resource-exhausted")) {
      return language === "de" ? "Anmeldung vorübergehend gesperrt. Bitte Lehrkraft kontaktieren." : "تم إيقاف تسجيل الدخول مؤقتًا. يرجى التواصل مع المدرّس.";
    }
    if (code.includes("unavailable") || code.includes("network")) {
      return language === "de" ? "Emulator nicht erreichbar. Bitte prüfen, ob Auth- und Functions-Emulator laufen." : "المحاكي غير متاح. يرجى التأكد من تشغيل محاكي المصادقة والوظائف.";
    }
    return String(error && error.message || "Unbekannter Fehler").slice(0, 220);
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value);
  }

  async function refreshDashboard() {
    const result = await getStudentSummary({});
    const summary = result.data;
    setText("studentDisplayName", summary.displayName || "");
    setText("balanceValue", summary.balance ?? 0);
    setText("totalEarnedValue", summary.totalEarned ?? summary.transactions
      ?.filter((item) => Number(item.delta) > 0)
      .reduce((sum, item) => sum + Number(item.delta), 0) ?? 0);
    const goal = 200;
    const balance = Number(summary.balance) || 0;
    const remaining = Math.max(0, goal - balance);
    setText("goalValue", goal);
    setText("remainingMessage", language === "de"\n      ? "Noch " + remaining + " Punkte bis zu deinem nächsten Ziel."\n      : "تبقّى " + remaining + " نقطة للوصول إلى هدفك القادم.");
    const progress = document.getElementById("goalProgress");
    if (progress) progress.style.width = Math.min(100, Math.round(balance / goal * 100)) + "%";
    loginView.hidden = true;
    dashboardView.hidden = false;
    if (demoNote) demoNote.hidden = true;
  }

  languageToggle.addEventListener("click", () => setLanguage(language === "de" ? "ar" : "de"));

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const studentCode = document.getElementById("studentCode").value.trim();
    const pin = document.getElementById("studentPin").value.trim();
    const submitButton = loginForm.querySelector("button[type='submit']");
    submitButton.disabled = true;
    showNotice(language === "de" ? "Anmeldung läuft …" : "جارٍ تسجيل الدخول …");
    try {
      const loginResult = await loginStudent({ studentCode, pin });
      await signInWithCustomToken(auth, loginResult.data.token);
      await refreshDashboard();
      showNotice("");
      loginForm.reset();
    } catch (error) {
      console.error("Rewards emulator login failed", error);
      showNotice(safeError(error));
    } finally {
      submitButton.disabled = false;
    }
  });

  logoutButton.addEventListener("click", async () => {
    await signOut(auth);
    dashboardView.hidden = true;
    loginView.hidden = false;
    showNotice("");
    loginForm.reset();
    if (demoNote) demoNote.hidden = false;
  });

  setLanguage("de");
})();
