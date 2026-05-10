/**
 * Nutekh i18n: visitors from Tanzania (TZ, via ipapi.co) default to Kiswahili on first visit;
 * everyone else defaults to English. Choice persists in localStorage; session default in sessionStorage.
 * Force with ?lang=en or ?lang=sw on any URL.
 */
const STORAGE_EXPLICIT = "nutekh_lang_explicit";
const STORAGE_SESSION = "nutekh_lang_sess";
const DICT_URL = "/assets/i18n/nutekh-en-sw.json";

function normalizePathname() {
  let p = window.location.pathname.replace(/\/index\.html?$/i, "/");
  p = p.replace(/\/+$/, "");
  return p === "" ? "/" : p;
}

function pathnameFromHref(href) {
  try {
    const u = new URL(href || "", window.location.origin);
    let p = u.pathname.replace(/\/+$/, "");
    return p === "" ? "/" : p;
  } catch {
    return "";
  }
}

function readQueryLang() {
  const q = new URLSearchParams(window.location.search).get("lang");
  if (q === "en" || q === "sw") return q;
  return null;
}

async function detectCountryCode() {
  try {
    const r = await fetch("https://ipapi.co/json/", {
      credentials: "omit",
      cache: "no-store",
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.country_code || null;
  } catch {
    return null;
  }
}

async function resolveLang() {
  const q = readQueryLang();
  if (q) {
    try {
      localStorage.setItem(STORAGE_EXPLICIT, q);
      sessionStorage.setItem(STORAGE_SESSION, q);
    } catch {
      /* ignore */
    }
    return q;
  }

  try {
    const explicit = localStorage.getItem(STORAGE_EXPLICIT);
    if (explicit === "en" || explicit === "sw") return explicit;
  } catch {
    /* ignore */
  }

  try {
    const s = sessionStorage.getItem(STORAGE_SESSION);
    if (s === "en" || s === "sw") return s;
  } catch {
    /* ignore */
  }

  let inferred = "en";
  const cc = await detectCountryCode();
  if (cc === "TZ") inferred = "sw";
  else if (navigator.language && /^sw/i.test(navigator.language)) inferred = "sw";

  try {
    sessionStorage.setItem(STORAGE_SESSION, inferred);
  } catch {
    /* ignore */
  }
  return inferred;
}

function get(dict, lang, path) {
  const parts = path.split(".");
  let cur = dict[lang];
  for (const p of parts) {
    cur = cur?.[p];
  }
  return typeof cur === "string" ? cur : null;
}

function navHrefKey(href) {
  const h = (href || "").split("#")[0].replace(/\/+$/, "");
  const base = h === "" ? "/" : h;
  const map = {
    "/": "home",
    "/about": "about",
    "/services": "services",
    "/projects": "systems",
    "/contact": "contact",
    "/pricing": "pricing_nav",
  };
  return map[base] || null;
}

function fillTextKeyFromDataText(dataText) {
  const m = {
    Home: "home",
    "About Us": "about",
    Services: "services",
    Pages: "pages",
    Packages: "packages",
    "Nutekh Systems": "systems",
    Pricing: "pricing_nav",
    "Contact Us": "contact",
  };
  return m[dataText || ""] || null;
}

function applyStandardNav(dict, lang) {
  const n = dict[lang]?.nav;
  if (!n) return;

  document.querySelectorAll("ul.navbar-nav a.nav-link").forEach((a) => {
    const key = navHrefKey(a.getAttribute("href"));
    const sp = a.querySelector(".rolling-text");
    if (key && sp && n[key]) sp.textContent = n[key];
  });
}

function applyHamenuFillText(dict, lang) {
  const n = dict[lang]?.nav;
  if (!n) return;

  document.querySelectorAll(".hamenu span.fill-text").forEach((sp) => {
    const dk = fillTextKeyFromDataText(sp.getAttribute("data-text") || "");
    if (dk && n[dk]) sp.textContent = n[dk];
  });
}

function applyHamenuSubLinks(dict, lang) {
  const n = dict[lang]?.nav;
  if (!n) return;

  const table = {
    "/about": "about",
    "/services": "our_services",
    "/pricing": "pricing_nav",
    "/contact": "contact",
    "/package-launch": "launch_pkg",
    "/package-grow": "grow_pkg",
    "/package-scale": "scale_pkg",
  };

  document.querySelectorAll(".hamenu a.sub-link").forEach((a) => {
    const p = pathnameFromHref(a.getAttribute("href"));
    const k = table[p];
    if (k && n[k]) a.textContent = n[k];
  });
}

function applyI18nAttrs(dict, lang) {
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    const key = el.getAttribute("data-i18n-aria");
    if (!key) return;
    const v = get(dict, lang, key);
    if (v) el.setAttribute("aria-label", v);
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (!key) return;
    const v = get(dict, lang, key);
    if (v) el.setAttribute("placeholder", v);
  });

  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    if (!key) return;
    const v = get(dict, lang, key);
    if (v) el.setAttribute("title", v);
  });
}

/** Trusted CMS-style copy only (Nutekh JSON — no user input). */
function applyDataI18nHtml(dict, lang) {
  document.querySelectorAll("[data-i18n-html]").forEach((el) => {
    const key = el.getAttribute("data-i18n-html");
    if (!key) return;
    const v = get(dict, lang, key);
    if (v) el.innerHTML = v;
  });
}

function applyDataI18n(dict, lang) {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (!key) return;
    const v = get(dict, lang, key);
    if (v) el.textContent = v;
  });
}

function applyCommonUi(dict, lang) {
  const c = dict[lang]?.common;
  if (!c) return;

  if (c.nav_toggle_aria) {
    document.querySelectorAll(".navbar-toggler").forEach((btn) => {
      btn.setAttribute("aria-label", c.nav_toggle_aria);
    });
  }

  if (c.theme_toggle_title) {
    document.querySelectorAll(".theme-icon [title]").forEach((ico) => {
      ico.setAttribute("title", c.theme_toggle_title);
    });
  }
}

function applyFooterBlocks(dict, lang) {
  const f = dict[lang]?.footer;
  if (!f) return;

  const path = normalizePathname();

  document.querySelectorAll("footer.footer-style1").forEach((footer) => {
    const cf = path === "/contact" ? dict[lang]?.contact?.contact_footer : null;

    const bar = footer.querySelector(".col-12 .line-bottom");
    if (bar) {
      const spans = bar.querySelectorAll(".opacity-7");
      if (spans[0] && f.tagline_left) spans[0].textContent = f.tagline_left;
      if (spans[1] && f.tagline_right) spans[1].textContent = f.tagline_right;
    }

    const h2 = footer.querySelector(".fo-box-left h2");
    if (cf && h2 && cf.ready_prefix && cf.ready_suffix) {
      h2.textContent = "";
      const s1 = document.createElement("span");
      s1.className = "opacity-7";
      s1.textContent = cf.ready_prefix;
      h2.appendChild(s1);
      h2.appendChild(document.createElement("br"));
      h2.appendChild(document.createTextNode(cf.ready_suffix));
    } else if (path !== "/contact" && h2 && f.ready_prefix && f.ready_suffix) {
      h2.textContent = "";
      const s1 = document.createElement("span");
      s1.className = "opacity-7";
      s1.textContent = f.ready_prefix;
      h2.appendChild(s1);
      h2.appendChild(document.createElement("br"));
      h2.appendChild(document.createTextNode(f.ready_suffix));
    }

    const cap = footer.querySelector(".butn-arrow .text-uppercase");
    if (cap) {
      if (cf?.cta_btn) cap.textContent = cf.cta_btn;
      else if (path !== "/contact" && f.audit_btn) cap.textContent = f.audit_btn;
    }

    const blurb = footer.querySelector(".fo-box-left .f-logo + p");
    if (blurb && f.blurb_line1 && f.blurb_line2) {
      blurb.textContent = "";
      blurb.appendChild(document.createTextNode(f.blurb_line1 + " "));
      blurb.appendChild(document.createElement("br"));
      blurb.appendChild(document.createTextNode(f.blurb_line2));
    }

    footer.querySelectorAll(".fo-box-left .tags a").forEach((a) => {
      const p = pathnameFromHref(a.getAttribute("href"));
      if (p === "/services" && f.packages_link) a.textContent = f.packages_link;
      if (p === "/projects" && f.systems_link) a.textContent = f.systems_link;
      if (p === "/about" && f.why_link) a.textContent = f.why_link;
      if (p === "/contact" && f.contact_link) a.textContent = f.contact_link;
    });

    const h5 = footer.querySelector(".fo-box-right h5");
    if (h5 && f.talk_line1 && f.talk_line2) {
      h5.textContent = "";
      h5.appendChild(document.createTextNode(f.talk_line1 + " "));
      h5.appendChild(document.createElement("br"));
      h5.appendChild(document.createTextNode(f.talk_line2));
    }

    const h6 = footer.querySelector(".subscribe h6");
    if (h6 && f.newsletter_label) {
      const icon = h6.querySelector("i");
      h6.textContent = "";
      if (icon) h6.appendChild(icon.cloneNode(true));
      h6.appendChild(document.createTextNode(" " + f.newsletter_label));
    }

    const ph = footer.querySelector('input[name="subscribe"]');
    if (ph && f.newsletter_placeholder) ph.setAttribute("placeholder", f.newsletter_placeholder);
  });

  document.querySelectorAll(".swiper-button-next span, .slider-contro .swiper-button-next span").forEach((el) => {
    if (el.textContent.trim() === "Next Slide" && f.next_slide) el.textContent = f.next_slide;
  });
  document.querySelectorAll(".swiper-button-prev span, .slider-contro .swiper-button-prev span").forEach((el) => {
    if (el.textContent.trim() === "Prev Slide" && f.prev_slide) el.textContent = f.prev_slide;
  });
}

function applyPageMeta(dict, lang) {
  if (lang !== "sw") return;
  const path = normalizePathname();
  const block = dict.sw?.pages_meta?.[path];
  if (!block) return;
  if (block.title) document.title = block.title;
  if (block.description) {
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", block.description);
  }
  if (block.keywords) {
    let kw = document.querySelector('meta[name="keywords"]');
    if (!kw) {
      kw = document.createElement("meta");
      kw.setAttribute("name", "keywords");
      document.head.appendChild(kw);
    }
    kw.setAttribute("content", block.keywords);
  }
}

function applyDocLang(lang) {
  document.documentElement.lang = lang === "sw" ? "sw" : "en";
}

function bindLangSwitch(wrap, lang) {
  wrap.querySelectorAll("button.nutekh-lang-btn").forEach((b) => {
    b.addEventListener("click", () => {
      const code = b.dataset.lang;
      if (!code || code === lang) return;
      try {
        localStorage.setItem(STORAGE_EXPLICIT, code);
        sessionStorage.setItem(STORAGE_SESSION, code);
      } catch {
        /* ignore */
      }
      window.location.reload();
    });
  });
}

function mountLangSwitch(dict, lang) {
  const L = dict[lang]?.lang_toggle;
  if (!L) return;

  function buildWrap() {
    const wrap = document.createElement("div");
    wrap.className =
      "nutekh-lang-switch d-flex align-items-center ml-15px mr-15px";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", L.aria);

    function makeBtn(code, label, pressed) {
      const b = document.createElement("button");
      b.type = "button";
      b.className =
        "nutekh-lang-btn border-0 bg-transparent text-uppercase fs-12 fw-500 opacity-8" +
        (pressed ? " main-color underline" : "");
      b.dataset.lang = code;
      b.textContent = label;
      b.setAttribute("aria-pressed", pressed ? "true" : "false");
      b.title = code === "en" ? L.title_en : L.title_sw;
      return b;
    }

    wrap.appendChild(makeBtn("sw", L.swahili, lang === "sw"));
    const sep = document.createElement("span");
    sep.className = "opacity-4 px-5px fs-11";
    sep.textContent = "|";
    wrap.appendChild(sep);
    wrap.appendChild(makeBtn("en", L.english, lang === "en"));
    bindLangSwitch(wrap, lang);
    return wrap;
  }

  const containers = document.querySelectorAll("nav.navbar .container");
  if (containers.length) {
    containers.forEach((container) => {
      if (container.querySelector(".nutekh-lang-switch")) return;
      const fresh = buildWrap();
      const dm = container.querySelector(".dark-mode-icon");
      const tn = container.querySelector(".topnav.ml-auto, .topnav");
      if (dm) container.insertBefore(fresh, dm);
      else if (tn) container.insertBefore(fresh, tn);
      else container.appendChild(fresh);
    });
    return;
  }

  const loose = document.querySelector("nav.navbar-expand-lg");
  if (loose && !loose.querySelector(".nutekh-lang-switch")) {
    const tn = loose.querySelector(".topnav");
    if (tn) loose.insertBefore(buildWrap(), tn);
  }
}

function applyCircleCta(dict, lang) {
  const v = dict[lang]?.index?.circlecta;
  if (!v) return;
  const tp = document.getElementById("nutekh-circlecta-textpath");
  if (tp) tp.textContent = v;
}

async function main() {
  const lang = await resolveLang();
  const res = await fetch(DICT_URL, { credentials: "same-origin" });
  if (!res.ok) return;
  const dict = await res.json();

  applyDocLang(lang);
  applyStandardNav(dict, lang);
  applyHamenuFillText(dict, lang);
  applyHamenuSubLinks(dict, lang);
  applyCommonUi(dict, lang);
  applyDataI18n(dict, lang);
  applyDataI18nHtml(dict, lang);
  applyI18nAttrs(dict, lang);
  applyFooterBlocks(dict, lang);
  applyPageMeta(dict, lang);
  applyCircleCta(dict, lang);
  mountLangSwitch(dict, lang);

  requestAnimationFrame(() => {
    document.querySelectorAll(".snap-slider-captions-wrapper").forEach((wrap) => {
      const caps = wrap.querySelectorAll(".snap-slide-caption");
      let maskH = 0;
      caps.forEach((c) => {
        maskH = Math.max(maskH, c.offsetHeight || 0);
      });
      if (maskH > 0) wrap.style.height = maskH + "px";
    });
    if (typeof ScrollTrigger !== "undefined") ScrollTrigger.refresh();
  });
}

await main();
