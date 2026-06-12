"use client";

import { useEffect, useCallback } from "react";
import { useAuthStore, useSettingsStore } from "../stores";
import { api } from "../lib/api";

// Module-level flag: ensures settings are only fetched once across all instances
let settingsLoaded = false;

export function resetSettingsCache() {
  settingsLoaded = false;
}

/**
 * Syncs settings store with backend API.
 * Safe to call from multiple components — will only fetch once.
 */
export function useSettingsSync() {
  const { user } = useAuthStore();
  const { setSettings, setLoading } = useSettingsStore();

  // Load blocked numbers + forwarding + pstn-forward from API (once globally)
  const loadSettings = useCallback(async () => {
    if (!user) return;
    if (settingsLoaded) return;
    settingsLoaded = true;
    setLoading(true);
    try {
      const [blockRes, fwdRes, pstnFwdRes] = await Promise.all([
        api.getBlockedNumbers(user.extension),
        api.getForwarding(user.extension),
        api.getPstnForward(user.extension),
      ]);
      setSettings({
        blockedNumbers: blockRes.blocked,
        forwarding: {
          busy: fwdRes.busy || undefined,
          noAnswer: fwdRes.noAnswer || undefined,
          unavailable: fwdRes.unavailable || undefined,
        },
        pstnForwardToBrowser: pstnFwdRes.enabled,
        pstnForwardTarget: pstnFwdRes.target || "",
      });
    } catch {
      settingsLoaded = false; // Allow retry on failure
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

  // Save PSTN forward to browser setting
  const savePstnForward = useCallback(
    async (enabled: boolean, target?: string) => {
      if (!user) return;
      try {
        await api.setPstnForward(user.extension, enabled, target);
      } catch {
        // silent
      }
    },
    [user]
  );

  return { loadSettings, saveForwarding, blockNumber, unblockNumber, savePstnForward };
}
