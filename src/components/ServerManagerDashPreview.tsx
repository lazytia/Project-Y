import { prefetchManagerDash } from "@/lib/manager-dash-server";
import type { DashboardKind } from "@/lib/session-dashboard";
import { isManagerDashboardKind } from "@/lib/session-dashboard";
import { dCountdownLabel } from "@/lib/catering-orders";
import styles from "./ManagerDashboard.module.css";

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(n);
}

type Props = {
  sessionDashboard: DashboardKind | null;
  roleLabel?: string;
  displayName?: string;
};

/**
 * Paints manager/chef dashboard metrics in the first HTML response so cold
 * starts show content before the Firebase + React bundle finishes loading.
 */
export default async function ServerManagerDashPreview({
  sessionDashboard,
  roleLabel = "Store Manager",
  displayName,
}: Props) {
  if (!isManagerDashboardKind(sessionDashboard)) return null;

  let cache = null;
  try {
    const snap = await Promise.race([
      prefetchManagerDash(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 600)),
    ]);
    cache = snap?.cache ?? null;
  } catch {
    /* client fetch still runs */
  }

  const name = displayName ?? "there";
  const totalPax = cache?.totalPax;
  const totalBookings = cache?.totalBookings;

  return (
    <div id="ssr-manager-dash" className={styles.page} aria-hidden="true">
      <header className={styles.greeting}>
        <h1 className={styles.greetingTitle}>Hello, {name}</h1>
        <p className={styles.greetingRole}>{roleLabel}</p>
      </header>

      <section>
        <p className={styles.sectionLabel}>TODAY&rsquo;S OPERATIONS</p>
        <div className={styles.opsRow}>
          <div className={styles.opsCard}>
            <div className={styles.opsCardHead}>
              <span className={styles.opsHeadLabel}>Today&rsquo;s Guests</span>
            </div>
            <p className={styles.opsValue}>
              {typeof totalPax === "number" ? totalPax : "—"}
              {typeof totalPax === "number" && <span className={styles.opsUnit}> Pax</span>}
            </p>
            <p className={styles.opsLabel}>
              {typeof totalBookings === "number"
                ? `${totalBookings} Reservations`
                : "Reservations"}
            </p>
          </div>

          <div className={styles.opsCard}>
            <div className={styles.opsCardHead}>
              <span className={styles.opsHeadLabel}>Today&rsquo;s Sales</span>
            </div>
            <p className={styles.opsValue}>
              {typeof cache?.todaySales === "number"
                ? fmtCurrency(cache.todaySales)
                : "—"}
            </p>
            <p className={styles.opsLabel}>Target progress</p>
          </div>
        </div>
      </section>

      <section>
        <p className={styles.sectionLabel}>TODAY&rsquo;S TEAM</p>
        <div className={styles.teamCard}>
          <div className={styles.teamRow}>
            <div className={styles.teamBlock}>
              <p className={styles.teamValue}>{cache?.kitchenStaff ?? "—"}</p>
              <p className={styles.teamLabel}>Kitchen</p>
            </div>
            <div className={styles.teamDivider} aria-hidden="true" />
            <div className={styles.teamBlock}>
              <p className={styles.teamValue}>{cache?.hallStaff ?? "—"}</p>
              <p className={styles.teamLabel}>Hall</p>
            </div>
          </div>
        </div>
      </section>

      {cache?.nextCatering && (
        <section>
          <p className={styles.sectionLabel}>NEXT CATERING</p>
          <p className={styles.opsLabel}>
            {dCountdownLabel(cache.nextCatering.deliveryDateISO)}
          </p>
        </section>
      )}
    </div>
  );
}
