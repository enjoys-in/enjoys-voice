import type { CallLog, Voicemail } from '@/core';
import type { DatabaseService } from './database.service';
import type { PushService } from './push.service';
import type { NotificationMailer } from './notification-mailer';

/**
 * Fans missed-call and new-voicemail events out to a user's opted-in channels
 * (mobile push + email), honouring their per-user preferences. It is fully
 * best-effort and off the call path: it listens to DatabaseService events, so a
 * slow/failed notification never affects call handling.
 *
 * Wire it once at startup:
 *   db.on(DbEvent.CallMissed, (c) => notifications.onMissedCall(c));
 *   db.on(DbEvent.VoicemailSaved, (v) => notifications.onVoicemail(v));
 */
export class NotificationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly push: PushService,
    private readonly mailer: NotificationMailer,
  ) {}

  /** A call the user missed — push + email per their preferences. */
  onMissedCall(call: CallLog): void {
    const calleeExt = call.toExt;
    if (!calleeExt) return; // external/PSTN callee (no local user to notify)
    const user = this.db.getUser(calleeExt);
    if (!user) return;

    const from = call.from;
    const fromName = call.fromName || from;
    const timestamp = call.startTime;

    if (user.notifyMissedPush) {
      void this.push.sendMissedCall(calleeExt, { callId: call.id, from, fromName, timestamp });
    }
    if (user.notifyMissedEmail && user.notificationEmail) {
      void this.mailer.sendMissedCall(user.notificationEmail, { from, fromName, timestamp });
    }
  }

  /** A voicemail left for the user — push + email per their preferences. */
  onVoicemail(vm: Voicemail): void {
    const user = this.db.getUser(vm.mailbox);
    if (!user) return;

    const from = vm.from;
    const fromName = vm.fromName || from;
    const duration = vm.duration ?? 0;

    if (user.notifyVoicemailPush) {
      void this.push.sendNewVoicemail(vm.mailbox, { voicemailId: vm.id, from, fromName, duration });
    }
    if (user.notifyVoicemailEmail && user.notificationEmail) {
      void this.mailer.sendVoicemail(user.notificationEmail, { from, fromName, duration });
    }
  }
}
