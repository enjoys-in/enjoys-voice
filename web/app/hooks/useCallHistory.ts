"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { api, type CallRecordResponse } from "../lib/api";
import { useAuthStore } from "../stores";

const STALE_MS = 30_000; // Only refetch if older than 30s

export function useCallHistory() {
  const [calls, setCalls] = useState<CallRecordResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuthStore();
  const lastFetched = useRef(0);

  const fetch = useCallback(async (force = false) => {
    if (!user) return;
    if (!force && Date.now() - lastFetched.current < STALE_MS) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getCallsByUser(user.extension);
      setCalls(data);
      lastFetched.current = Date.now();
    } catch (err) {
      try {
        const data = await api.getCalls();
        setCalls(data);
        lastFetched.current = Date.now();
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
