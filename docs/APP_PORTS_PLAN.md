# APP PORTS PLAN — Android, Windows, Linux (team decision 2026-10-17)

> Goal: same polling software as installable apps on Android + Windows +
> Linux, sharing ONE backend API and ONE web frontend codebase. No forks:
> every port renders the same React app; native shells only add packaging,
> icons, offline cache, and device hooks.

## 1. Strategy (in order — cheapest value first)

### Step 0 — PWA first (1 day, zero native code)
- Add `manifest.webmanifest` + service worker (VitePWA plugin) + icons.
- Result: "Install" on Android/Chrome, Windows/Edge, Linux/Chrome TODAY.
- Offline: cache app shell + last allocation snapshot (sessionStorage data
  already exists for Phase2→Phase3 handoff).

### Step 1 — Android via Capacitor (recommended over full rewrite)
- `npm i @capacitor/core @capacitor/cli @capacitor/android`, wrap SAME `dist/`.
- Backend stays hosted (same `/api` base via env `VITE_API_BASE`).
- Play-store ready AAB; keeps session-cookie auth working (Capacitor HTTP
  with credentials).
- Device hooks later: push for notification status, file-share for ZIP/DOCX.

### Step 2 — Windows + Linux via Electron (recommended) or Tauri
- Electron: wrap SAME `dist/`; auto-updater; prints DOCX/PDF via OS dialog.
- Tauri (lighter, optional later): smaller binary, Rust backend — only if
  binary size matters.
- Both reuse `vite build` output unchanged.

### What we will NOT do
- No separate native UI rewrites (Kotlin/Swift/C#) — single React codebase.
- No local Postgres bundling in v1 — apps talk to the hosted backend
  (election data must stay centralized + audited anyway).
- Offline allocation later: Phase 5+ (queue intakes locally, sync when online).

## 2. Prep work required IN THIS REPO (do now, ports later)

1. `VITE_API_BASE` already exists in `client.js` — keep every API call
   going through it (no hardcoded `/api` or `localhost` elsewhere).
2. Cookie auth (`credentials: include`) must survive wrappers — no change
   needed for Capacitor/Electron (same-origin or configured server URL).
3. Add `manifest.webmanifest` + icons + theme-color (PWA installability).
4. Add `vite.config.js` PWA plugin (Workbox, cache app shell only — NEVER
   cache `/api` POSTs).
5. Downloads (ZIP/DOCX) already use blob URLs — works in Capacitor/Electron
   with share-sheet fallback to be added in port step.
6. Keep bundle lean (today ~626KB JS) — code-split per page BEFORE wrapping
   so the Android APK stays small.
