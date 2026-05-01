require("dotenv").config();

/** GA4 Measurement IDs look like G- followed by letters/digits (no spaces). */
function isValidGa4MeasurementId(id) {
  return typeof id === "string" && /^G-[A-Z0-9]+$/i.test(id.trim());
}

module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("assets");
  eleventyConfig.addPassthroughCopy("robots.txt");

  /**
   * Site-wide Google Analytics 4 (optional).
   * Set GA_MEASUREMENT_ID (e.g. G-XXXXXXXXXX) in `.env` locally or in Vercel → Environment Variables.
   * Build-time injection: every HTML output gets one gtag snippet before the first </head>.
   */
  eleventyConfig.addTransform("analytics-ga4", function (content, outputPath) {
    if (!outputPath || !outputPath.endsWith(".html")) {
      return content;
    }
    const raw = process.env.GA_MEASUREMENT_ID;
    const gaId = raw ? String(raw).trim() : "";
    if (!gaId) {
      return content;
    }
    if (!isValidGa4MeasurementId(gaId)) {
      console.warn(
        "[analytics-ga4] GA_MEASUREMENT_ID is set but invalid; expected format G-XXXXXXXXXX. Skipping injection."
      );
      return content;
    }

    const closeHead = content.indexOf("</head>");
    if (closeHead === -1) {
      return content;
    }

    const snippet = `
    <!-- GA4 (Nutekh) -->
    <link rel="dns-prefetch" href="https://www.googletagmanager.com">
    <link rel="preconnect" href="https://www.googletagmanager.com" crossorigin>
    <link rel="preconnect" href="https://www.google-analytics.com" crossorigin>
    <script async src="https://www.googletagmanager.com/gtag/js?id=${gaId}"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', '${gaId}', {
        send_page_view: true,
        cookie_flags: 'SameSite=Lax;Secure'
      });
    </script>`;

    return (
      content.slice(0, closeHead) +
      snippet +
      "\n" +
      content.slice(closeHead)
    );
  });

  /**
   * Kiswahili / English switching (Nutekh): ES module runs with top-level await before later scripts bundle.
   */
  eleventyConfig.addTransform("nutekh-i18n-module", function (content, outputPath) {
    if (!outputPath || !outputPath.endsWith(".html")) return content;
    if (content.includes("nutekh-i18n.js")) return content;

    const tag =
      '\n<script type="module" src="/assets/js/nutekh-i18n.js"></script>\n';

    const jq = '<script src="assets/js/jquery-3.6.0.min.js"';
    const jqui = '<script src="assets/js/jquery-3.7.1.min.js"';
    const insertAt =
      content.indexOf(jq) !== -1
        ? content.indexOf(jq)
        : content.indexOf(jqui) !== -1
          ? content.indexOf(jqui)
          : content.lastIndexOf("</body>");
    if (insertAt === -1) return content;
    return content.slice(0, insertAt) + tag + content.slice(insertAt);
  });

  /**
   * Site-wide Nutekh chat drawer (Resend-connected quick message + WhatsApp/email).
   */
  eleventyConfig.addTransform("nutekh-chat-widgets", function (content, outputPath) {
    if (!outputPath || !outputPath.endsWith(".html")) return content;
    if (content.includes('id="nutekh-chat-root"')) return content;

    const cssLink = '\n<link rel="stylesheet" href="/assets/css/nutekh-chat.css">\n';
    const headClose = content.indexOf("</head>");
    if (headClose === -1) return content;
    let merged = content.slice(0, headClose) + cssLink + content.slice(headClose);

    const widget = `
<!-- Nutekh site chat -->
<div id="nutekh-chat-root" class="nutekh-chat-root" aria-hidden="true">
<div class="nutekh-chat-panel-backdrop" aria-hidden="true"></div>
<div id="nutekh-chat-panel" class="nutekh-chat-panel" role="dialog" aria-modal="true" aria-labelledby="nutekh-chat-title" tabindex="-1" hidden>
<div class="nutekh-chat-panel-inner">
<div class="nutekh-chat-head">
<div>
<h4 class="nutekh-chat-heading mb-0" id="nutekh-chat-title" data-i18n="chat.title">Chat with Nutekh</h4>
<p data-i18n="chat.subtitle">We typically reply within one business day (EAT).</p>
</div>
<button type="button" class="nutekh-chat-close" data-i18n-aria="chat.close_aria">
<span aria-hidden="true">&times;</span>
</button>
</div>
<div class="nutekh-chat-quick">
<a class="nutekh-chat-wa" href="https://wa.me/255748000000" target="_blank" rel="noopener noreferrer">
<i class="fa-brands fa-whatsapp" aria-hidden="true"></i>
<span data-i18n="chat.whatsapp_label">WhatsApp</span>
</a>
<a class="nutekh-chat-mail" href="mailto:info@nutekh.com">
<span data-i18n="chat.email_label">Email</span>
</a>
</div>
<div class="nutekh-chat-body">
<p class="nutekh-chat-note" data-i18n="chat.form_note">Quick message — same inbox as our contact page.</p>
<form id="nutekh-chat-form" novalidate>
<div style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden" aria-hidden="true">
<input type="text" name="website" tabindex="-1" autocomplete="off" value="">
</div>
<div class="nutekh-chat-field">
<input type="text" name="name" required autocomplete="name" data-i18n-placeholder="chat.name_ph" placeholder="Your name">
</div>
<div class="nutekh-chat-field">
<input type="email" name="email" required autocomplete="email" data-i18n-placeholder="chat.email_ph" placeholder="Work email">
</div>
<div class="nutekh-chat-field">
<input type="text" name="subject" autocomplete="off" data-i18n-placeholder="chat.subject_ph" placeholder="Topic (optional)">
</div>
<div class="nutekh-chat-field">
<textarea name="message" required rows="3" data-i18n-placeholder="chat.message_ph" placeholder="How can we help?"></textarea>
</div>
<div class="nutekh-chat-submit-wrap">
<button type="submit" class="nutekh-chat-submit"><span data-i18n="chat.submit">Send message</span></button>
</div>
<div id="nutekh-chat-feedback" class="nutekh-chat-feedback" role="status"></div>
</form>
</div>
</div>
</div>
<button type="button" id="nutekh-chat-toggle" class="nutekh-chat-toggle" aria-expanded="false" aria-controls="nutekh-chat-panel" data-i18n-aria="chat.toggle_aria">
<i class="fa-solid fa-comment-dots nutekh-chat-toggle-icon-open" aria-hidden="true"></i>
<i class="fa-solid fa-xmark nutekh-chat-toggle-icon-close" aria-hidden="true"></i>
</button>
</div>
<script src="/assets/js/nutekh-chat.js" defer></script>
`;

    const bodyClose = merged.lastIndexOf("</body>");
    if (bodyClose === -1) return merged;
    return merged.slice(0, bodyClose) + widget + merged.slice(bodyClose);
  });

  // Default output: `_site/about/index.html` so URLs like `/about` work without `.html` in the browser.

  return {
    dir: {
      input: ".",
      includes: "_includes",
      output: "_site"
    },
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
    dataTemplateEngine: "njk"
  };
};
