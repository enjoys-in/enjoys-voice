"use client";
import { useState } from "react";
import LoginScreen from "./components/LoginScreen";
import PhoneApp from "./components/PhoneApp";

export interface UserSession {
  extension: string;
  username: string;
  name: string;
  password: string;
  wsUrl: string;
  sipWsUrl: string;
  domain: string;
  trunkEnabled: boolean;
}

export default function Home() {
  const [session, setSession] = useState<UserSession | null>(null);

  if (!session) {
    return <LoginScreen onLogin={setSession} />;
  }

  return <PhoneApp session={session} onLogout={() => setSession(null)} />;
}
