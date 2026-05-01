const querystring = require("node:querystring");
const { Resend } = require("resend");

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseBody(req) {
  const b = req.body;
  if (b === undefined || b === null) return {};
  if (typeof b === "object" && !Buffer.isBuffer(b)) return b;
  const s = Buffer.isBuffer(b) ? b.toString("utf8") : String(b);
  const trimmed = s.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return {};
    }
  }
  return querystring.parse(trimmed);
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method === "OPTIONS") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, message: "Method not allowed" });
  }

  const body = parseBody(req);
  const name = String(body.name || body.fullName || "").trim();
  const email = String(body.email || "").trim();
  const message = String(body.message || "").trim();
  const userSubject = String(body.subject || "").trim();
  const honey = String(body.company || body.website || "").trim();

  const subscribeEmail = String(body.subscribe || "").trim();

  if (honey) {
    return res.status(200).json({ ok: true, message: "Received" });
  }

  if (
    subscribeEmail &&
    !name &&
    !message &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subscribeEmail)
  ) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey?.trim()?.startsWith("re_")) {
      return res.status(503).json({
        ok: false,
        message: "Signup is unavailable. Email info@nutekh.com to subscribe.",
      });
    }

    try {
      const resend = new Resend(apiKey.trim());
      const from = process.env.RESEND_FROM || "Nutekh <info@nutekh.com>";
      const to = process.env.RESEND_TO || "info@nutekh.com";
      await resend.emails.send({
        from,
        to: [to],
        replyTo: subscribeEmail,
        subject: `[Nutekh newsletter] ${subscribeEmail}`,
        html: `<p><strong>New newsletter signup</strong></p><p>${escapeHtml(subscribeEmail)}</p>`,
      });
    } catch (err) {
      console.error("[api/contact] Resend subscribe error:", err.message || err);
      return res.status(502).json({
        ok: false,
        message: "Could not subscribe right now. Please try again or email info@nutekh.com.",
      });
    }

    return res.status(200).json({
      ok: true,
      message: "Thanks — you are on the list.",
    });
  }

  if (!name || !email || !message) {
    return res.status(400).json({
      ok: false,
      message: "Please provide name, email, and message.",
    });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey?.trim()?.startsWith("re_")) {
    console.error("[api/contact] RESEND_API_KEY missing or invalid prefix");
    return res.status(503).json({
      ok: false,
      message:
        "We could not deliver that from the site yet. Email info@nutekh.com or WhatsApp instead.",
    });
  }

  const from = process.env.RESEND_FROM || "Nutekh <info@nutekh.com>";
  const to = process.env.RESEND_TO || "info@nutekh.com";
  const subjectLine = `[Nutekh contact] ${name}${userSubject ? ` — ${userSubject}` : ""}`;

  const html = `
    <p><strong>Name:</strong> ${escapeHtml(name)}</p>
    <p><strong>Email:</strong> ${escapeHtml(email)}</p>
    ${userSubject ? `<p><strong>Organisation / topic:</strong> ${escapeHtml(userSubject)}</p>` : ""}
    <p><strong>Message:</strong></p>
    <p style="white-space:pre-wrap">${escapeHtml(message)}</p>
  `.trim();

  try {
    const resend = new Resend(apiKey.trim());
    const { error } = await resend.emails.send({
      from,
      to: [to],
      replyTo: email,
      subject: subjectLine,
      html,
    });

    if (error) {
      console.error("[api/contact] Resend API error:", error);
      return res.status(502).json({
        ok: false,
        message: "Could not send your message. Please email info@nutekh.com or try again.",
      });
    }

    return res.status(200).json({
      ok: true,
      message: "Thanks. Your message has been received—we will reply soon.",
    });
  } catch (err) {
    console.error("[api/contact]", err.message || err);
    return res.status(502).json({
      ok: false,
      message: "Could not send your message. Please email info@nutekh.com or try again.",
    });
  }
};
