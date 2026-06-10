"use client";

import { type ReactNode } from "react";
import { Phone } from "lucide-react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
}

export function EmptyState({ icon, title, description }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
      <div className="mb-3 opacity-30">
        {icon || <Phone className="h-12 w-12" />}
      </div>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="text-xs mt-1 max-w-[200px] text-center">{description}</p>}
    </div>
  );
}
