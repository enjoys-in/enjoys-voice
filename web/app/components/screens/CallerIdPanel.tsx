"use client";

import { useCallback, useEffect, useState } from "react";
import { PhoneCall, ShieldCheck, Loader2, Trash2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PhoneInput } from "../ui/PhoneInput";
import {
  goApi,
  GoApiError,
  type CallerIdStatus,
  type CallerIdVerifyStart,
} from "../../lib/go-api";

/**
 * BYON outbound caller-ID verification. A user proves ownership of their own
 * number via Twilio: we start a validation request (Twilio calls the number),
 * surface the code the user must key in, then confirm once Twilio reports the
 * number as a verified caller ID. Only a verified number is presented on
 * browser→PSTN calls; otherwise the shared trunk number is used.
 *
 * Self-contained (talks straight to goApi.callerId) so it doesn't entangle the
 * settings store, which mirrors only the live SIP-relevant settings.
 */
export function CallerIdPanel() {
  const [status, setStatus] = useState<CallerIdStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [number, setNumber] = useState("");
  const [countryCode, setCountryCode] = useState("+91");
  const [pending, setPending] = useState<CallerIdVerifyStart | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await goApi.callerId.get();
      setStatus(res);
    } catch {
      setStatus({ number: "", verified: false, verifiedAt: null });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleError = (e: unknown) => {
    if (e instanceof GoApiError) {
      if (e.status === 503) setUnavailable(true);
      setError(e.message);
    } else {
      setError("Something went wrong. Please try again.");
    }
  };

  const startVerify = async () => {
    if (!number.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await goApi.callerId.startVerify(number.trim(), countryCode);
      setPending(res);
      setStatus({ number: res.number, verified: false, verifiedAt: null });
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  };

  const confirmVerify = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await goApi.callerId.confirmVerify();
      setStatus(res);
      if (res.verified) setPending(null);
      else setError("Not verified yet — complete the call from Twilio, then check again.");
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await goApi.callerId.remove();
      setStatus({ number: "", verified: false, verifiedAt: null });
      setPending(null);
      setNumber("");
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  };

  const verified = status?.verified ?? false;
  const hasPending = !verified && !!status?.number;

  return (
    <Card className="border-border/50 bg-card/50">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <PhoneCall className="h-4 w-4" /> Outbound Caller ID
          {verified && (
            <Badge variant="secondary" className="ml-auto gap-1 text-emerald-600">
              <ShieldCheck className="h-3 w-3" /> Verified
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0 space-y-3">
        <p className="text-xs text-muted-foreground">
          Present your own number on outgoing calls. We verify ownership with a
          quick automated call before it can be used; until then your calls use
          the shared trunk number.
        </p>

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </div>
        ) : unavailable ? (
          <p className="text-xs text-muted-foreground">
            Caller ID verification isn&apos;t available on this workspace.
          </p>
        ) : verified ? (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{status?.number}</p>
              {status?.verifiedAt && (
                <p className="text-xs text-muted-foreground">
                  Verified {new Date(status.verifiedAt).toLocaleDateString()}
                </p>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={remove} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {!hasPending && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Your phone number</Label>
                <PhoneInput
                  value={number}
                  countryCode={countryCode}
                  onValueChange={setNumber}
                  onCountryCodeChange={setCountryCode}
                  disabled={busy}
                />
                <Button size="sm" className="w-full" onClick={startVerify} disabled={busy || !number.trim()}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify number"}
                </Button>
              </div>
            )}

            {(pending || hasPending) && (
              <div className="space-y-2 rounded-md border border-border/50 bg-muted/30 p-3">
                <p className="text-xs">
                  {pending ? (
                    <>
                      Twilio is calling <span className="font-medium">{pending.number}</span>.
                      When prompted, enter this code:
                    </>
                  ) : (
                    <>
                      Verification pending for{" "}
                      <span className="font-medium">{status?.number}</span>. Answer
                      the call from Twilio and enter the code it gave you.
                    </>
                  )}
                </p>
                {pending && (
                  <p className="text-center text-2xl font-mono font-semibold tracking-widest">
                    {pending.validationCode}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1" onClick={confirmVerify} disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : (<><RefreshCw className="mr-1 h-3 w-3" /> Check status</>)}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={remove} disabled={busy}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
