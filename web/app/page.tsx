import { AppShell } from "./components/AppShell";
import { getServerSession } from "./lib/auth-server";

// Server Component: resolve the session from the httpOnly cookie before render
// so the client mounts already knowing whether it's authenticated (no flash, no
// boot `/me` round-trip). The token never reaches the client.
export default async function Home() {
  const session = await getServerSession();
  return <AppShell initialExtension={session?.extension ?? null} />;
}

