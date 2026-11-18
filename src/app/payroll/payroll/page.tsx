"use client";

import { useAuth } from "@/components/AuthProvider";
import { isOwner } from "@/lib/permissions";
import OwnerPayroll from "./OwnerPayroll";
import ChefPayrollCost from "./ChefPayrollCost";

/**
 * Payroll Cost. Owners see the full overview — totals, the summary tiles, the
 * week-on-week comparison and who was paid most. The head chef sees only the
 * week's cost against sales and the target: what he manages, without what
 * each person earns. Each view keeps its own access check.
 */
export default function PayrollCostPage() {
  const { user } = useAuth();
  return isOwner(user) ? <OwnerPayroll /> : <ChefPayrollCost />;
}
