export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, message: "Method not allowed" });
  }

  const body = req.body || {};
  const name = String(body.name || body.fullName || "").trim();
  const email = String(body.email || "").trim();
  const message = String(body.message || "").trim();
  const honey = String(body.company || body.website || "").trim();

  if (honey) {
    return res.status(200).json({ ok: true, message: "Received" });
  }

  if (!name || !email || !message) {
    return res.status(400).json({
      ok: false,
      message: "Please provide name, email, and message."
    });
  }

  return res.status(200).json({
    ok: true,
    message: "Thanks. Your message has been received."
  });
}
