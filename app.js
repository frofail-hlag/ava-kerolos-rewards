(() => {
  const root = document.documentElement;
  const languageToggle = document.getElementById("languageToggle");
  const loginForm = document.getElementById("loginForm");
  const loginView = document.getElementById("loginView");
  const dashboardView = document.getElementById("dashboardView");
  const loginNotice = document.getElementById("loginNotice");
  const logoutButton = document.getElementById("logoutButton");
  let language = "de";

  function setLanguage(nextLanguage) {
    language = nextLanguage;
    root.lang = language;
    root.dir = language === "ar" ? "rtl" : "ltr";
    document.querySelectorAll("[data-de][data-ar]").forEach((element) => {
      element.textContent = element.dataset[language];
    });
    languageToggle.textContent = language === "de" ? "العربية" : "Deutsch";
    languageToggle.setAttribute("aria-label", language === "de" ? "العربية" : "Switch to German");
    document.title = language === "de" ? "Ava Kerolos Rewards" : "مكافآت آفا كيرلس";
  }

  languageToggle.addEventListener("click", () => setLanguage(language === "de" ? "ar" : "de"));

  loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    // Demo only: do not authenticate or store the supplied student code/PIN.
    loginNotice.textContent = language === "de"
      ? "Die Anmeldung ist noch nicht aktiv. Dies ist nur eine Vorschau; gib hier keine echten Zugangsdaten ein."
      : "تسجيل الدخول غير مفعّل بعد. هذه معاينة فقط؛ لا تدخل بيانات حقيقية هنا.";
  });

  logoutButton.addEventListener("click", () => {
    dashboardView.hidden = true;
    loginView.hidden = false;
    loginNotice.textContent = "";
    loginForm.reset();
  });

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {
        // App remains usable if service-worker registration is unavailable.
      });
    });
  }
})();