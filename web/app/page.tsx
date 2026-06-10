"use client";
import { useState, useEffect } from "react";
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

const SESSION_KEY = "callnet_session";

export default function Home() {
  const [session, setSession] = useState<UserSession | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(SESSION_KEY);
      if (stored) setSession(JSON.parse(stored));
    } catch {}
    setLoaded(true);
  }, []);

  const handleLogin = (s: UserSession) => {
    setSession(s);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  };

  const handleLogout = () => {
    setSession(null);
    sessionStorage.removeItem(SESSION_KEY);
  };

  if (!loaded) return null;

  if (!session) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return <PhoneApp session={session} onLogout={handleLogout} />;
}
