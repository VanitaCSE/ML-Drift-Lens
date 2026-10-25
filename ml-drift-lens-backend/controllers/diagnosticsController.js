function createDatabaseDiagnosticHandler(pool, logger = console) {
  return async function databaseDiagnostic(req, res) {
    try {
      const result = await pool.query("SELECT NOW()");
      return res.json({ success: true, time: result.rows[0] });
    } catch (error) {
      logger.error("Database diagnostic failed", {
        name: typeof error?.name === "string" ? error.name : "Error",
        code: typeof error?.code === "string" ? error.code : undefined,
      });
      return res.status(500).json({
        success: false,
        error: "Database diagnostic failed",
      });
    }
  };
}

function isLoopbackIp(ip) {
  if (!ip) return false;
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function createEmailPreviewHandler(emailService) {
  return async function emailPreviewHandler(req, res) {
    const remoteIp = req.socket?.remoteAddress || req.ip;
    if (!isLoopbackIp(remoteIp)) {
      return res.status(403).json({
        success: false,
        error: "Email preview is restricted to local loopback access",
      });
    }

    try {
      if (req.query?.all === "true") {
        const messages = emailService.getSentMessages ? emailService.getSentMessages() : [];
        return res.status(200).json({
          success: true,
          simulated: true,
          notice: "Simulated emails captured from local memory transport. No real email was sent to an inbox.",
          count: messages.length,
          messages: messages.map((msg) => {
            const urlMatch = msg.text?.match(/https?:\/\/[^\s]+/);
            const foundUrl = urlMatch ? urlMatch[0] : null;
            return {
              to: msg.to,
              from: msg.from,
              subject: msg.subject,
              sentAt: msg.sentAt,
              resetUrl: foundUrl,
              actionUrl: foundUrl,
              auditTokenHash: msg.auditTokenHash,
            };
          }),
        });
      }

      const email = typeof req.query?.email === "string" ? req.query.email.trim() : "";
      const lastMessage = emailService.getLastSentMessage ? emailService.getLastSentMessage(email || undefined) : null;

      if (!lastMessage) {
        return res.status(200).json({
          success: true,
          simulated: true,
          message: email
            ? `No simulated messages found for ${email}`
            : "No simulated messages in the development queue",
          preview: null,
        });
      }

      const urlMatch = lastMessage.text?.match(/https?:\/\/[^\s]+/);
      const actionUrl = urlMatch ? urlMatch[0] : null;

      return res.status(200).json({
        success: true,
        simulated: true,
        notice: "Simulated email captured from local memory transport. No real email was sent to an inbox.",
        preview: {
          to: lastMessage.to,
          from: lastMessage.from,
          subject: lastMessage.subject,
          sentAt: lastMessage.sentAt,
          resetUrl: actionUrl,
          actionUrl,
          text: lastMessage.text,
          auditTokenHash: lastMessage.auditTokenHash,
        },
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: "Failed to retrieve local email preview",
      });
    }
  };
}

module.exports = {
  createDatabaseDiagnosticHandler,
  createEmailPreviewHandler,
  isLoopbackIp,
};
