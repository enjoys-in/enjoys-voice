"use client";

import { useState, useEffect, useCallback } from "react";
import { api, type CallRecordResponse } from "../lib/api";
import { useAuthStore } from "../stores";

const STALE_MS = 30_000; // Only refetch if older than 30s
let lastFetchedAt = 0;
let cachedCalls: CallRecordResponse[] = [];

export function resetCallHistoryCache() {
  lastFetchedAt = 0;
  cachedCalls = [];
}

export function useCallHistory() {
  const [calls, setCalls] = useState<CallRecordResponse[]>(cachedCalls);
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
      const data = await api.getCallsByUser(user.extension);
      cachedCalls = data;
      lastFetchedAt = Date.now();
      setCalls(data);
    } catch (err) {
      try {
        const data = await api.getCalls();
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

  return { calls, loading, error, refresh };
}
