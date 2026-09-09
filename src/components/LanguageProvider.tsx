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
import { useAuth } from "./AuthProvider";

/**
 * App-wide language state. Persisted per-browser in localStorage under
 * `y.lang`. Only staff surfaces read it (manager/owner/chef pages are
 * English-only per owner direction), but the provider sits at the root
 * so any client component can call useLang() without extra wiring.
 *
 * The translation is there to get a new hire through onboarding — a form
 * about tax residency and superannuation, put in front of someone in their
 * first week in the country. Once the owner activates them the job is done
 * and the app is English from then on, which is the language the rosters,
 * the shift notes and the announcements are written in anyway.
 *
 * That switch is made here rather than at each toggle, because hiding the
 * four toggles would only have hidden the control: a staff member who had
 * already picked Japanese would have been left in it, with nothing left on
 * screen to change it back with. `canChooseLanguage` is what the toggles
 * read, and the same flag pins the language itself.
 */

type LangCtx = {
  lang: Lang;
  setLang: (next: Lang) => void;
  t: (key: string, fallback?: string) => string;
  /** False once the employee is activated — see above. */
  canChooseLanguage: boolean;
};

const Ctx = createContext<LangCtx | null>(null);

function isLang(v: string | null): v is Lang {
  return v !== null && (LANGS as readonly string[]).includes(v);
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const { staffActivated } = useAuth();
  // Only an explicit `true` locks it. `null` is "the server has not answered
  // yet", and treating that as activated would flip a staff member who is
  // mid-form back into English on every cold start, mid-sentence.
  const canChooseLanguage = staffActivated !== true;

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
      document.documentElement.lang = canChooseLanguage ? lang : "en";
    }
  }, [hydrated, lang, canChooseLanguage]);

  const value = useMemo<LangCtx>(() => {
    // The stored choice is read but not honoured once locked, rather than
    // deleted: it costs nothing to leave behind, and if this employee is
    // ever put back through onboarding they get their language back.
    const effective: Lang = canChooseLanguage ? lang : "en";
    return {
      lang: effective,
      setLang: canChooseLanguage ? setLang : () => {},
      t: (key, fallback) => translate(effective, key, fallback),
      canChooseLanguage,
    };
  }, [lang, setLang, canChooseLanguage]);

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
      canChooseLanguage: false,
    };
  }
  return ctx;
}
