"use client";

import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { Phone } from "lucide-react";
import { useAuthStore, useCallStore, useVoicemailStore } from "../stores";
import { useSettingsStore } from "../stores";
import { useContactStore } from "../stores";
import { useConferenceStore } from "../stores";
import { BottomNav, type TabId } from "./layout/BottomNav";
import { Sidebar } from "./layout/Sidebar";
import { AppHeader } from "./layout/AppHeader";
import { LoginScreen } from "./screens/LoginScreen";
import { ActiveCallScreen } from "./screens/ActiveCallScreen";
import { IncomingCallSheet } from "./call/IncomingCallSheet";
import { IncomingConferenceSheet } from "./call/IncomingConferenceSheet";
import { SplashScreen } from "./SplashScreen";
import {
  ListScreenSkeleton,
  ContactsScreenSkeleton,
  SettingsScreenSkeleton,
} from "./screens/ScreenSkeletons";
import { useSipPhone } from "../hooks/useSipPhone";
import { useWebSocket } from "../hooks/useWebSocket";
import { useBrowserBridge } from "../hooks/useBrowserBridge";
import { goApi } from "../lib/go-api";
import { CallStatus, CallDirection } from "../types";

// Tab screens are code-split and mounted on first visit, so each tab's bundle
// AND its data fetch only happen when the user actually opens that tab — the
// landing tab no longer pays for all five screens up front. (React.lazy needs
// a default export; our screens are named, so we map them here.)
const CallsScreen = lazy(() =>
  import("./screens/CallsScreen").then((m) => ({ default: m.CallsScreen }))
);
const ContactsScreen = lazy(() =>
  import("./screens/ContactsScreen").then((m) => ({ default: m.ContactsScreen }))
);
const KeypadScreen = lazy(() =>
  import("./screens/KeypadScreen").then((m) => ({ default: m.KeypadScreen }))
);
const VoicemailScreen = lazy(() =>
  import("./screens/VoicemailScreen").then((m) => ({ default: m.VoicemailScreen }))
);
const SettingsScreen = lazy(() =>
  import("./screens/SettingsScreen").then((m) => ({ default: m.SettingsScreen }))
);

interface AppShellProps {
  /** Extension the server resolved from the httpOnly cookie, or null for a guest. */
  initialExtension: string | null;
}

export function AppShell({ initialExtension }: AppShellProps) {
  // Seed the auth store from the session the server resolved (httpOnly cookie)
  // BEFORE the subscription read below, so the first paint already shows the
  // correct screen — no login/splash flash. Client-only, once per mount.
  const seeded = useRef(false);
  if (typeof window !== "undefined" && !seeded.current) {
    seeded.current = true;
    useAuthStore.getState().applyServerSession(initialExtension);
  }

  const [activeTab, setActiveTab] = useState<TabId>("calls");
  // Tabs the user has opened at least once. A screen stays mounted after its
  // first visit so its data/scroll survive tab switches (we just hide it),
  // while never-visited tabs cost nothing.
  const [visitedTabs, setVisitedTabs] = useState<Set<TabId>>(() => new Set(["calls"]));
  const [hydrated, setHydrated] = useState(false);
  const { isAuthenticated, user, sipConfig, setUser, setSipConfig } = useAuthStore();
  const { activeCall } = useCallStore();
  const { settings } = useSettingsStore();
  const { fetchVoicemails, unreadCount } = useVoicemailStore();

  const { register, makeCall, joinTeamsMeeting, joinConference, hangUp, answer, sendDtmf, isRecording, startRecording, stopRecording } = useSipPhone();
  const { connect, disconnect, onMessage, send: wsSend, lookup: wsLookup } = useWebSocket();
  const bridge = useBrowserBridge();

  // Mark a tab visited (so it mounts and stays mounted) as we switch to it.
  const handleTabChange = useCallback((tab: TabId) => {
    setActiveTab(tab);
    setVisitedTabs((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
  }, []);

  // Holds the call being recorded so we can still save it after the call ends
  // (e.g. the remote party hangs up while recording is active).
  const recordingCallRef = useRef<{ callId: string; peer: string } | null>(null);

  // The display name shown to the other party (From header).
  const displayName = settings.displayName?.trim() || user?.name || user?.extension;

  // Resolve the callee's display name BEFORE dialing so the call UI shows a
  // name, not a bare number. Priority: explicit name → saved contact → server
  // lookup over WS (covers offline internal users that presence doesn't name) →
  // fall back to the number itself. The lookup is timeout-guarded, so a slow or
  // closed socket never blocks the call.
  const onCall = useCallback(
    async (target: string, targetName?: string) => {
      let name = targetName?.trim() || undefined;
      if (!name) {
        name = useContactStore.getState().findContact(target)?.name || undefined;
      }
      if (!name) {
        const found = await wsLookup(target);
        name = found?.name || undefined;
      }
      makeCall(target, name);
    },
    [makeCall, wsLookup]
  );

  // ─── Multi-party conference ───────────────────────────────────────────
  // Start a conference: ask the server to create a room and invite the given
  // extensions. The server replies with a `created` event (handled below) that
  // tells us to dial into the room; invitees get an `invited` event. Used both
  // to spin up a fresh room and to "merge" a 1:1 call (passing the current peer
  // plus the newly-picked contact) into a conference.
  const onStartConference = useCallback(
    (targets: string[], name?: string) => {
      const invite = Array.from(new Set(targets.map((t) => t.trim()).filter(Boolean)));
      wsSend({ type: "conference", action: "start", invite, name });
    },
    [wsSend]
  );

  // Add one more contact to the conference the user is currently in.
  const onAddToConference = useCallback(
    (target: string) => {
      const room = useConferenceStore.getState().room;
      if (!room) return;
      wsSend({ type: "conference", action: "invite", roomId: room.roomId, target });
    },
    [wsSend]
  );

  // The unified "add participant" action used by ActiveCallScreen. In a 1:1 call
  // it merges the current peer + the chosen contact into a new conference; in an
  // existing conference it invites the chosen contact into the room.
  const onAddParticipant = useCallback(
    (target: string) => {
      const call = useCallStore.getState().activeCall;
      if (call?.source === "conference") {
        onAddToConference(target);
      } else if (call) {
        onStartConference([call.peerExtension, target]);
      }
    },
    [onAddToConference, onStartConference]
  );

  // Accept an incoming conference invitation: dial into the room.
  const onAcceptConferenceInvite = useCallback(() => {
    const invite = useConferenceStore.getState().invite;
    if (!invite) return;
    useConferenceStore.getState().setInvite(null);
    joinConference(invite.roomId, invite.name);
  }, [joinConference]);

  // Decline an incoming conference invitation: tell the server, drop the sheet.
  const onDeclineConferenceInvite = useCallback(() => {
    const invite = useConferenceStore.getState().invite;
    if (invite) wsSend({ type: "conference", action: "decline", roomId: invite.roomId });
    useConferenceStore.getState().setInvite(null);
  }, [wsSend]);

  // Load the user's voicemail messages. TTL-guarded in the store, so the
  // initial preload here and the VoicemailScreen mount share one request.
  // Pass force=true (e.g. after a "voicemail" WS event) to bypass the cache.
  const refreshVoicemails = useCallback(
    (force = false) => {
      if (!user?.extension) return;
      fetchVoicemails(user.extension, force);
    },
    [user?.extension, fetchVoicemails]
  );

  // Wait for zustand persist hydration
  useEffect(() => {
    setHydrated(true);
  }, []);

  // The server already resolved auth from the cookie (seeded above), so we don't
  // block the UI on a round-trip. When authenticated, refresh the profile + SIP
  // config from `/me` in the background — and ONLY while authenticated, so signed-
  // out visitors never hit it. goRequest auto-refreshes once and clears the
  // session on a hard auth failure, which flips us to the LoginScreen.
  useEffect(() => {
    if (!hydrated || !isAuthenticated) return;
    let cancelled = false;
    (async () => {
      try {
        const me = await goApi.auth.me();
        if (cancelled) return;
        const { sipConfig: sip, ...profile } = me;
        setUser(profile);
        if (sip) setSipConfig(sip);
      } catch {
        // goRequest already cleared the session on a hard auth failure.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, isAuthenticated, setUser, setSipConfig]);

  // ─── Call recording (WebSocket-driven, no REST upload) ────────────────
  const finishRecording = useCallback(async () => {
    const info = recordingCallRef.current;
    recordingCallRef.current = null;
    const rec = await stopRecording();
    if (info) {
      wsSend({ type: "recording", action: "stop", callId: info.callId, peer: info.peer });
      if (rec) {
        const reader = new FileReader();
        reader.onloadend = () => {
          const data = (reader.result as string).split(",")[1] || "";
          wsSend({ type: "recording", action: "save", callId: info.callId, ext: rec.ext, mime: rec.mime, data });
        };
        reader.readAsDataURL(rec.blob);
      }
    }
  }, [stopRecording, wsSend]);

  const handleToggleRecording = useCallback(async () => {
    if (!activeCall) return;
    if (isRecording) {
      await finishRecording();
    } else if (startRecording()) {
      recordingCallRef.current = { callId: activeCall.callId, peer: activeCall.peerExtension };
      wsSend({ type: "recording", action: "start", callId: activeCall.callId, peer: activeCall.peerExtension });
    }
  }, [activeCall, isRecording, startRecording, finishRecording, wsSend]);

  // Stop + save the recording before hanging up, or if the call ends remotely.
  const handleHangUp = useCallback(async () => {
    if (isRecording) await finishRecording();
    hangUp();
  }, [isRecording, finishRecording, hangUp]);

  useEffect(() => {
    const ended = !activeCall || activeCall.status === CallStatus.Ended || activeCall.status === CallStatus.Declined
      || activeCall.status === CallStatus.NoAnswer || activeCall.status === CallStatus.Blocked;
    if (isRecording && ended) finishRecording();
  }, [activeCall, isRecording, finishRecording]);

  // Connect WS + register SIP on auth
  useEffect(() => {
    if (isAuthenticated && user && sipConfig) {
      console.log(`🔌 Auto-connecting: SIP + WS for ${user.extension}`);
      connect(user.extension);
      register(user.extension, user.extension, sipConfig.sipWsUrl, sipConfig.domain, displayName);
      refreshVoicemails();
    }
    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user?.extension, sipConfig?.sipWsUrl]);

  // Refetch voicemails when a new one is left for this user.
  useEffect(() => {
    const off = onMessage((msg) => {
      if (msg.type === "call_event" && msg.event === "voicemail") {
        refreshVoicemails(true);
      }
    });
    return off;
  }, [onMessage, refreshVoicemails]);

  // ─── Conference signaling ─────────────────────────────────────────────
  // Drive the multi-party conference UI from server events:
  //  - created: the server made a room we host → dial into it and seed the roster.
  //  - invited: someone is pulling us into a room → show the join sheet.
  //  - roster:  a live roster update → reflect it in the conference store.
  //  - closed:  the room ended → clear local conference state (and the pending
  //             invite if it was for that room).
  useEffect(() => {
    const off = onMessage((msg) => {
      if (msg.type !== "conference_event") return;
      const store = useConferenceStore.getState();
      switch (msg.event) {
        case "created": {
          store.setRoom(msg.room);
          // If we were on a 1:1 call (merging it into a conference), drop that
          // leg first, then dial into the room. The guard in makeCall keeps the
          // dropped leg's teardown from clobbering the new conference call.
          const existing = useCallStore.getState().activeCall;
          const roomId = msg.roomId;
          const roomName = msg.room?.name;
          if (existing && existing.source !== "conference") {
            hangUp().finally(() => joinConference(roomId, roomName));
          } else {
            joinConference(roomId, roomName);
          }
          break;
        }
        case "invited":
          store.setInvite({ roomId: msg.roomId, name: msg.name, from: msg.from, fromName: msg.fromName });
          break;
        case "roster":
          // Only track the room we're actually in/joining.
          if (!store.room || store.room.roomId === msg.roomId) store.setRoom(msg.room);
          break;
        case "closed":
          if (store.room?.roomId === msg.roomId) store.setRoom(null);
          if (store.invite?.roomId === msg.roomId) store.setInvite(null);
          break;
      }
    });
    return off;
  }, [onMessage, joinConference, hangUp]);

  // When a conference call ends, drop the local room state so the next call
  // starts clean. (Other members are updated server-side via the SIP BYE.)
  const wasConferenceRef = useRef(false);
  useEffect(() => {
    const inConference = activeCall?.source === "conference";
    if (inConference) wasConferenceRef.current = true;
    else if (wasConferenceRef.current && !activeCall) {
      wasConferenceRef.current = false;
      useConferenceStore.getState().clear();
    }
  }, [activeCall, activeCall?.source]);

  // Connect the PSTN→browser bridge for users who route inbound PSTN to their
  // browser. Gated on the user's own setting so we don't open a socket (and a
  // 3s reconnect loop) when the feature isn't in use. A forwarded call arrives
  // as a `linked` event and surfaces as an inbound call via the shared store.
  useEffect(() => {
    if (isAuthenticated && user && settings.pstnForwardToBrowser) {
      bridge.connect(user.extension);
    } else {
      bridge.disconnect();
    }
    return () => bridge.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user?.extension, settings.pstnForwardToBrowser]);

  // Re-register ONLY when the user changes their display name in settings.
  // The auth effect above is the sole owner of the initial registration, so we
  // skip the first run here — otherwise both effects register on mount and open
  // a duplicate SIP transport.
  const prevDisplayNameRef = useRef(displayName);
  useEffect(() => {
    if (prevDisplayNameRef.current === displayName) return;
    prevDisplayNameRef.current = displayName;
    if (isAuthenticated && user && sipConfig) {
      register(user.extension, user.extension, sipConfig.sipWsUrl, sipConfig.domain, displayName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayName]);

  // Ask once for permission to show desktop notifications (so we can alert the
  // user about an incoming call when this tab is in the background). Only
  // prompts when the state is still "default" — never re-nags a granted/denied
  // choice, and is a no-op where the API is unavailable (insecure context, etc).
  useEffect(() => {
    if (!isAuthenticated) return;
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => { /* ignore */ });
    }
  }, [isAuthenticated]);

  // Incoming-call browser alerts. While an inbound call is ringing we (1) flash
  // the tab title between the caller and the original title so a background tab
  // visibly signals the call, and (2) raise a desktop notification ONLY when
  // this tab is hidden (the user is on another tab/app) and they've granted
  // permission — when the tab is focused the IncomingCallSheet is already shown.
  // Everything is torn down as soon as the call stops ringing (answered/ended).
  useEffect(() => {
    const isIncoming =
      activeCall?.direction === CallDirection.Inbound &&
      activeCall?.status === CallStatus.Ringing;
    if (!isIncoming) return;

    const caller = activeCall.peerName || activeCall.peerExtension || "Someone";
    const originalTitle = document.title;

    // 1) Flash the title bar once per second.
    let showCaller = true;
    const flash = () => {
      document.title = showCaller ? `\uD83D\uDCDE ${caller} is calling you\u2026` : originalTitle;
      showCaller = !showCaller;
    };
    flash();
    const titleTimer = window.setInterval(flash, 1000);

    // 2) Desktop notification — hidden tab + granted permission only.
    let notification: Notification | undefined;
    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "granted" &&
      document.visibilityState === "hidden"
    ) {
      try {
        notification = new Notification("Incoming call", {
          body: `${caller} is calling you`,
          tag: "incoming-call",
          icon: "/favicon.ico",
        });
        notification.onclick = () => {
          window.focus();
          notification?.close();
        };
      } catch { /* notifications unsupported / blocked — ignore */ }
    }

    return () => {
      window.clearInterval(titleTimer);
      document.title = originalTitle;
      notification?.close();
    };
  }, [activeCall?.direction, activeCall?.status, activeCall?.peerName, activeCall?.peerExtension]);

  const vmUnread = unreadCount();

  // Route call-control actions to the right transport. Bridge (PSTN→browser)
  // calls are driven by the bridge hook; all other calls are SIP sessions.
  // DTMF / recording don't apply to bridge calls, so they're no-ops there.
  const callIsBridge = activeCall?.source === "bridge";
  const onAnswerCall = callIsBridge ? bridge.answer : answer;
  const onDeclineCall = callIsBridge ? bridge.hangup : hangUp;
  const onHangUpCall = callIsBridge ? bridge.hangup : handleHangUp;
  const onSendDtmfCall = callIsBridge ? () => {} : sendDtmf;
  const onToggleRecordingCall = callIsBridge ? () => {} : handleToggleRecording;

  // Show a branded splash while hydrating (avoids a login-screen flash for
  // already-logged-in users; the server already resolved the session).
  if (!hydrated) return <SplashScreen />;

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  // Full-screen call overlay
  if (activeCall && activeCall.status !== "ended") {
    return (
      <ActiveCallScreen
        onHangUp={onHangUpCall}
        onAnswer={onAnswerCall}
        onSendDtmf={onSendDtmfCall}
        onToggleRecording={onToggleRecordingCall}
        isRecording={callIsBridge ? false : isRecording}
        onAddParticipant={callIsBridge ? undefined : onAddParticipant}
      />
    );
  }

  return (
    <div className="flex h-dvh bg-background">
      {/* Desktop sidebar */}
      <Sidebar activeTab={activeTab} onTabChange={handleTabChange} voicemailUnread={vmUnread} />

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <AppHeader />

        {/* Incoming call toast/sheet */}
        <IncomingCallSheet onAnswer={onAnswerCall} onDecline={onDeclineCall} />

        {/* Incoming conference invitation */}
        <IncomingConferenceSheet onAccept={onAcceptConferenceInvite} onDecline={onDeclineConferenceInvite} />

        {/* Screen content. Each tab mounts on first visit (Suspense streams in
            the code-split chunk + skeleton), then stays mounted but hidden so
            its state survives switching. */}
        <main className="flex-1 overflow-y-auto pb-16 lg:pb-0">
          {visitedTabs.has("calls") && (
            <div className={activeTab === "calls" ? "" : "hidden"}>
              <Suspense fallback={<ListScreenSkeleton />}>
                <CallsScreen onCall={onCall} />
              </Suspense>
            </div>
          )}
          {visitedTabs.has("contacts") && (
            <div className={activeTab === "contacts" ? "" : "hidden"}>
              <Suspense fallback={<ContactsScreenSkeleton />}>
                <ContactsScreen onCall={onCall} />
              </Suspense>
            </div>
          )}
          {visitedTabs.has("keypad") && (
            <div className={activeTab === "keypad" ? "h-full" : "hidden"}>
              {/* No skeleton: the keypad has no data fetch, so the only delay is
                  the lazy chunk load — a flash of skeleton there isn't useful. */}
              <Suspense fallback={null}>
                <KeypadScreen onCall={onCall} onJoinTeams={joinTeamsMeeting} active={activeTab === "keypad"} />
              </Suspense>
            </div>
          )}
          {visitedTabs.has("voicemail") && (
            <div className={activeTab === "voicemail" ? "" : "hidden"}>
              <Suspense fallback={<ListScreenSkeleton />}>
                <VoicemailScreen onCall={onCall} />
              </Suspense>
            </div>
          )}
          {visitedTabs.has("settings") && (
            <div className={activeTab === "settings" ? "" : "hidden"}>
              <Suspense fallback={<SettingsScreenSkeleton />}>
                <SettingsScreen />
              </Suspense>
            </div>
          )}
        </main>

        {/* Floating dial button */}
        {activeTab !== "keypad" && (
          <button
            onClick={() => handleTabChange("keypad")}
            className="fixed right-5 bottom-20 lg:bottom-6 z-40 h-14 w-14 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/30 flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
          >
            <Phone className="h-6 w-6" />
          </button>
        )}

        {/* Bottom navigation (mobile only) */}
        <div className="lg:hidden">
          <BottomNav activeTab={activeTab} onTabChange={handleTabChange} voicemailUnread={vmUnread} />
        </div>
      </div>
    </div>
  );
}
