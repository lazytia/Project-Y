/**
 * The icon that stands for each step of the onboarding form.
 *
 * The employee works through these steps on their own onboarding page, and
 * the owner reviews the same five sections on the employee's detail page.
 * Two screens showing the same step under two different pictures is a small
 * way to make them look like two different things, so the picture is kept
 * here and read by both rather than typed out on each side.
 *
 * Keyed by step number because that is what both screens already carry: the
 * employee page numbers its steps for the progress ring, and the owner's
 * section table numbers them so Reject knows which screen to send the
 * employee back to.
 */

/** Steps 1–5 are the sections the owner reviews; 6 and 7 close out the form. */
export type OnboardingStepNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const ONBOARDING_STEP_ICONS: Record<OnboardingStepNumber, string> = {
  1: "👤", // Personal Information
  2: "📄", // TFN Declaration
  3: "🏦", // Bank & Super Details
  4: "🪪", // Documents (Photo ID, Visa, RSA)
  5: "📖", // Policies (Staff Handbook, Privacy Policy, Employee Agreement)
  6: "✍️", // Review & Sign
  7: "🎉", // Complete
};
