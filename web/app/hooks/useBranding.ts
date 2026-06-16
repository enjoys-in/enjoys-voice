"use client";

import { useEffect, useState } from "react";
import { goApi, type SystemSettings } from "../lib/go-api";

export interface Branding {
  brandName: string;
  tagline: string;
  accentColor: string;
  logoUrl: string;
}

const DEFAULT_BRANDING: Branding = {
  brandName: "Enjoys Voice",
  tagline: "",
  accentColor: "#6366f1",
  logoUrl: "",
};

// Module-level cache so the public system-settings fetch happens once per page
// load and is shared by every component that shows the brand (login, sidebar…).
let cached: Branding | null = null;
let inflight: Promise<Branding> | null = null;

function toBranding(s: SystemSettings): Branding {
  return {
    brandName: s.brand_name?.trim() || DEFAULT_BRANDING.brandName,
    tagline: s.brand_tagline?.trim() || "",
    accentColor: s.accent_color?.trim() || DEFAULT_BRANDING.accentColor,
    logoUrl: s.logo_url?.trim() || "",
  };
}

function fetchBranding(): Promise<Branding> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = goApi
      .getSystemSettings()
      .then((s) => {
        cached = toBranding(s);
        return cached;
      })
      .catch(() => DEFAULT_BRANDING)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/**
 * White-label branding (name / tagline / logo / accent) sourced from the public
 * `/system-settings` endpoint an admin edits in the Customization tab. Returns
 * the built-in defaults synchronously so the UI renders instantly and never
 * blocks on the network, then swaps in the fetched values once they arrive.
 */
export function useBranding(): Branding {
  const [branding, setBranding] = useState<Branding>(cached ?? DEFAULT_BRANDING);

  useEffect(() => {
    let active = true;
    fetchBranding().then((b) => {
      if (active) setBranding(b);
    });
    return () => {
      active = false;
    };
  }, []);

  return branding;
}
