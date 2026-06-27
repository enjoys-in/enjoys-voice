"use client";

import { BrandMark } from "./BrandMark";

/**
 * Full-screen branded splash shown while the app hydrates and restores the
 * persisted auth session. Prevents the brief login-screen flicker for users
 * who are already logged in (similar to Gmail / X startup screens).
 */
export function SplashScreen() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background">
      <div className="relative flex items-center justify-center">
        <span className="absolute h-20 w-20 rounded-full bg-indigo-500/20 animate-ping" />
        <BrandMark className="relative h-16 w-16 rounded-2xl shadow-lg shadow-indigo-600/30" />
      </div>

      <p className="mt-6 text-sm font-semibold tracking-tight text-foreground/80">Enjoys Voice</p>

      <div className="mt-3 flex gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-indigo-500/60 animate-bounce [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 rounded-full bg-indigo-500/60 animate-bounce [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 rounded-full bg-indigo-500/60 animate-bounce" />
      </div>
    </div>
  );
}
