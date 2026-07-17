"use client";

/**
 * People → Payslips (owner + manager view). Shows the SIGNED-IN user's
 * OWN payslip only — managers cannot look up other staff's pay per
 * owner direction. This is the same UI as /staff/payslips; we re-export
 * the staff page here so the nav link under People has a valid
 * destination without duplicating the view.
 */
export { default } from "@/app/staff/payslips/page";
