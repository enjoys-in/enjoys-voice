"use client";

import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { Phone } from "lucide-react";
import { useAuthStore, useCallStore, useVoicemailStore } from "../stores";
import { useSettingsStore } from "../stores";
import { BottomNav, type TabId } from "./layout/BottomNav";
import { Sidebar } from "./layout/Sidebar";
import { AppHeader } from "./layout/AppHeader";
import { LoginScreen } from "./screens/LoginScreen";
import { ActiveCallScreen } from "./screens/ActiveCallScreen";
import { IncomingCallSheet } from "./call/IncomingCallSheet";
import { SplashScreen } from "./SplashScreen";
import {
  ListScreenSkeleton,
  ContactsScreenSkeleton,
  KeypadScreenSkeleton,
  SettingsScreenSkeleton,
} from "./screens/ScreenSkeletons";
import { useSipPhone } from "../hooks/useSipPhone";
import { useWebSocket } from "../hooks/useWebSocket";
import { goApi } from "../lib/go-api";
import { CallStatus } from "../types";

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

export function AppShell() {
  const [activeTab, setActiveTab] = useState<TabId>("calls");
  // Tabs the user has opened at least once. A screen stays mounted after its
  // first visit so its data/scroll survive tab switches (we just hide it),
  // while never-visited tabs cost nothing.
  const [visitedTabs, setVisitedTabs] = useState<Set<TabId>>(() => new Set(["calls"]));
  const [hydrated, setHydrated] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  const { isAuthenticated, user, sipConfig, setUser } = useAuthStore();
  const { activeCall } = useCallStore();
  const { settings } = useSettingsStore();
  const { fetchVoicemails, unreadCount } = useVoicemailStore();

  const { register, makeCall, hangUp, answer, sendDtmf, isRecording, startRecording, stopRecording } = useSipPhone();
  const { connect, disconnect, onMessage, send: wsSend } = useWebSocket();

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

  // Validate the persisted session against the server once hydrated. A stored
  // `isAuthenticated` only means we *were* logged in — the access/refresh tokens
  // may have expired or been revoked. goApi.auth.me() confirms the session is
  // still good and refreshes the cached profile; goRequest auto-refreshes once
  // and logs out if that fails, which flips us to the LoginScreen.
  useEffect(() => {
    if (!hydrated) return;
    if (!isAuthenticated) {
      setSessionChecked(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const me = await goApi.auth.me();
        if (!cancelled) setUser(me);
      } catch {
        // goRequest already cleared the session on a hard auth failure.
      } finally {
        if (!cancelled) setSessionChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, isAuthenticated, setUser]);

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
    if (sessionChecked && isAuthenticated && user && sipConfig) {
      console.log(`🔌 Auto-connecting: SIP + WS for ${user.extension}`);
      connect(user.extension);
      register(user.extension, user.extension, sipConfig.sipWsUrl, sipConfig.domain, displayName);
      refreshVoicemails();
    }
    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionChecked, isAuthenticated, user?.extension]);

  // Refetch voicemails when a new one is left for this user.
  useEffect(() => {
    const off = onMessage((msg) => {
      if (msg.type === "call_event" && msg.event === "voicemail") {
        refreshVoicemails(true);
      }
    });
    return off;
  }, [onMessage, refreshVoicemails]);

  // Re-register when the user changes their display name in settings
  useEffect(() => {
    if (isAuthenticated && user && sipConfig) {
      register(user.extension, user.extension, sipConfig.sipWsUrl, sipConfig.domain, displayName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayName]);

  const vmUnread = unreadCount();

  // Show a branded splash while hydrating or while validating an existing
  // session (avoids a login-screen flash for already-logged-in users).
  if (!hydrated || (isAuthenticated && !sessionChecked)) return <SplashScreen />;

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  // Full-screen call overlay
  if (activeCall && activeCall.status !== "ended") {
    return (
      <ActiveCallScreen
        onHangUp={handleHangUp}
        onAnswer={answer}
        onSendDtmf={sendDtmf}
        onToggleRecording={handleToggleRecording}
        isRecording={isRecording}
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
        <IncomingCallSheet onAnswer={answer} onDecline={hangUp} />

        {/* Screen content. Each tab mounts on first visit (Suspense streams in
            the code-split chunk + skeleton), then stays mounted but hidden so
            its state survives switching. */}
        <main className="flex-1 overflow-y-auto pb-16 lg:pb-0">
          {visitedTabs.has("calls") && (
            <div className={activeTab === "calls" ? "" : "hidden"}>
              <Suspense fallback={<ListScreenSkeleton />}>
                <CallsScreen onCall={makeCall} />
              </Suspense>
            </div>
          )}
          {visitedTabs.has("contacts") && (
            <div className={activeTab === "contacts" ? "" : "hidden"}>
              <Suspense fallback={<ContactsScreenSkeleton />}>
                <ContactsScreen onCall={makeCall} />
              </Suspense>
            </div>
          )}
          {visitedTabs.has("keypad") && (
            <div className={activeTab === "keypad" ? "h-full" : "hidden"}>
              <Suspense fallback={<KeypadScreenSkeleton />}>
                <KeypadScreen onCall={makeCall} active={activeTab === "keypad"} />
              </Suspense>
            </div>
          )}
          {visitedTabs.has("voicemail") && (
            <div className={activeTab === "voicemail" ? "" : "hidden"}>
              <Suspense fallback={<ListScreenSkeleton />}>
                <VoicemailScreen onCall={makeCall} />
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
