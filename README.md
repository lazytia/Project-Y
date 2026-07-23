# Project Y

Next.js 15 (App Router) + TypeScript + Firebase, PWA-ready.

## Setup

```bash
npm install
cp .env.local.example .env.local   # then fill in Firebase web app credentials
npm run dev
```

Open http://localhost:3000

## Firebase credentials

Get them from the Firebase Console:
Project Settings → General → Your apps → Web app → SDK setup & configuration.
Paste each value into `.env.local`.

## Structure

```
src/
  app/                  Route segments (one folder per page)
    layout.tsx          Root shell (sidebar + main)
    globals.css         Theme tokens — change here to reskin everything
    page.tsx            Dashboard
    people/...
    scheduling/...
    operations/...
    payroll/...
    inventory/...
  components/
    Sidebar.tsx         Navigation
    PageShell.tsx       Reusable page header + body wrapper
  lib/
    firebase.ts         Firebase SDK init (Auth, Firestore, Storage)
```

## Reskinning

All colors, spacing, radii, and font sizes are CSS variables in
`src/app/globals.css`. Component visuals live in matching `*.module.css`
files alongside each component. To change the look:

1. Edit `globals.css` tokens for a global pass.
2. Edit a component's `.module.css` for component-specific overrides.
3. No inline styles in `.tsx` files — keep visual concerns out of logic.

## PWA

`public/manifest.json` is wired into the root layout. Add `icon-192.png`
and `icon-512.png` to `public/` before shipping to production. A service
worker for offline support can be added later via Serwist.

## Deploy (Firebase App Hosting)

Firebase **project**: `project-y-d04dc`  
App Hosting **backend** (primary): `project-y-asia` (`asia-southeast1`)

Live URL: https://project-y-asia--project-y-d04dc.asia-southeast1.hosted.app

`firebase.json` points `apphosting.backendId` at `project-y-asia`. Deploy with:

```bash
npx firebase-tools@latest deploy --only apphosting
```

Push to the GitHub repo (`lazytia/Project-Y`) also triggers a rollout when
App Hosting is connected to the backend.
