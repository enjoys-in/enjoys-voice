"use client";

import { useEffect, useCallback } from "react";
import { useAuthStore, useSettingsStore } from "../stores";
import { api } from "../lib/api";

/**
 * Syncs settings store with backend API.
 * Call once in the app shell to load initial data.
 */
export function useSettingsSync() {
  const { user } = useAuthStore();
  const { setSettings, setLoading, addBlockedNumber, settings } = useSettingsStore();

  // Load blocked numbers + forwarding from API on mount
  const loadSettings = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [blockRes, fwdRes] = await Promise.all([
        api.getBlockedNumbers(user.extension),
        api.getForwarding(user.extension),
      ]);
      setSettings({
        blockedNumbers: blockRes.blocked,
        forwarding: {
          busy: fwdRes.busy || undefined,
          noAnswer: fwdRes.noAnswer || undefined,
          unavailable: fwdRes.unavailable || undefined,
        },
      });
    } catch {
      // Silently fail — settings will use defaults
    } finally {
      setLoading(false);
    }
  }, [user, setSettings, setLoading]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Save forwarding to API
  const saveForwarding = useCallback(
    async (type: "busy" | "noAnswer" | "unavailable", target: string | undefined) => {
      if (!user) return;
      try {
        await api.setForwarding(user.extension, { type, target: target || null });
      } catch {
        // Revert on failure if needed
      }
    },
    [user]
  );

  // Block a number via API
  const blockNumber = useCallback(
    async (number: string) => {
      if (!user) return;
      try {
        await api.blockNumber(user.extension, { number });
      } catch {
        // silent
      }
    },
    [user]
  );

  // Unblock a number via API
  const unblockNumber = useCallback(
    async (number: string) => {
      if (!user) return;
      try {
        await api.unblockNumber(user.extension, number);
      } catch {
        // silent
      }
    },
    [user]
  );

  return { loadSettings, saveForwarding, blockNumber, unblockNumber };
}
