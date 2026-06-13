// Inbound PSTN call router — the decision the Twilio voice webhook makes the
// moment a call arrives, using the same presence/settings the SIP path uses.
//
//   owner of this DID?              no  -> reject (number not in service)
//   caller blocked by owner?        yes -> reject (declined)
//   owner ONLINE (registered)?      yes -> BRIDGE audio to their browser
//   else (offline) fallback chain, first match wins:
//        forward-on-unavailable set -> FORWARD (Twilio <Dial>s that number)
//        AI agent enabled           -> AI answers (speech -> AI -> speak back)
//        voicemail enabled          -> VOICEMAIL (greeting + record)
//        none                       -> reject (unavailable)
//
// NOTE: at HTTP answer-time Twilio only tells us registered-or-not, so the SIP
// path's separate "busy" / "no-answer" states collapse into this single
// "offline" branch. Detecting a browser that rings-but-doesn't-answer needs a
// Stream status callback and is a later enhancement.
//
// Decoupling: depends only on the structural `CallRouterDb` below, which the
// live DatabaseService already satisfies — no hard import of the app's services.

/** The minimal slice of DatabaseService this router reads. */
export interface CallRouterDb {
  findPstnForwardTarget(
    calledNumber: string,
  ): { user: { extension: string }; target: string } | undefined;
  isBlocked(calleeExtension: string, callerNumber: string): boolean;
  getRegistration(extension: string): unknown;
  getForwarding(extension: string): {
    busy?: string;
    noAnswer?: string;
    unavailable?: string;
  };
}

/** Feature switches that gate the offline fallback branches. */
export interface CallRouterConfig {
  aiEnabled: boolean;
  voicemailEnabled: boolean;
}

export type CallDecision =
  | { action: "bridge"; extension: string; bridgeId: string }
  | { action: "ai"; extension: string }
  | { action: "forward"; extension: string; target: string }
  | { action: "voicemail"; extension: string }
  | { action: "reject"; reason: "no-did" | "blocked" | "unavailable" };

/** Decide what to do with an inbound PSTN call to `calledNumber` from `callerNumber`. */
export function decideCall(
  calledNumber: string,
  callerNumber: string,
  db: CallRouterDb,
  cfg: CallRouterConfig,
): CallDecision {
  // 1. Which user owns this DID (and has PSTN→browser enabled)?
  const match = db.findPstnForwardTarget(calledNumber);
  if (!match) return { action: "reject", reason: "no-did" };
  const ext = match.user.extension;

  // 2. Block list (applies whether the owner is online or not).
  if (callerNumber && db.isBlocked(ext, callerNumber)) {
    return { action: "reject", reason: "blocked" };
  }

  // 3. Online? Registered target (or the owner) means a browser can take it.
  const online = !!db.getRegistration(match.target) || !!db.getRegistration(ext);
  if (online) {
    return { action: "bridge", extension: ext, bridgeId: match.target };
  }

  // 4. Offline fallback chain — first applicable wins.
  const fwd = db.getForwarding(ext);
  if (fwd.unavailable) {
    return { action: "forward", extension: ext, target: fwd.unavailable };
  }
  if (cfg.aiEnabled) return { action: "ai", extension: ext };
  if (cfg.voicemailEnabled) return { action: "voicemail", extension: ext };
  return { action: "reject", reason: "unavailable" };
}
