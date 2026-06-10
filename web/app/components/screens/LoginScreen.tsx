"use client";

import { useState } from "react";
import { Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useAuthStore } from "../../stores";
import { api, ApiError } from "../../lib/api";

export function LoginScreen() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [extension, setExtension] = useState("");
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { login } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const data =
        mode === "login"
          ? await api.login({ username: extension, password })
          : await api.signup({ name, mobile, password });

      login(
        {
          extension: data.user.extension,
          username: data.user.username,
          name: data.user.name,
          mobile: data.user.mobile,
        },
        data.user.extension,
        {
          wsUrl: data.sipConfig.wsUrl,
          sipWsUrl: data.sipConfig.sipWsUrl,
          domain: data.sipConfig.domain,
        }
      );
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Connection failed");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-dvh p-4 bg-background">
      <Card className="w-full max-w-sm border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <Phone className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl">Enjoys Voice</CardTitle>
          <CardDescription>
            {mode === "login" ? "Sign in with your extension or phone" : "Sign up with your phone number"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  placeholder="John Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                />
              </div>
            )}
            {mode === "signup" ? (
              <div className="space-y-2">
                <Label htmlFor="mobile">Phone Number</Label>
                <Input
                  id="mobile"
                  type="tel"
                  placeholder="+91 9876543210"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  required
                  autoComplete="tel"
                />
                <p className="text-[11px] text-muted-foreground">
                  A unique 7-digit extension will be assigned to you
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="extension">Extension / Phone</Label>
                <Input
                  id="extension"
                  placeholder="1001 or 9876543210"
                  value={extension}
                  onChange={(e) => setExtension(e.target.value)}
                  required
                  autoComplete="username"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
              />
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Connecting..." : mode === "login" ? "Sign In" : "Create Account"}
            </Button>
          </form>
          <div className="mt-4 text-center">
            <button
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}
            >
              {mode === "login" ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
