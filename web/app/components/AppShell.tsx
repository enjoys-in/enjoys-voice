"use client";

import { useState, useEffect } from "react";
import { Phone } from "lucide-react";
import { useAuthStore, useCallStore } from "../stores";
import { BottomNav, type TabId } from "./layout/BottomNav";
import { Sidebar } from "./layout/Sidebar";
import { AppHeader } from "./layout/AppHeader";
import { LoginScreen } from "./screens/LoginScreen";
import { CallsScreen } from "./screens/CallsScreen";
import { ContactsScreen } from "./screens/ContactsScreen";
import { KeypadScreen } from "./screens/KeypadScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { ActiveCallScreen } from "./screens/ActiveCallScreen";
import { IncomingCallSheet } from "./call/IncomingCallSheet";
import { useSipPhone } from "../hooks/useSipPhone";
import { useWebSocket } from "../hooks/useWebSocket";
import { useSettingsSync } from "../hooks/useSettingsSync";

export function AppShell() {
  const [activeTab, setActiveTab] = useState<TabId>("calls");
  const [hydrated, setHydrated] = useState(false);
  const { isAuthenticated, user, sipConfig } = useAuthStore();
  const { activeCall } = useCallStore();

  const { register, makeCall, hangUp, answer } = useSipPhone();
  const { connect, disconnect } = useWebSocket();
  const settingsSync = useSettingsSync();

  // Wait for zustand persist hydration
  useEffect(() => {
    setHydrated(true);
  }, []);

  // Connect WS + register SIP on auth
  useEffect(() => {
    if (isAuthenticated && user && sipConfig) {
      console.log(`🔌 Auto-connecting: SIP + WS for ${user.extension}`);
      connect(user.extension);
      register(user.extension, user.extension, sipConfig.sipWsUrl, sipConfig.domain);
    }
    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user?.extension]);

  // Don't render until hydration completes (avoids SSR mismatch flash)
  if (!hydrated) return null;

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  // Full-screen call overlay
  if (activeCall && activeCall.status !== "ended") {
    return (
      <ActiveCallScreen
        onHangUp={hangUp}
        onAnswer={answer}
      />
    );
  }

  return (
    <div className="flex h-dvh bg-background">
      {/* Desktop sidebar */}
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <AppHeader />

        {/* Incoming call toast/sheet */}
        <IncomingCallSheet onAnswer={answer} onDecline={hangUp} />

        {/* Screen content */}
        <main className="flex-1 overflow-y-auto pb-16 lg:pb-0">
          <div className={activeTab === "calls" ? "" : "hidden"}><CallsScreen onCall={makeCall} /></div>
          <div className={activeTab === "contacts" ? "" : "hidden"}><ContactsScreen onCall={makeCall} /></div>
          <div className={activeTab === "keypad" ? "h-full" : "hidden"}><KeypadScreen onCall={makeCall} /></div>
          <div className={activeTab === "settings" ? "" : "hidden"}><SettingsScreen /></div>
        </main>

        {/* Floating dial button */}
        {activeTab !== "keypad" && (
          <button
            onClick={() => setActiveTab("keypad")}
            className="fixed right-5 bottom-20 lg:bottom-6 z-40 h-14 w-14 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/30 flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
          >
            <Phone className="h-6 w-6" />
          </button>
        )}

        {/* Bottom navigation (mobile only) */}
        <div className="lg:hidden">
          <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
        </div>
      </div>
    </div>
  );
}
