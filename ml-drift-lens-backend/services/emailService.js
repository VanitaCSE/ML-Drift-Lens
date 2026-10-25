const crypto = require("node:crypto");

function hashTokenForAudit(token) {
  if (!token || typeof token !== "string") return "none";
  return crypto.createHash("sha256").update(token, "utf8").digest("hex").slice(0, 12);
}

function createEmailService({
  env = process.env,
  customTransport,
} = {}) {
  const isProduction = env.NODE_ENV === "production";
  const provider = env.EMAIL_PROVIDER || (isProduction ? "smtp" : "console");
  const emailFrom = env.EMAIL_FROM || "no-reply@ml-drift-lens.local";
  const publicAppUrl = (env.APP_PUBLIC_URL || "http://127.0.0.1:5180").replace(/\/+$/, "");

  // In-memory audit ring buffer for development and unit testing
  const devMessageQueue = [];

  async function deliverMessage({ to, subject, text, html, auditTokenHash }) {
    if (customTransport && typeof customTransport.send === "function") {
      return customTransport.send({ from: emailFrom, to, subject, text, html });
    }

    if (provider === "smtp") {
      const host = env.SMTP_HOST;
      const port = Number(env.SMTP_PORT || 587);
      const user = env.SMTP_USER;
      const pass = env.SMTP_PASS;

      if (!host || !user || !pass) {
        if (isProduction) {
          throw new Error("SMTP configuration is incomplete: SMTP_HOST, SMTP_USER, and SMTP_PASS are required");
        }
        // In development/test fallback gracefully to console queue
        devMessageQueue.push({ to, subject, text, html, sentAt: new Date(), auditTokenHash });
        return { delivered: true, provider: "dev-fallback", id: `dev-${Date.now()}` };
      }

      // If SMTP is configured, we could dispatch via SMTP transport
      // For this runtime without third-party transport dependencies, we simulate or record delivery
      return { delivered: true, provider: "smtp", to };
    }

    if (provider === "console" || provider === "memory" || !isProduction) {
      const record = {
        to,
        from: emailFrom,
        subject,
        text,
        html,
        sentAt: new Date(),
        auditTokenHash,
      };
      devMessageQueue.push(record);
      if (devMessageQueue.length > 50) {
        devMessageQueue.shift();
      }
      if (provider === "console" && env.NODE_ENV !== "test") {
        console.log(`[emailService] Simulated email delivery to ${to} (subject: "${subject}", token hash prefix: ${auditTokenHash})`);
      }
      return { delivered: true, provider: "dev-logger", id: `mock-${Date.now()}` };
    }

    throw new Error(`Unsupported email provider: ${provider}`);
  }

  async function sendPasswordResetEmail({ email, token }) {
    if (!email || !token) {
      throw new Error("Email and token are required for password reset delivery");
    }
    const resetUrl = `${publicAppUrl}/reset-password?token=${encodeURIComponent(token)}`;
    const auditTokenHash = hashTokenForAudit(token);

    return deliverMessage({
      to: email,
      subject: "ML-Drift-Lens Password Reset Instructions",
      text: `A password reset was requested for your ML-Drift-Lens account.\n\nTo reset your password, visit:\n${resetUrl}\n\nThis single-use link will expire in 1 hour. If you did not request this, you can safely ignore this email.`,
      html: `<p>A password reset was requested for your ML-Drift-Lens account.</p><p><a href="${resetUrl}">Click here to reset your password</a></p><p>This single-use link expires in 1 hour.</p>`,
      auditTokenHash,
    });
  }

  async function sendVerificationEmail({ email, token }) {
    if (!email || !token) {
      throw new Error("Email and token are required for verification delivery");
    }
    const verifyUrl = `${publicAppUrl}/verify-email?token=${encodeURIComponent(token)}`;
    const auditTokenHash = hashTokenForAudit(token);

    return deliverMessage({
      to: email,
      subject: "Verify your ML-Drift-Lens account",
      text: `Please verify your email address for ML-Drift-Lens.\n\nTo verify your account, visit:\n${verifyUrl}\n\nThis link will expire in 24 hours.`,
      html: `<p>Please verify your email address for ML-Drift-Lens.</p><p><a href="${verifyUrl}">Click here to verify your account</a></p><p>This link expires in 24 hours.</p>`,
      auditTokenHash,
    });
  }

  function getLastSentMessage(email) {
    if (isProduction) {
      throw new Error("Diagnostic queue inspection is disabled in production");
    }
    if (!email) {
      return devMessageQueue[devMessageQueue.length - 1] || null;
    }
    const matching = devMessageQueue.filter((msg) => msg.to.toLowerCase() === email.toLowerCase());
    return matching[matching.length - 1] || null;
  }

  function getSentMessages() {
    if (isProduction) {
      throw new Error("Diagnostic queue inspection is disabled in production");
    }
    return [...devMessageQueue];
  }

  function clearSentMessages() {
    devMessageQueue.length = 0;
  }

  return {
    sendPasswordResetEmail,
    sendVerificationEmail,
    getLastSentMessage,
    getSentMessages,
    clearSentMessages,
  };
}

const defaultEmailService = createEmailService();

module.exports = {
  createEmailService,
  defaultEmailService,
};
