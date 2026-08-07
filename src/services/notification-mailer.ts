import { sendConnectorEmail, type EmailConnectorConfig } from './mailer';

/**
 * Env-configured SMTP sender for missed-call / voicemail notification emails.
 * Kept separate from the IVR connector mailer so it has its own dedicated
 * mailbox. Disabled (a no-op) when `NOTIFICATION_SMTP_HOST` is empty.
 *
 * Env: NOTIFICATION_SMTP_HOST, NOTIFICATION_SMTP_PORT, NOTIFICATION_SMTP_USER,
 *      NOTIFICATION_SMTP_PASS, NOTIFICATION_FROM_EMAIL, NOTIFICATION_FROM_NAME.
 */
export class NotificationMailer {
  private readonly cfg: EmailConnectorConfig;

  constructor() {
    const port = process.env.NOTIFICATION_SMTP_PORT ? parseInt(process.env.NOTIFICATION_SMTP_PORT, 10) : 587;
    this.cfg = {
      host: process.env.NOTIFICATION_SMTP_HOST || '',
      port,
      secure: process.env.NOTIFICATION_SMTP_SECURE === 'true' || port === 465,
      username: process.env.NOTIFICATION_SMTP_USER,
      password: process.env.NOTIFICATION_SMTP_PASS,
      fromEmail: process.env.NOTIFICATION_FROM_EMAIL,
      fromName: process.env.NOTIFICATION_FROM_NAME || 'Enjoys Voice',
    };
  }

  get enabled(): boolean {
    return !!this.cfg.host;
  }

  /** Notify `toEmail` of a missed call. Best-effort; never throws. */
  async sendMissedCall(toEmail: string, p: { from: string; fromName: string; timestamp: string }): Promise<void> {
    if (!this.enabled || !toEmail) return;
    const when = formatWhen(p.timestamp);
    await sendConnectorEmail(this.cfg, {
      to: toEmail,
      subject: `Missed call from ${p.fromName}`,
      body: `You missed a call from ${p.fromName} (${p.from})${when ? ` at ${when}` : ''}.`,
    }).catch((err) => console.warn(`⚠️  Notify email (missed) failed: ${(err as Error).message}`));
  }

  /** Notify `toEmail` of a new voicemail. Best-effort; never throws. */
  async sendVoicemail(toEmail: string, p: { from: string; fromName: string; duration: number }): Promise<void> {
    if (!this.enabled || !toEmail) return;
    await sendConnectorEmail(this.cfg, {
      to: toEmail,
      subject: `New voicemail from ${p.fromName}`,
      body: `${p.fromName} (${p.from}) left you a ${p.duration}s voicemail. Sign in to listen.`,
    }).catch((err) => console.warn(`⚠️  Notify email (voicemail) failed: ${(err as Error).message}`));
  }
}

/** Format an ISO timestamp for an email body; empty on a bad/absent value. */
function formatWhen(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toUTCString();
}
