"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ListItemProps {
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  onClick?: () => void;
  onLongPress?: () => void;
  className?: string;
  destructive?: boolean;
}

export function ListItem({
  leading,
  title,
  subtitle,
  trailing,
  onClick,
  onLongPress,
  className,
  destructive,
}: ListItemProps) {
  let pressTimer: ReturnType<typeof setTimeout> | null = null;

  const handleTouchStart = () => {
    if (!onLongPress) return;
    pressTimer = setTimeout(() => {
      onLongPress();
    }, 600);
  };

  const handleTouchEnd = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  };

  return (
    <div
      role={onClick ? "button" : undefined}
      onClick={onClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onContextMenu={(e) => {
        if (onLongPress) {
          e.preventDefault();
          onLongPress();
        }
      }}
      className={cn(
        "flex items-center gap-3 p-3 rounded-xl transition-colors",
        onClick && "cursor-pointer hover:bg-accent/50 active:bg-accent/70",
        destructive && "text-destructive",
        className
      )}
    >
      {leading && <div className="shrink-0">{leading}</div>}
      <div className="flex-1 min-w-0">
        <p className={cn("text-sm font-medium truncate", destructive && "text-destructive")}>{title}</p>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</p>}
      </div>
      {trailing && <div className="shrink-0">{trailing}</div>}
    </div>
  );
}
