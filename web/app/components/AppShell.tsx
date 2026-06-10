"use client";

import { useState, useEffect } from "react";
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

export function AppShell() {
  const [activeTab, setActiveTab] = useState<TabId>("calls");
  const { isAuthenticated, user, sipConfig } = useAuthStore();
  const { activeCall } = useCallStore();

  const { register, makeCall, hangUp, answer } = useSipPhone();
  const { connect, disconnect } = useWebSocket();

  // Connect WS + register SIP on auth
  useEffect(() => {
    if (isAuthenticated && user && sipConfig) {
      connect(user.extension);
      register(user.extension, user.extension, sipConfig.sipWsUrl, sipConfig.domain);
    }
    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  // Full-screen call overlay
  if (activeCall && activeCall.status !== "ended") {
    return (
      <ActiveCallScreen
        onHangUp={hangUp}
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
        <main className="flex-1 overflow-hidden pb-16 lg:pb-0">
          {activeTab === "calls" && <CallsScreen onCall={makeCall} />}
          {activeTab === "contacts" && <ContactsScreen onCall={makeCall} />}
          {activeTab === "keypad" && <KeypadScreen onCall={makeCall} />}
          {activeTab === "settings" && <SettingsScreen />}
        </main>

        {/* Bottom navigation (mobile only) */}
        <div className="lg:hidden">
          <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
        </div>
      </div>
    </div>
  );
}
