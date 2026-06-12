import { Skeleton } from "@/components/ui/skeleton";

export default function AdminLoading() {
  return (
    <div className="flex h-dvh">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border/50 bg-card/30 flex flex-col">
        <div className="p-4 border-b border-border/50">
          <Skeleton className="h-6 w-32" />
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-lg" />
          ))}
        </nav>
        <div className="p-3 border-t border-border/50">
          <Skeleton className="h-9 w-full rounded-lg" />
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        <div className="p-6 space-y-6 max-w-5xl">
          <Skeleton className="h-8 w-40" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Skeleton className="h-44 w-full rounded-xl" />
            <Skeleton className="h-44 w-full rounded-xl" />
          </div>
        </div>
      </main>
    </div>
  );
}
