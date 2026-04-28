module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("assets");
  eleventyConfig.addPassthroughCopy("robots.txt");

  /**
   * Site-wide Google Analytics 4 (optional).
   * Set GA_MEASUREMENT_ID (e.g. G-XXXXXXXXXX) in the environment — Vercel: Project → Settings → Environment Variables.
   * Local: copy `.env.example` to `.env` and load before build, or export for one-off builds.
   */
  eleventyConfig.addTransform("analytics-ga4", function (content, outputPath) {
    if (!outputPath || !outputPath.endsWith(".html")) {
      return content;
    }
    const gaId = process.env.GA_MEASUREMENT_ID;
    if (!gaId || !content.includes("</head>")) {
      return content;
    }
    const snippet = `
    <!-- GA4 (Nutekh) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=${gaId}"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', '${gaId}', { send_page_view: true });
    </script>`;
    return content.replace("</head>", `${snippet}
</head>`);
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
