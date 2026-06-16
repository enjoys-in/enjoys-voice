"use client";

import { useEffect, useState } from "react";
import { goApi, type SystemSettings } from "../lib/go-api";

export interface Branding {
  brandName: string;
  tagline: string;
  accentColor: string;
  logoUrl: string;
}

export interface SystemPolicies {
  allowUserDnd: boolean;
  defaultRecording: boolean;
  defaultVoicemail: boolean;
  recordingRetentionDays: number;
  maxConcurrentCalls: number;
}

const DEFAULT_BRANDING: Branding = {
  brandName: "Enjoys Voice",
  tagline: "",
  accentColor: "#6366f1",
  logoUrl: "",
};

const DEFAULT_POLICIES: SystemPolicies = {
  allowUserDnd: true,
  defaultRecording: false,
  defaultVoicemail: false,
  recordingRetentionDays: 30,
  maxConcurrentCalls: 0,
};

// Module-level cache so the public system-settings fetch happens once per page
// load and is shared by every component that reads branding or policies
// (login, sidebar, settings…).
let cached: SystemSettings | null = null;
let inflight: Promise<SystemSettings | null> | null = null;

function fetchSettings(): Promise<SystemSettings | null> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = goApi
      .getSystemSettings()
      .then((s) => {
        cached = s;
        return cached;
      })
      .catch(() => null)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

function toBranding(s: SystemSettings | null): Branding {
  if (!s) return DEFAULT_BRANDING;
  return {
    brandName: s.brand_name?.trim() || DEFAULT_BRANDING.brandName,
    tagline: s.brand_tagline?.trim() || "",
    accentColor: s.accent_color?.trim() || DEFAULT_BRANDING.accentColor,
    logoUrl: s.logo_url?.trim() || "",
  };
}

function toPolicies(s: SystemSettings | null): SystemPolicies {
  if (!s) return DEFAULT_POLICIES;
  return {
    allowUserDnd: s.allow_user_dnd ?? DEFAULT_POLICIES.allowUserDnd,
    defaultRecording: s.default_recording ?? DEFAULT_POLICIES.defaultRecording,
    defaultVoicemail: s.default_voicemail ?? DEFAULT_POLICIES.defaultVoicemail,
    recordingRetentionDays: s.recording_retention_days ?? DEFAULT_POLICIES.recordingRetentionDays,
    maxConcurrentCalls: s.max_concurrent_calls ?? DEFAULT_POLICIES.maxConcurrentCalls,
  };
}

/**
 * White-label branding (name / tagline / logo / accent) sourced from the public
 * `/system-settings` endpoint an admin edits in the Customization tab. Returns
 * the built-in defaults synchronously so the UI renders instantly and never
 * blocks on the network, then swaps in the fetched values once they arrive.
 */
export function useBranding(): Branding {
  const [branding, setBranding] = useState<Branding>(toBranding(cached));

  useEffect(() => {
    let active = true;
    fetchSettings().then((s) => {
      if (active) setBranding(toBranding(s));
    });
    return () => {
      active = false;
    };
  }, []);

  return branding;
}

/**
 * System-wide policy flags an admin sets in the Customization tab (e.g. whether
 * users may toggle Do Not Disturb). Shares the same cached public fetch as
 * `useBranding`; defaults are permissive so the UI never hides controls because
 * of a transient fetch failure.
 */
export function useSystemPolicies(): SystemPolicies {
  const [policies, setPolicies] = useState<SystemPolicies>(toPolicies(cached));

  useEffect(() => {
    let active = true;
    fetchSettings().then((s) => {
      if (active) setPolicies(toPolicies(s));
    });
    return () => {
      active = false;
    };
  }, []);

  return policies;
}
