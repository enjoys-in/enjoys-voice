# Dark / Light Theme Toggle

> **Goal:** add a dark/light/system theme toggle to the web UI. The app already
> uses Tailwind CSS + shadcn/ui which have built-in dark mode support — this is
> primarily a wiring task.
>
> **What already exists to build on:**
>   - Tailwind CSS with `darkMode: 'class'` (shadcn/ui default). All shadcn
>     components already have dark mode variants via CSS custom properties.
>   - `globals.css` (`web/app/globals.css`) — likely already has `:root` and
>     `.dark` theme definitions from the shadcn/ui init.
>   - `layout.tsx` (`web/app/layout.tsx`) — root layout where the `dark` class
>     would be applied to `<html>`.
>   - Settings store (`settings.store.ts`) — persists user preferences.

## Implementation

### Theme Provider

- [ ] Install `next-themes`: `bun add next-themes` (the standard Next.js theme
      library, works with shadcn/ui out of the box).
- [ ] Create a `ThemeProvider` wrapper in `web/app/components/ThemeProvider.tsx`:
      ```tsx
      'use client';
      import { ThemeProvider as NextThemesProvider } from 'next-themes';
      export function ThemeProvider({ children }: { children: React.ReactNode }) {
        return (
          <NextThemesProvider attribute="class" defaultTheme="system" enableSystem>
            {children}
          </NextThemesProvider>
        );
      }
      ```
- [ ] Wrap the app in `layout.tsx` with `<ThemeProvider>`.

### Toggle UI

- [ ] Add a theme toggle button to `SettingsScreen.tsx`:
      - Three options: ☀️ Light / 🌙 Dark / 🖥️ System
      - Use `useTheme()` from `next-themes` to read and set the theme.
      - Segmented control or dropdown with icons.
- [ ] Optionally add a small theme toggle icon in the app header/nav for quick
      access (moon/sun icon that cycles through modes).

### CSS Verification

- [ ] Verify `globals.css` has both `:root` (light) and `.dark` (dark) theme
      variables. If shadcn/ui was initialized with dark mode, these should exist.
      If not, run `npx shadcn-ui@latest init` to regenerate or manually add the
      dark theme variables.
- [ ] Test all screens in dark mode: login, keypad, recents, contacts, voicemail,
      settings, admin dashboard, IVR builder. Fix any hardcoded colors that don't
      adapt.

### Persistence

- [ ] `next-themes` persists the preference in `localStorage` automatically
      (key: `theme`). No server-side storage needed for a single-user app.

## Guardrails

- [ ] **Flash of unstyled content**: `next-themes` handles this with a script
      injected in `<head>` that reads localStorage before paint. No flash.
- [ ] **Admin dashboard charts**: recharts colors may need adjustment for dark
      mode. Use CSS custom properties for chart colors.
- [ ] **IVR builder canvas**: if it uses a custom canvas/SVG, verify contrast in
      dark mode.
- [ ] **PWA splash screen / meta theme-color**: update `<meta name="theme-color">`
      dynamically based on the active theme.
