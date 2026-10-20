"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import type { User } from "firebase/auth";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import { useLang } from "@/components/LanguageProvider";
import { useBackTo } from "@/hooks/useBackTo";
import {
  fetchAcknowledgements,
  saveAcknowledgement,
  type Acknowledgement,
} from "@/lib/acknowledgements";
import { SERVICE_ESSENTIALS_VERSION } from "@/lib/hr-documents";
import { isChef } from "@/lib/permissions";
import { ROUTES } from "@/lib/routes";
import { positionLabelOf } from "@/lib/staff-display";
import styles from "./page.module.css";

type Group = "hall" | "kitchen";

/** Shared geometry for the guideline illustrations, so one edit moves all three. */
const ART_PROPS = {
  width: 44,
  height: 44,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/**
 * The hall staff's guidelines, in the order they are read.
 *
 * `image` is a photo under public/ for the card's right-hand side; until one is
 * supplied the card draws a small illustration instead, so a missing photo
 * leaves a finished card and not an empty box.
 */
const HALL_GUIDELINES: readonly {
  titleKey: string;
  bodyKey: string;
  image?: string;
  art: React.ReactNode;
}[] = [
  {
    titleKey: "se.g1.title",
    bodyKey: "se.g1.body",
    art: (
      <svg {...ART_PROPS}>
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
        <polyline points="9 10 11 12 15 8" />
      </svg>
    ),
  },
  {
    titleKey: "se.g2.title",
    bodyKey: "se.g2.body",
    art: (
      <svg {...ART_PROPS}>
        <path d="M4 5h11a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9l-4 3v-3H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
        <path d="M19 10h1a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-1v3l-3.5-3H12" />
      </svg>
    ),
  },
  {
    titleKey: "se.g3.title",
    bodyKey: "se.g3.body",
    art: (
      <svg {...ART_PROPS}>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
];

/** Hall or kitchen, from the staff record; null when it says neither. */
function groupOf(raw: Record<string, unknown>, user: User): Group | null {
  const label = positionLabelOf(raw);
  if (label === "Hall Staff") return "hall";
  if (label === "Kitchen Staff") return "kitchen";
  // A chef signs in without an onboarding record to read a position from.
  return isChef(user) ? "kitchen" : null;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

export default function ServiceEssentialsPage() {
  const { user } = useAuth();
  const { t } = useLang();
  // Back to the list this was opened from, not the dashboard — see useBackTo.
  const goBack = useBackTo(ROUTES.staffHandbookTraining);

  // `undefined` until the record has been read, so neither tab is offered as
  // available — or as not — before it is known which one is theirs.
  const [group, setGroup] = useState<Group | null | undefined>(undefined);
  const [active, setActive] = useState<Group>("hall");
  const [ack, setAck] = useState<Acknowledgement | null>(null);
  const [ticked, setTicked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [snap, acks] = await Promise.all([
        getDoc(doc(getDb(), "staff_onboarding", user.uid)).catch(() => null),
        fetchAcknowledgements(user).catch(() => ({}) as Awaited<ReturnType<typeof fetchAcknowledgements>>),
      ]);
      if (cancelled) return;
      const mine = groupOf((snap?.data() ?? {}) as Record<string, unknown>, user);
      setGroup(mine);
      setActive(mine ?? "hall");
      setAck(acks.serviceEssentialsHall ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Only your own group's guidelines can be opened. With no group on record
  // there is nothing to hold the other tab back for, so both stay open.
  const canOpen = (g: Group) => group === null || group === g;

  // An acknowledgement of an earlier wording does not count for this one.
  const acknowledged = ack?.version === SERVICE_ESSENTIALS_VERSION;

  async function handleAcknowledge() {
    if (!user || !ticked || saving) return;
    setSaving(true);
    setError(false);
    try {
      setAck(await saveAcknowledgement(user, "serviceEssentialsHall", SERVICE_ESSENTIALS_VERSION));
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.page}>
      <button
        type="button"
        className={styles.backBtn}
        onClick={goBack}
        aria-label={t("common.back")}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        <span>{t("common.back")}</span>
      </button>

      <h1 className={styles.title}>{t("docs.hub.serviceEssentials")}</h1>
      <p className={styles.subtitle}>
        {t(active === "hall" ? "se.sub.hall" : "se.sub.kitchen")}
      </p>

      {group === undefined ? (
        <p className={styles.loading}>{t("staff.loading")}</p>
      ) : (
        <>
          <div className={styles.tabs} role="tablist">
            {(["hall", "kitchen"] as const).map((g) => (
              <button
                key={g}
                type="button"
                role="tab"
                aria-selected={active === g}
                disabled={!canOpen(g)}
                className={`${styles.tab} ${active === g ? styles.tabActive : ""}`}
                onClick={() => setActive(g)}
              >
                {t(g === "hall" ? "se.tab.hall" : "se.tab.kitchen")}
              </button>
            ))}
          </div>

          {active === "hall" ? (
            <>
              {HALL_GUIDELINES.map((g, i) => (
                <article key={g.titleKey} className={styles.card}>
                  <span className={styles.number} aria-hidden="true">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className={styles.cardText}>
                    <h2 className={styles.cardTitle}>{t(g.titleKey)}</h2>
                    <p className={styles.cardBody}>{t(g.bodyKey)}</p>
                  </div>
                  <div className={styles.cardArt} aria-hidden="true">
                    {g.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={g.image} alt="" className={styles.cardImage} loading="lazy" />
                    ) : (
                      g.art
                    )}
                  </div>
                </article>
              ))}

              <section className={styles.ack}>
                {acknowledged && ack?.acknowledgedAt ? (
                  <p className={styles.ackDone}>
                    <span aria-hidden="true">✓</span>{" "}
                    {t("se.ack.done").replace("{date}", fmtDate(ack.acknowledgedAt))}
                  </p>
                ) : (
                  <>
                    <label className={styles.ackRow}>
                      <input
                        type="checkbox"
                        className={styles.ackBox}
                        checked={ticked}
                        onChange={(e) => setTicked(e.target.checked)}
                      />
                      <span>{t("se.ack.label")}</span>
                    </label>
                    {error && <p className={styles.ackError}>{t("se.ack.error")}</p>}
                    <button
                      type="button"
                      className={styles.ackBtn}
                      disabled={!ticked || saving}
                      onClick={handleAcknowledge}
                    >
                      {saving ? t("se.ack.saving") : t("se.ack.button")}
                    </button>
                  </>
                )}
              </section>
            </>
          ) : (
            <section className={styles.soon}>
              <svg className={styles.soonArt} viewBox="0 0 120 96" fill="none" aria-hidden="true">
                <ellipse cx="60" cy="88" rx="38" ry="5" fill="currentColor" opacity="0.08" />
                <path
                  d="M30 60V46a15 15 0 0 1 5-28 17 17 0 0 1 32-6 17 17 0 0 1 31 8 15 15 0 0 1 2 26v14z"
                  fill="var(--color-bg)"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
                <rect x="30" y="60" width="68" height="20" rx="3" fill="var(--color-bg)" stroke="currentColor" strokeWidth="2" />
                <path d="M46 24v28M64 20v32M82 24v28" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.25" />
              </svg>
              <h2 className={styles.soonTitle}>{t("se.soon.title")}</h2>
              <p className={styles.soonBody}>{t("se.soon.body")}</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
