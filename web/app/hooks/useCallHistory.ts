"use client";

import { useState, useEffect, useCallback } from "react";
import { goApi } from "../lib/go-api";
import type { CallRecord } from "../types";
import { useAuthStore } from "../stores";

const STALE_MS = 30_000; // Only refetch if older than 30s
let lastFetchedAt = 0;
let cachedCalls: CallRecord[] = [];

export function resetCallHistoryCache() {
  lastFetchedAt = 0;
  cachedCalls = [];
}

export function useCallHistory() {
  const [calls, setCalls] = useState<CallRecord[]>(cachedCalls);
  const [loading, setLoading] = useState(!cachedCalls.length);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuthStore();

  const fetch = useCallback(async (force = false) => {
    if (!user) return;
    if (!force && Date.now() - lastFetchedAt < STALE_MS) {
      // Use cached data if still fresh
      if (cachedCalls.length && calls !== cachedCalls) setCalls(cachedCalls);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await goApi.getCallsByUser(user.extension);
      cachedCalls = data;
      lastFetchedAt = Date.now();
      setCalls(data);
    } catch (err) {
      try {
        const data = await goApi.getCalls();
        cachedCalls = data;
        lastFetchedAt = Date.now();
        setCalls(data);
      } catch {
        setError("Failed to load call history");
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const refresh = useCallback(() => fetch(true), [fetch]);

  const clearHistory = useCallback(async () => {
    if (!user) return;
    // Purge on the server first so the logs don't reappear on the next fetch;
    // then clear the local cache + state. Local clear still runs on failure.
    try {
      await goApi.clearCallsByUser(user.extension);
    } catch {
      setError("Failed to clear call history");
    }
    cachedCalls = [];
    lastFetchedAt = Date.now();
    setCalls([]);
  }, [user]);

  return { calls, loading, error, refresh, clearHistory };
}
