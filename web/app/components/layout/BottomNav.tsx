"use client";

import { Phone, Clock, Users, Hash, Settings, Voicemail } from "lucide-react";
import { cn } from "@/lib/utils";

export type TabId = "calls" | "contacts" | "keypad" | "voicemail" | "settings";

interface BottomNavProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  voicemailUnread?: number;
}

const tabs: { id: TabId; label: string; icon: typeof Phone }[] = [
  { id: "calls", label: "Calls", icon: Clock },
  { id: "contacts", label: "Contacts", icon: Users },
  { id: "keypad", label: "Keypad", icon: Hash },
  { id: "voicemail", label: "Voicemail", icon: Voicemail },
  { id: "settings", label: "Settings", icon: Settings },
];

export function BottomNav({ activeTab, onTabChange, voicemailUnread = 0 }: BottomNavProps) {
  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 border-t border-border/50 bg-background/80 backdrop-blur-xl safe-bottom">
      <div className="flex items-center justify-around h-16 max-w-md mx-auto">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            className={cn(
              "relative flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg transition-colors",
              activeTab === id
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-5 w-5" />
            {id === "voicemail" && voicemailUnread > 0 && (
              <span className="absolute top-1 right-1.5 min-w-4 h-4 px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-semibold leading-none">
                {voicemailUnread > 9 ? "9+" : voicemailUnread}
              </span>
            )}
            <span className="text-[10px] font-medium">{label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
