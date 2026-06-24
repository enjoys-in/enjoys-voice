import nodemailer from 'nodemailer';

/** SMTP settings stored in an `email`-type connector's `config` JSONB. */
export interface EmailConnectorConfig {
  host?: string;
  port?: number;
  /** True for implicit TLS (port 465). STARTTLS is negotiated automatically otherwise. */
  secure?: boolean;
  username?: string;
  password?: string;
  fromEmail?: string;
  fromName?: string;
}

export interface OutboundEmail {
  to: string;
  subject: string;
  body: string;
}

/**
 * Send a plain-text email through an `email` connector's SMTP settings. A fresh
 * transport is created per send (IVR email volume is low and this avoids holding
 * pooled SMTP sockets); throws on a missing host / recipient or an SMTP error so
 * the caller can log and continue the call.
 */
export async function sendConnectorEmail(
  cfg: EmailConnectorConfig,
  msg: OutboundEmail,
): Promise<void> {
  if (!cfg.host) throw new Error('email connector has no SMTP host');
  if (!msg.to.trim()) throw new Error('email has no recipient');

  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port || 587,
    secure: cfg.secure ?? cfg.port === 465,
    auth: cfg.username ? { user: cfg.username, pass: cfg.password || '' } : undefined,
  });

  const from = cfg.fromEmail
    ? cfg.fromName
      ? `${cfg.fromName} <${cfg.fromEmail}>`
      : cfg.fromEmail
    : cfg.username;

  await transport.sendMail({
    from,
    to: msg.to,
    subject: msg.subject || '(no subject)',
    text: msg.body || '',
  });
}
