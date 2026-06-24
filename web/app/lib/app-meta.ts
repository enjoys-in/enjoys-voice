// App metadata surfaced in the UI (version badge, "view source" link).
//
// APP_VERSION is injected at build time from web/package.json via next.config.ts
// (NEXT_PUBLIC_APP_VERSION) and bumped automatically by the pre-commit hook.
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";

// Public source repository, shown as a GitHub link in the sidebar and settings.
export const REPO_URL = "https://github.com/enjoys-in/enjoys-voice";
