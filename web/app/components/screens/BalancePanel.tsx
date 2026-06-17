"use client";

import { useCallback, useEffect, useState } from "react";
import { Wallet, Loader2, RefreshCw, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { goApi, type GoBalance, type GoBalanceTxn } from "../../lib/go-api";

/** Format an amount in its currency, falling back to a plain number if the
 * currency code isn't a valid ISO-4217 (Intl throws on unknown codes). */
function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`.trim();
  }
}

/** Human label for a ledger entry's reason. */
function reasonLabel(reason: string): string {
  switch (reason) {
    case "call":
      return "Call charge";
    case "topup":
      return "Top-up";
    case "adjustment":
      return "Adjustment";
    default:
      return reason || "Entry";
  }
}

/**
 * Prepaid wallet for the signed-in user: current balance plus a recent ledger.
 * Read-only — top-ups are an admin action (gated by ADMIN_EXTENSIONS server
 * side). The whole panel hides itself when prepaid billing is disabled on the
 * workspace (the balance endpoint reports `enabled: false`), so workspaces that
 * don't use prepaid never see an empty wallet card.
 *
 * Self-contained (talks straight to goApi.balance) like CallerIdPanel, so it
 * doesn't entangle the settings store.
 */
export function BalancePanel() {
  const [balance, setBalance] = useState<GoBalance | null>(null);
  const [txns, setTxns] = useState<GoBalanceTxn[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const bal = await goApi.balance.get();
      setBalance(bal);
      // Only fetch the ledger when prepaid is actually on for this workspace.
      if (bal.enabled) {
        const ledger = await goApi.balance.txns(20).catch(() => []);
        setTxns(ledger);
      }
    } catch {
      setBalance(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    if (busy) return;
    setBusy(true);
    await load();
    setBusy(false);
  };

  // Hidden entirely while loading the first time, and whenever prepaid billing
  // is off — there's nothing meaningful to show.
  if (loading) return null;
  if (!balance || !balance.enabled) return null;

  const currency = balance.currency || "USD";
  const low = balance.balance <= 0;

  return (
    <Card className="border-border/50 bg-card/50">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Wallet className="h-4 w-4" /> Prepaid Balance
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 px-2"
            onClick={refresh}
            disabled={busy}
            aria-label="Refresh balance"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0 space-y-3">
        <div>
          <p
            className={`text-2xl font-semibold ${low ? "text-destructive" : ""}`}
          >
            {formatMoney(balance.balance, currency)}
          </p>
          <p className="text-xs text-muted-foreground">
            {low
              ? "Out of credit — outgoing calls are blocked until you top up."
              : "Available credit for outgoing calls."}
          </p>
        </div>

        {txns.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              Recent activity
            </p>
            <ul className="divide-y divide-border/40 rounded-md border border-border/40">
              {txns.map((t) => {
                const credit = t.amount >= 0;
                return (
                  <li
                    key={t.id}
                    className="flex items-center gap-2 px-3 py-2 text-xs"
                  >
                    {credit ? (
                      <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    <span className="flex-1">{reasonLabel(t.reason)}</span>
                    <span className="text-muted-foreground">
                      {new Date(t.created_at).toLocaleDateString()}
                    </span>
                    <span
                      className={`w-20 text-right font-medium ${
                        credit ? "text-emerald-600" : ""
                      }`}
                    >
                      {credit ? "+" : ""}
                      {formatMoney(t.amount, t.currency || currency)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
