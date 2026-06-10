"use client";

import { useState, useEffect, useCallback } from "react";
import { api, type CallRecordResponse } from "../lib/api";
import { useAuthStore } from "../stores";

export function useCallHistory() {
  const [calls, setCalls] = useState<CallRecordResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuthStore();

  const fetch = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getCallsByUser(user.extension);
      setCalls(data);
    } catch (err) {
      // Fallback: if user-specific fails, try all calls
      try {
        const data = await api.getCalls();
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

  const refresh = useCallback(() => fetch(), [fetch]);

  return { calls, loading, error, refresh };
}
