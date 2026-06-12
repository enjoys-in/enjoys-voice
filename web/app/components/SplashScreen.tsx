"use client";

import { Phone } from "lucide-react";

/**
 * Full-screen branded splash shown while the app hydrates and restores the
 * persisted auth session. Prevents the brief login-screen flicker for users
 * who are already logged in (similar to Gmail / X startup screens).
 */
export function SplashScreen() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background">
      <div className="relative flex items-center justify-center">
        <span className="absolute h-20 w-20 rounded-full bg-emerald-500/20 animate-ping" />
        <div className="relative h-16 w-16 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-lg shadow-emerald-600/30">
          <Phone className="h-7 w-7" />
        </div>
      </div>

      <p className="mt-6 text-sm font-medium text-muted-foreground">CallNet</p>

      <div className="mt-3 flex gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce" />
      </div>
    </div>
  );
}
