import { adminDb } from "@/lib/firebase-admin";
import { listPlatterCateringOrders } from "@/lib/catering-square";
import { fetchHiddenOrderIds } from "@/lib/catering-firestore";
import type { ManagerDashCache } from "@/lib/manager-dash-cache";
import { addDaysISO, isoMondayOf, sydneyTodayKey } from "@/lib/sydney-date";

export type ManagerDashServerSnapshot = {
  dateKey: string;
  cache: ManagerDashCache;
};

async function fetchCateringSummaryServer(dateKey: string): Promise<{
  nextCatering: { deliveryDateISO: string } | null;
  weekCateringCount: number;
}> {
  const mondayKey = isoMondayOf(dateKey);
  const sundayKey = addDaysISO(mondayKey, 6);

  try {
    const [ordersRaw, hiddenIds] = await Promise.all([
      listPlatterCateringOrders(),
      fetchHiddenOrderIds(),
    ]);
    const orders =
      hiddenIds.size > 0 ? ordersRaw.filter((o) => !hiddenIds.has(o.id)) : ordersRaw;

    const upcoming = orders
      .filter(
        (o) =>
          (o.status === "CONFIRMED" || o.status === "PENDING") &&
          o.deliveryDateISO >= dateKey,
      )
      .sort((a, b) => a.deliveryDateISO.localeCompare(b.deliveryDateISO));

    const weekCount = orders.filter(
      (o) =>
        o.deliveryDateISO >= mondayKey &&
        o.deliveryDateISO <= sundayKey &&
        o.status !== "CANCELLED",
    ).length;

    return {
      nextCatering: upcoming[0]
        ? { deliveryDateISO: upcoming[0].deliveryDateISO }
        : null,
      weekCateringCount: weekCount,
    };
  } catch {
    return { nextCatering: null, weekCateringCount: 0 };
  }
}

async function fetchTeamCountsServer(
  dateKey: string,
): Promise<{ kitchen: number; hall: number }> {
  const weekKey = isoMondayOf(dateKey);
  const rSnap = await adminDb().collection("rosters_published").doc(weekKey).get();
  if (!rSnap.exists) return { kitchen: 0, hall: 0 };

  const assignments = rSnap.data()?.assignments as
    | Record<string, Record<string, Record<string, string>>>
    | undefined;
  const dayAssign = assignments?.[dateKey] ?? {};
  const allUids = new Set<string>();
  for (const meal of Object.values(dayAssign)) {
    for (const uid of Object.keys(meal)) allUids.add(uid);
  }

  const uids = [...allUids];
  if (uids.length === 0) return { kitchen: 0, hall: 0 };

  const roleSnaps = await Promise.all(
    uids.map((uid) => adminDb().collection("staff_onboarding").doc(uid).get()),
  );

  let kitchen = 0;
  let hall = 0;
  uids.forEach((uid, i) => {
    const role = roleSnaps[i].exists
      ? ((roleSnaps[i].data()?.role as string) ?? "staff")
      : "staff";
    if (role === "chef" || role === "kitchen") kitchen++;
    else hall++;
  });

  return { kitchen, hall };
}

/** Server-side manager/chef dashboard snapshot — never block HTML on this. */
export async function prefetchManagerDash(
  dateKey = sydneyTodayKey(),
): Promise<ManagerDashServerSnapshot> {
  const db = adminDb();

  const [dailySnap, catering, team] = await Promise.all([
    db.collection("sales_daily").doc(dateKey).get(),
    fetchCateringSummaryServer(dateKey),
    fetchTeamCountsServer(dateKey),
  ]);

  const cache: ManagerDashCache = {
    date: dateKey,
    todaySales: null,
    totalPax: null,
    totalBookings: null,
    nextCatering: catering.nextCatering,
    weekCateringCount: catering.weekCateringCount,
    kitchenStaff: team.kitchen,
    hallStaff: team.hall,
    cachedAt: Date.now(),
  };

  const daily = dailySnap.exists ? dailySnap.data() : null;
  if (typeof daily?.grossSales === "number") {
    cache.todaySales = daily.grossSales;
  }

  return { dateKey, cache };
}
