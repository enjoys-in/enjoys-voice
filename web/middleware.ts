import { NextResponse, type NextRequest } from "next/server";
import { verifyAuthToken } from "./app/lib/jwt-verify";

/**
 * Route guard for the admin area. The main app at "/" renders its own login
 * screen for guests, so it stays open; "/admin/*" is gated here at the edge by
 * the httpOnly access-token cookie. An unauthenticated request is redirected to
 * "/" before any admin code runs. The API still enforces auth on every data
 * call — this just stops the protected UI from rendering for signed-out users.
 */
export async function middleware(req: NextRequest) {
  const token = req.cookies.get("token")?.value;
  const session = await verifyAuthToken(token);
  if (session) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/admin/:path*"],
};
