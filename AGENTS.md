# Agent guide (Claude / Cursor)

Shared rules for AI assistants working on Project Y. Both Claude Code and
Cursor read this file before making changes.

## Stack

- Next.js 15 (App Router) + TypeScript + React 19
- Firebase (Auth, Firestore, Storage) — client SDK
- PWA via `public/manifest.json`
- Deploy: Firebase App Hosting (`apphosting.yaml`), backend **`project-y-asia`**
  in Firebase project **`project-y-d04dc`** (`asia-southeast1`)

## Folder layout

```
src/
  app/                Route segments — one folder per page
  components/         Reusable React components (each with its own .module.css)
  lib/                Framework-agnostic helpers (firebase.ts, etc.)
public/               Static assets served at /
```

## Styling rules — IMPORTANT

The user wants design to be easy to swap. Follow strictly:

1. **No inline styles, no Tailwind, no styled-components.** Use CSS Modules only.
2. **Every component or page has its own `*.module.css`** next to it.
3. **All colors / spacing / radii / font sizes come from CSS variables**
   defined in `src/app/globals.css`. Do not hardcode hex colors or pixel
   values inside `.module.css` files — reference `var(--color-*)`,
   `var(--space-*)`, `var(--radius-*)`, `var(--font-size-*)`.
4. To reskin globally, edit `globals.css` only. To restyle one component,
   edit that component's `.module.css` only.

## Auth

- Auth gate lives in `src/components/AuthProvider.tsx` + `AppShell.tsx`.
- `/login` is the only public route. Anything else redirects unauthenticated
  users to `/login`.
- Use `useAuth()` hook to read the current user inside client components.

## Adding a new page

1. Create `src/app/<group>/<slug>/page.tsx` returning `<PageShell title="…" />`.
2. Add the route to the `NAV` array in `src/components/Sidebar.tsx`.
3. If the page needs custom design, create `page.module.css` next to it
   and stop using `PageShell`.

## Commits

- Conventional, short subject. Body explains why if non-obvious.
- Never commit `.env.local`, build output, or editor folders.
- Either Claude or Cursor may push to `main`. Always pull before pushing
  if you've been away from the repo.

## What NOT to do

- Don't introduce Tailwind, CSS-in-JS, or component libraries without asking.
- Don't add Firebase service worker / offline cache yet — deferred until
  data flows are defined.
- Don't move auth logic into Next.js middleware until SSR auth is needed.
