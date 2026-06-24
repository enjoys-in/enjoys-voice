"use client";

import Link from "next/link";
import { Shield } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { useAuthStore } from "../../stores";

export function AppHeader() {
  const { user } = useAuthStore();

  if (!user) return null;

  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-background/80 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <div className="relative">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-xs bg-primary/10 text-primary font-medium">
              {user.name?.slice(0, 2).toUpperCase() || user.extension.slice(0, 2)}
            </AvatarFallback>
          </Avatar>
          <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-background" />
        </div>
        <div>
          <p className="text-sm font-medium leading-none">{user.name || user.extension}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">ext. {user.extension}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href="/admin"
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: "outline", size: "sm" })}
          title="Open the admin dashboard in a new tab"
        >
          <Shield />
          Admin
        </Link>
        <Badge variant="secondary" className="text-[10px]">Online</Badge>
      </div>
    </header>
  );
}
