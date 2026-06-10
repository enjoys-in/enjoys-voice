"use client";
import { useState } from "react";
import type { UserSession } from "../page";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export default function LoginScreen({ onLogin }: { onLogin: (s: UserSession) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/api/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Login failed");
        return;
      }

      const data = await res.json();
      onLogin({
        extension: data.user.extension,
        username: data.user.username,
        name: data.user.name,
        password,
        wsUrl: data.sipConfig.wsUrl,
        sipWsUrl: data.sipConfig.sipWsUrl,
        domain: data.sipConfig.domain,
        trunkEnabled: data.sipConfig.trunkEnabled,
      });
    } catch {
      setError("Cannot connect to server");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0f] p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 mb-4 shadow-lg shadow-indigo-500/20">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">CallNet</h1>
          <p className="text-sm text-white/30 mt-1">SIP Phone &middot; Drachtio + FreeSWITCH</p>
        </div>

        <form onSubmit={handleLogin} className="rounded-2xl bg-white/[0.03] border border-white/5 p-6 backdrop-blur-sm">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-white/40 mb-1.5">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="user1"
                required
                className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white placeholder:text-white/20 focus:border-indigo-500/50 focus:outline-none transition text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/40 mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="pass123"
                required
                className="w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-white placeholder:text-white/20 focus:border-indigo-500/50 focus:outline-none transition text-sm"
              />
            </div>
          </div>

          {error && (
            <p className="mt-3 text-xs text-red-400 bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-5 w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
          >
            {loading ? "Connecting..." : "Sign In"}
          </button>

          <div className="mt-4 p-3 rounded-xl bg-white/[0.02] border border-white/5">
            <p className="text-[10px] text-white/25 uppercase tracking-wider mb-1.5">Test Accounts</p>
            <div className="space-y-1 text-xs text-white/40">
              <p>user1 / pass123 (Alice - 1001)</p>
              <p>user2 / pass123 (Bob - 1002)</p>
              <p>user3 / pass123 (Charlie - 1003)</p>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
