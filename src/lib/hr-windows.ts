/**
 * How far ahead HR surfaces upcoming staff dates.
 *
 * These were duplicated per page and had drifted apart (Active Employees
 * warned at 30 days while Attention Required used 60), so a visa could be
 * flagged on one screen and silent on another. Single source of truth.
 */

/** Visa expiry lead time — long enough to start a renewal conversation. */
export const VISA_WINDOW_DAYS = 60;

/** Birthday lead time — two weeks, enough notice to organise something. */
export const BIRTHDAY_WINDOW_DAYS = 14;

/** Grace period after a visa expiry date before it stops being surfaced. */
export const VISA_EXPIRED_GRACE_DAYS = 3;
