"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  LANG_STORAGE_KEY,
  LANGS,
  TRANSLATIONS,
  translate,
  type Lang,
} from "@/lib/translations";

/**
 * App-wide language state. Persisted per-browser in localStorage under
 * `y.lang`. Only staff surfaces read it (manager/owner/chef pages are
 * English-only per owner direction), but the provider sits at the root
 * so any client component can call useLang() without extra wiring.
 */

type LangCtx = {
  lang: Lang;
  setLang: (next: Lang) => void;
  t: (key: string, fallback?: string) => string;
};

const Ctx = createContext<LangCtx | null>(null);

function isLang(v: string | null): v is Lang {
  return v !== null && (LANGS as readonly string[]).includes(v);
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // Default to English on the server render — the effect below rehydrates
  // from localStorage on mount, so users see their saved language on the
  // very first paint after the JS bundle boots.
  const [lang, setLangState] = useState<Lang>("en");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
      if (isLang(stored)) setLangState(stored);
    } catch {
      // localStorage unavailable (e.g. Safari private mode) — silently
      // keep the default.
    }
    setHydrated(true);
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {
      // Same reason as above — best-effort persistence.
    }
    if (typeof document !== "undefined") {
      document.documentElement.lang = next;
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (typeof document !== "undefined") {
      document.documentElement.lang = lang;
    }
  }, [hydrated, lang]);

  const value = useMemo<LangCtx>(
    () => ({
      lang,
      setLang,
      t: (key, fallback) => translate(lang, key, fallback),
    }),
    [lang, setLang],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLang(): LangCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Safe default so calling useLang() from outside the provider (e.g.
    // during a Storybook render or a stray unit test) doesn't crash the
    // page — components just render English.
    return {
      lang: "en",
      setLang: () => {},
      t: (key, fallback) => TRANSLATIONS.en[key] ?? fallback ?? key,
    };
  }
  return ctx;
}
