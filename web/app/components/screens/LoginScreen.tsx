"use client";

import { useState } from "react";
import { Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useAuthStore } from "../../stores";
import { goApi, GoApiError } from "../../lib/go-api";
import { loginSchema } from "../../lib/validations";
import { useBranding } from "../../hooks/useBranding";

type Mode = "password" | "otp" | "signup";
type AuthResult = Awaited<ReturnType<typeof goApi.auth.login>>;

export function LoginScreen() {
  const [mode, setMode] = useState<Mode>("password");
  const [extension, setExtension] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const { brandName, tagline, logoUrl } = useBranding();
  const { login } = useAuthStore();

  const switchMode = (m: Mode) => {
    setMode(m);
    setError("");
    setInfo("");
    setFieldErrors({});
    setOtpSent(false);
    setCode("");
  };

  // Shared success path: persist tokens + user + SIP config from any auth flow.
  const applyAuth = (data: AuthResult) => {
    login(
      {
        extension: data.user.extension,
        username: data.user.username,
        name: data.user.name,
        mobile: data.user.mobile,
      },
      data.token,
      data.refreshToken,
      {
        wsUrl: data.sipConfig.wsUrl,
        sipWsUrl: data.sipConfig.sipWsUrl,
        domain: data.sipConfig.domain,
      }
    );
  };

  const fail = (err: unknown) => {
    setError(err instanceof GoApiError ? err.message : "Connection failed");
  };

  // ─── Password login (existing) ──────────────────────────
  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setFieldErrors({});

    const result = loginSchema.safeParse({ username: extension, password });
    if (!result.success) {
      const errs: Record<string, string> = {};
      for (const issue of result.error.issues) {
        errs[issue.path[0] as string] = issue.message;
      }
      setFieldErrors(errs);
      return;
    }

    setLoading(true);
    try {
      applyAuth(await goApi.auth.login(extension, password));
    } catch (err) {
      fail(err);
    } finally {
      setLoading(false);
    }
  };

  // ─── Request an SMS code (login or signup) ──────────────
  const requestCode = async (purpose: "login" | "signup") => {
    setError("");
    setInfo("");
    if (!mobile.trim()) {
      setFieldErrors({ mobile: "Mobile number is required" });
      return;
    }
    if (purpose === "signup") {
      if (!name.trim()) {
        setFieldErrors({ name: "Name is required" });
        return;
      }
      if (password.length < 4) {
        setFieldErrors({ password: "Password must be at least 4 characters" });
        return;
      }
    }
    setFieldErrors({});
    setLoading(true);
    try {
      await goApi.auth.requestOtp(mobile.trim(), purpose);
      setOtpSent(true);
      setInfo("We sent a verification code to your phone.");
    } catch (err) {
      fail(err);
    } finally {
      setLoading(false);
    }
  };

  // ─── Verify the code ────────────────────────────────────
  const verifyCode = async (purpose: "login" | "signup") => {
    setError("");
    if (code.trim().length < 4) {
      setFieldErrors({ code: "Enter the code from the SMS" });
      return;
    }
    setFieldErrors({});
    setLoading(true);
    try {
      const data =
        purpose === "login"
          ? await goApi.auth.loginOtp(mobile.trim(), code.trim())
          : await goApi.auth.signupVerify(name.trim(), mobile.trim(), password, code.trim());
      applyAuth(data);
    } catch (err) {
      fail(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-dvh p-4 bg-background">
      <Card className="w-full max-w-sm border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center overflow-hidden">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={brandName} className="h-full w-full object-contain" />
            ) : (
              <Phone className="h-6 w-6 text-primary" />
            )}
          </div>
          <CardTitle className="text-xl">{brandName}</CardTitle>
          <CardDescription>
            {tagline ||
              (mode === "signup"
                ? "Create your account"
                : mode === "otp"
                  ? "Sign in with a code sent to your phone"
                  : "Sign in with your extension or phone")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Mode switch */}
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted/40 p-1 text-xs">
            {(["password", "otp", "signup"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={`rounded-md py-1.5 font-medium transition-colors ${
                  mode === m ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m === "password" ? "Password" : m === "otp" ? "OTP login" : "Sign up"}
              </button>
            ))}
          </div>

          {mode === "password" && (
            <form onSubmit={handlePasswordLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="extension">Extension / Phone</Label>
                <Input
                  id="extension"
                  placeholder="1001 or 9876543210"
                  value={extension}
                  onChange={(e) => setExtension(e.target.value)}
                  autoComplete="username"
                />
                {fieldErrors.username && <p className="text-xs text-destructive">{fieldErrors.username}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
                {fieldErrors.password && <p className="text-xs text-destructive">{fieldErrors.password}</p>}
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Connecting..." : "Sign In"}
              </Button>
            </form>
          )}

          {mode === "otp" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                otpSent ? verifyCode("login") : requestCode("login");
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="otp-mobile">Mobile number</Label>
                <Input
                  id="otp-mobile"
                  placeholder="9876543210"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  disabled={otpSent}
                  autoComplete="tel"
                />
                {fieldErrors.mobile && <p className="text-xs text-destructive">{fieldErrors.mobile}</p>}
              </div>
              {otpSent && (
                <div className="space-y-2">
                  <Label htmlFor="otp-code">Verification code</Label>
                  <Input
                    id="otp-code"
                    inputMode="numeric"
                    placeholder="6-digit code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    autoComplete="one-time-code"
                  />
                  {fieldErrors.code && <p className="text-xs text-destructive">{fieldErrors.code}</p>}
                </div>
              )}
              {info && <p className="text-xs text-muted-foreground">{info}</p>}
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Please wait..." : otpSent ? "Verify & sign in" : "Send code"}
              </Button>
              {otpSent && (
                <button
                  type="button"
                  onClick={() => requestCode("login")}
                  disabled={loading}
                  className="w-full text-xs text-muted-foreground hover:text-foreground"
                >
                  Resend code
                </button>
              )}
            </form>
          )}

          {mode === "signup" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                otpSent ? verifyCode("signup") : requestCode("signup");
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="su-name">Name</Label>
                <Input
                  id="su-name"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={otpSent}
                  autoComplete="name"
                />
                {fieldErrors.name && <p className="text-xs text-destructive">{fieldErrors.name}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="su-mobile">Mobile number</Label>
                <Input
                  id="su-mobile"
                  placeholder="9876543210"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  disabled={otpSent}
                  autoComplete="tel"
                />
                {fieldErrors.mobile && <p className="text-xs text-destructive">{fieldErrors.mobile}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="su-password">Password</Label>
                <Input
                  id="su-password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={otpSent}
                  autoComplete="new-password"
                />
                {fieldErrors.password && <p className="text-xs text-destructive">{fieldErrors.password}</p>}
              </div>
              {otpSent && (
                <div className="space-y-2">
                  <Label htmlFor="su-code">Verification code</Label>
                  <Input
                    id="su-code"
                    inputMode="numeric"
                    placeholder="6-digit code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    autoComplete="one-time-code"
                  />
                  {fieldErrors.code && <p className="text-xs text-destructive">{fieldErrors.code}</p>}
                </div>
              )}
              {info && <p className="text-xs text-muted-foreground">{info}</p>}
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Please wait..." : otpSent ? "Create account" : "Send code"}
              </Button>
              {otpSent && (
                <button
                  type="button"
                  onClick={() => requestCode("signup")}
                  disabled={loading}
                  className="w-full text-xs text-muted-foreground hover:text-foreground"
                >
                  Resend code
                </button>
              )}
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
