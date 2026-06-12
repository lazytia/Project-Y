export const ROUTES = {
  home: "/",
  login: "/login",
} as const;

export const PUBLIC_ROUTES: ReadonlySet<string> = new Set([ROUTES.login]);
