/**
 * Email service — address validation + OTP delivery by email.
 *
 * Two separate jobs, because they answer different questions:
 *
 *  1. validateEmailAddress()  "Is this a real, deliverable-looking address?"
 *     - syntax check, then a DNS MX lookup on the domain. Rejects typos and
 *       made-up domains (john@gmial.con). It CANNOT prove that the specific
 *       mailbox exists — no service can without sending a message (SMTP
 *       probing is blocked/unreliable at Gmail, Outlook, etc.). DNS timeouts
 *       fail OPEN so a flaky resolver never blocks a legitimate user.
 *
 *  2. sendEmail()/sendOTPEmail()  The real proof of ownership: the user must
 *     type the code that only arrives in that inbox.
 *
 * Delivery uses plain SMTP through nodemailer (no Firebase involved — Firebase
 * is for push notifications / its own auth, not for sending arbitrary mail).
 * Configure with env vars:
 *   SMTP_HOST, SMTP_PORT (465 = TLS, 587 = STARTTLS), SMTP_USER, SMTP_PASS,
 *   EMAIL_FROM  (e.g. "HealthQueue+ <yourgmail@gmail.com>")
 * Works with Gmail (App Password), Brevo, Mailgun SMTP, Outlook, etc.
 * If SMTP_* is not set, sendEmail() reports { mock:true } and the caller
 * decides what to do (dev logs the code; production refuses).
 */
const dns = require('dns').promises;

// Pragmatic RFC-5322 subset: one @, no spaces, dotted domain, TLD of 2+ letters.
const EMAIL_REGEX = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;
const DNS_TIMEOUT_MS = 3000;

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('DNS timeout'), { code: 'ETIMEOUT' })), ms)),
  ]);

// Guards against a broken resolver on the host: if even google.com can't be
// resolved, an ENOTFOUND for the user's domain says nothing about the domain,
// so we must not reject real addresses. Result cached for 5 minutes.
let resolverCheck = { at: 0, ok: true };
const resolverIsHealthy = async () => {
  if (Date.now() - resolverCheck.at < 5 * 60 * 1000) return resolverCheck.ok;
  let ok = true;
  try {
    await withTimeout(dns.resolve4('google.com'), DNS_TIMEOUT_MS);
  } catch (_) {
    ok = false;
  }
  resolverCheck = { at: Date.now(), ok };
  return ok;
};

/**
 * @returns {Promise<{ok:boolean, email?:string, reason?:string}>}
 */
const validateEmailAddress = async (raw) => {
  const email = (raw || '').toString().trim().toLowerCase();
  if (!email) return { ok: false, reason: 'Email is required.' };
  if (email.length > 254 || !EMAIL_REGEX.test(email)) {
    return { ok: false, reason: 'Please enter a valid email address.' };
  }

  const domain = email.split('@')[1];
  try {
    const mx = await withTimeout(dns.resolveMx(domain), DNS_TIMEOUT_MS);
    if (mx && mx.length > 0) return { ok: true, email };
    // Fall through to the A-record check below (RFC 5321 implicit MX).
  } catch (err) {
    // Domain definitively has no mail records -> fall through to A check.
    // Resolver trouble (timeout, SERVFAIL, refused) -> fail open.
    if (!['ENOTFOUND', 'ENODATA'].includes(err.code)) return { ok: true, email };
  }

  try {
    const a = await withTimeout(dns.resolve4(domain), DNS_TIMEOUT_MS);
    if (a && a.length > 0) return { ok: true, email };
  } catch (err) {
    if (!['ENOTFOUND', 'ENODATA'].includes(err.code)) return { ok: true, email };
  }
  if (!(await resolverIsHealthy())) return { ok: true, email }; // can't trust a broken resolver
  return { ok: false, reason: `The email domain "${domain}" cannot receive mail. Check for typos.` };
};

// ── SMTP transport (lazy, so the server still boots if nodemailer or the
//    SMTP_* env vars are missing) ────────────────────────────────────────────
let transporter;
const getTransporter = () => {
  if (transporter !== undefined) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    transporter = null;
    return transporter;
  }
  try {
    const nodemailer = require('nodemailer');
    const port = parseInt(SMTP_PORT || '587', 10);
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
  } catch (err) {
    console.error('Email disabled — nodemailer is not installed (npm i nodemailer):', err.message);
    transporter = null;
  }
  return transporter;
};

/** @returns {Promise<{success:boolean, mock?:boolean, error?:string}>} */
const sendEmail = async ({ to, subject, text, html }) => {
  const t = getTransporter();
  if (!t) {
    console.warn(`[EMAIL MOCK] To: ${to} | Subject: ${subject}`);
    return { success: false, mock: true, error: 'Email is not configured on the server.' };
  }
  try {
    await t.sendMail({
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to,
      subject,
      text,
      html,
    });
    return { success: true };
  } catch (err) {
    console.error('Email send error:', err.message);
    return { success: false, error: err.message };
  }
};

const shell = (title, bodyHtml) => `
<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px">
  <h2 style="margin:0 0 12px;color:#0f766e">HealthQueue+</h2>
  <h3 style="margin:0 0 16px;color:#111827">${title}</h3>
  ${bodyHtml}
  <p style="margin-top:24px;font-size:12px;color:#6b7280">If you didn't request this, you can ignore this email.</p>
</div>`;

const sendOTPEmail = (to, otpCode, minutes = 5) =>
  sendEmail({
    to,
    subject: 'Your HealthQueue+ password reset code',
    text: `Your HealthQueue+ password reset code is ${otpCode}. It expires in ${minutes} minutes. Do not share this code.`,
    html: shell(
      'Password reset code',
      `<p style="color:#374151">Use this code to reset your password. It expires in ${minutes} minutes.</p>
       <p style="font-size:32px;letter-spacing:8px;font-weight:bold;color:#0f766e;margin:16px 0">${otpCode}</p>
       <p style="color:#374151">Never share this code with anyone.</p>`
    ),
  });

const sendPasswordChangedEmail = (to) =>
  sendEmail({
    to,
    subject: 'Your HealthQueue+ password was changed',
    text: 'Your HealthQueue+ password was just changed. If this was not you, contact your system administrator immediately.',
    html: shell(
      'Password changed',
      `<p style="color:#374151">Your password was just changed. If this wasn't you, contact your system administrator immediately.</p>`
    ),
  });

module.exports = { validateEmailAddress, sendEmail, sendOTPEmail, sendPasswordChangedEmail, EMAIL_REGEX };
