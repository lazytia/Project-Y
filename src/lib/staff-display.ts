import type { Timestamp } from "firebase/firestore";

export function tsToDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "string") {
    const [y, m, d] = v.split("-").map(Number);
    if (y && m && d) return new Date(y, m - 1, d, 12);
    const parsed = new Date(v);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof v === "object" && v !== null && "toDate" in v) {
    try {
      return (v as Timestamp).toDate();
    } catch {
      return null;
    }
  }
  return null;
}

export function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

export function fmtDateWithDay(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  const main = date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  const dow = date.toLocaleDateString("en-AU", { weekday: "short" });
  return `${main} (${dow})`;
}

export function fmtDateWithDayFromTs(v: unknown): string {
  const d = tsToDate(v);
  if (!d) return "—";
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return fmtDateWithDay(iso);
}

export function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function fullNameOf(raw: Record<string, unknown>): string {
  const fn = typeof raw.fullName === "string" ? raw.fullName.trim() : "";
  if (fn) return fn;
  const f = typeof raw.firstName === "string" ? raw.firstName.trim() : "";
  const l = typeof raw.lastName === "string" ? raw.lastName.trim() : "";
  if (f || l) return [f, l].filter(Boolean).join(" ");
  const email = typeof raw.email === "string" ? raw.email : "";
  const at = email.indexOf("@");
  const user = at === -1 ? email : email.slice(0, at);
  return user ? user.charAt(0).toUpperCase() + user.slice(1) : "Unknown";
}

export function positionLabelOf(raw: Record<string, unknown>): string {
  const custom = String(raw.position ?? "").trim();
  if (custom) return custom;
  const role = String(raw.role ?? "").toLowerCase();
  if (role === "chef") return "Kitchen Staff";
  if (role === "manager") return "Hall Staff";
  return "Staff";
}

export function reasonDisplayOf(raw: Record<string, unknown>): string {
  if (typeof raw.terminationReason === "string" && raw.terminationReason.trim()) {
    return raw.terminationReason.trim();
  }
  const base = typeof raw.reasonForLeaving === "string" ? raw.reasonForLeaving : "";
  const other = typeof raw.reasonForLeavingOther === "string" ? raw.reasonForLeavingOther : "";
  if (!base) return "—";
  if (base === "Other" && other.trim()) return `Other — ${other.trim()}`;
  return base;
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
