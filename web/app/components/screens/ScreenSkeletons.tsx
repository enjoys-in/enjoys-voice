"use client";

import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading placeholders for the main tab screens. Two purposes:
 *  1. Suspense fallback while a lazily-imported screen chunk downloads.
 *  2. In-screen fallback while that screen's first data fetch is in flight.
 *
 * Each mirrors the real layout (header + list rows) so the swap to real
 * content doesn't shift the page.
 */

function HeaderSkeleton() {
  return (
    <div className="px-4 pt-6 pb-3 flex items-center justify-between">
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-8 w-8 rounded-md" />
    </div>
  );
}

function ListRowSkeleton() {
  return (
    <div className="flex items-center gap-3 p-3">
      <Skeleton className="h-10 w-10 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-3 w-12" />
    </div>
  );
}

/** Generic list screen (Recents, Voicemail). */
export function ListScreenSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col h-full">
      <HeaderSkeleton />
      <div className="flex-1 px-4 space-y-1">
        {Array.from({ length: rows }).map((_, i) => (
          <ListRowSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

/** Contacts: header + search bar + list. */
export function ContactsScreenSkeleton() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-6 pb-3 space-y-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-8 w-20 rounded-md" />
        </div>
        <Skeleton className="h-9 w-full rounded-md" />
      </div>
      <div className="flex-1 px-4 space-y-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <ListRowSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

/** Settings: header + a few cards. */
export function SettingsScreenSkeleton() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-6 pb-3">
        <Skeleton className="h-7 w-28" />
      </div>
      <div className="px-4 pb-3">
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
      <div className="flex-1 px-4 space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
