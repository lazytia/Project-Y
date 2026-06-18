/**
 * Shared types + storage helpers for the Trial Shift two-step form.
 * Lives outside page.tsx because Next 15 only allows a fixed set of
 * named exports from a route file.
 */

export const ID_TYPES = ["Driver Licence", "Passport", "Photo Card", "Other"] as const;
export const POSITIONS = ["Hall Staff", "Kitchen Staff", "Other"] as const;

export type IdType = typeof ID_TYPES[number];
export type Position = typeof POSITIONS[number];
export type Outcome = "not-hired" | "future-consideration" | "hired";

export const TRIAL_DRAFT_KEY = "trialShiftDraft.v1";

export type TrialShiftDraft = {
  fullName: string;
  mobile: string;
  email: string;
  idType: IdType;
  idPhotoDataUrl: string;
  date: string;
  startTime: string;
  finishTime: string;
  position: Position;
  ratePerHour: string;
  hoursWorked: number;
  totalAmount: number;
  outcome: Outcome;
};
