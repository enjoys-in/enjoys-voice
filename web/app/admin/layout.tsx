import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Control Plane",
  description: "Control Plane for Enjoys Voice",
  robots: { index: false, follow: false },
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
