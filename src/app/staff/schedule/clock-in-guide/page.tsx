"use client";

/**
 * Clock In / Out Guide — how to use the POS time clock.
 *
 * Four steps, each paired with a drawing of the screen it is talking about.
 * The drawings are markup rather than screenshots on purpose: a screenshot of
 * the POS goes stale the first time Square reskins a button, and at phone
 * width it has to be pinched to read. These stay legible and stay honest
 * about being a sketch.
 *
 * The panels say "Clocked in" with no role on it, though the real POS prints
 * one. Whose name appears there depends on who is standing at the machine,
 * and a guide that shows somebody else's role reads as an instruction to use
 * somebody else's login.
 */

import { useBackToDashboard } from "@/hooks/useBackToDashboard";
import styles from "./page.module.css";

/* ── the sketches ── */

function LoginPanel() {
  return (
    <div className={styles.panel}>
      <p className={styles.panelCaption}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
        Log in
      </p>
      <p className={styles.panelBtnDark}>View time clock</p>
    </div>
  );
}

function PasscodePanel() {
  return (
    <div className={styles.panel}>
      <p className={styles.panelCaption}>Enter passcode</p>
      <p className={styles.dots} aria-hidden="true">
        <span /><span /><span /><span />
      </p>
      <div className={styles.keypad} aria-hidden="true">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => (
          <span key={n} className={styles.key}>{n}</span>
        ))}
        <span className={styles.keyBlank} />
        <span className={styles.key}>0</span>
        <span className={styles.key}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 4H8l-7 8 7 8h13a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1z" />
            <line x1="18" y1="9" x2="12" y2="15" />
            <line x1="12" y1="9" x2="18" y2="15" />
          </svg>
        </span>
      </div>
    </div>
  );
}

function ClockedInPanel() {
  return (
    <div className={styles.panel}>
      <p className={styles.panelTime}>6:42pm</p>
      <span className={styles.tick} aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
      <p className={styles.panelCaption}>Clocked in</p>
      <p className={styles.panelUnderline}>Add notes</p>
    </div>
  );
}

function ClockOutPanel() {
  return (
    <div className={styles.panel}>
      <p className={styles.panelTime}>7:21pm</p>
      <p className={styles.panelCaption}>
        <span className={styles.liveDot} aria-hidden="true" />
        Clocked in
      </p>
      <p className={styles.panelNote}>39 mins worked so far today</p>
      <p className={styles.panelUnderline}>Add notes</p>
      <p className={styles.panelBtnDark}>Clock out</p>
    </div>
  );
}

const STEPS = [
  {
    panel: <LoginPanel />,
    title: "Tap View Time Clock",
    body: "On the POS login screen, tap View time clock.",
  },
  {
    panel: <PasscodePanel />,
    title: "Enter your Clock In ID",
    body: "Type your 4-digit Clock In ID to continue.",
  },
  {
    panel: <ClockedInPanel />,
    title: "Check you are clocked in",
    body: "You'll see a confirmation that you're clocked in. If you missed the time, tap Add notes.",
  },
  {
    panel: <ClockOutPanel />,
    title: "To finish, repeat and tap Clock out",
    body: "Use Add notes if needed.",
  },
];

const REMINDERS = [
  "Clock in when you start work.",
  "Always clock out before break time / lunch.",
];

/* ── page ── */

export default function ClockInGuidePage() {
  const goBack = useBackToDashboard();

  return (
    <div className={styles.page}>
      <button
        type="button"
        className={styles.backBtn}
        onClick={goBack}
        aria-label="Back"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      <header className={styles.titleWrap}>
        <h1 className={styles.pageTitle}>Clock In / Out Guide</h1>
        <p className={styles.pageSub}>How to use the POS time clock</p>
        <span className={styles.rule} aria-hidden="true" />
      </header>

      <ol className={styles.steps}>
        {STEPS.map((step, i) => (
          <li key={step.title} className={styles.step}>
            <span className={styles.stepNo} aria-hidden="true">{i + 1}</span>
            {step.panel}
            <div className={styles.stepBody}>
              <p className={styles.stepTitle}>{step.title}</p>
              <p className={styles.stepText}>{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <section className={styles.remember}>
        <span className={styles.rememberIcon} aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="8" y1="13" x2="16" y2="13" />
            <line x1="8" y1="17" x2="13" y2="17" />
          </svg>
        </span>
        <div className={styles.rememberBody}>
          <p className={styles.rememberTitle}>Please remember</p>
          <ol className={styles.rememberList}>
            {REMINDERS.map((line, i) => (
              <li key={line} className={styles.rememberItem}>
                <span className={styles.rememberNo} aria-hidden="true">{i + 1}</span>
                <span>{line}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}
