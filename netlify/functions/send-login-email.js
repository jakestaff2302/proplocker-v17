const { Resend } = require("resend");
const { json, parseBody } = require("./_lib/http");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const body = parseBody(event);
    const email = String(body.email || "").trim().toLowerCase();
    const loginId = String(body.loginId || "").trim();
    const name = String(body.name || "").trim();
    const link = String(body.link || "https://proplocker.app/login").trim();

    if (!email || !loginId) {
      return json(400, { error: "Missing email or loginId" });
    }

    const resendKey = process.env.RESEND_API_KEY;
    const emailFrom = process.env.EMAIL_FROM;

    if (!resendKey || !emailFrom) {
      return json(200, {
        ok: true,
        sent: false,
        mode: "fallback",
        reason: "Missing RESEND_API_KEY or EMAIL_FROM"
      });
    }

    const resend = new Resend(resendKey);

    const subject = "Welcome to Prop Locker - Your Login Details";
    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111;">
        <h2 style="margin:0 0 12px;">Welcome${name ? `, ${name}` : ""}.</h2>
        <p>Your Prop Locker terminal account has been provisioned.</p>
        <div style="padding:14px;border:1px solid #ddd;border-radius:10px;background:#f7f7f7;">
          <div style="font-size:12px;color:#555;margin-bottom:6px;">Login ID</div>
          <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:22px;font-weight:700;">${loginId}</div>
        </div>
        <p style="margin-top:16px;">Login here: <a href="${link}">${link}</a></p>
        <p style="margin-top:24px;font-size:12px;color:#777;">Infrastructure for professional traders.</p>
      </div>
    `;

    const result = await resend.emails.send({
      from: emailFrom,
      to: email,
      subject,
      html
    });

    if (result.error) {
      return json(500, { error: result.error.message || "Failed to send email" });
    }

    return json(200, { ok: true, sent: true, mode: "resend" });
  } catch (error) {
    return json(500, { error: error.message || "Server error" });
  }
};
