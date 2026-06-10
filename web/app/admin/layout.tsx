import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin | Enjoys Voice",
  description: "Admin panel for Enjoys Voice",
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-background">
      {children}
    </div>
  );
}
