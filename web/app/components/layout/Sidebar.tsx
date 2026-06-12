"use client";

import { Phone, Clock, Users, Hash, Settings, Voicemail, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "../../stores";
import type { TabId } from "./BottomNav";

interface SidebarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  voicemailUnread?: number;
}

const tabs: { id: TabId; label: string; icon: typeof Phone }[] = [
  { id: "calls", label: "Recents", icon: Clock },
  { id: "contacts", label: "Contacts", icon: Users },
  { id: "keypad", label: "Keypad", icon: Hash },
  { id: "voicemail", label: "Voicemail", icon: Voicemail },
  { id: "settings", label: "Settings", icon: Settings },
];

export function Sidebar({ activeTab, onTabChange, voicemailUnread = 0 }: SidebarProps) {
  const { logout } = useAuthStore();

  return (
    <aside className="hidden lg:flex flex-col w-64 border-r border-border/50 bg-card/30">
      {/* Brand */}
      <div className="p-4 border-b border-border/50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Phone className="h-4 w-4 text-primary" />
          </div>
          <span className="font-semibold text-sm">Enjoys Voice</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2 space-y-1">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
              activeTab === id
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
            {id === "voicemail" && voicemailUnread > 0 && (
              <span className="ml-auto min-w-5 h-5 px-1.5 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-semibold leading-none">
                {voicemailUnread > 9 ? "9+" : voicemailUnread}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-2 border-t border-border/50">
        <button
          onClick={logout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
