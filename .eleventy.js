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
