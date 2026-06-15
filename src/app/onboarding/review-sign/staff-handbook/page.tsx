"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import styles from "./page.module.css";

const HANDBOOK_VERSION = "1.0";
const HANDBOOK_UPDATED = "June 2026";

export default function StaffHandbookPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [readChecked, setReadChecked] = useState(false);
  const [agreeChecked, setAgreeChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = readChecked && agreeChecked && !submitting;

  async function handleAgree() {
    if (!user || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await setDoc(
        doc(getDb(), "staff_onboarding", user.uid),
        {
          reviewSign: {
            handbookSignedAt: serverTimestamp(),
            handbookVersion: HANDBOOK_VERSION,
            handbookReadAcknowledged: true,
            handbookPoliciesAgreed: true,
          },
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      router.push("/onboarding/review-sign");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.brand}>YURICA</header>

      <article className={styles.doc}>
        {/* Cover */}
        <section className={styles.coverSection}>
          <h1 className={styles.coverTitle}>
            YURICA<br />
            <span className={styles.coverTitleSub}>STAFF HANDBOOK</span>
          </h1>
          <div className={styles.coverDivider} />
          <p className={styles.coverWelcome}>Welcome to YURICA</p>
          <p className={styles.coverParagraph}>Thank you for joining our team.</p>
          <p className={styles.coverParagraph}>
            At YURICA, we believe great hospitality comes from professionalism,
            respect, teamwork, and attention to detail. Every team member plays
            an important role in creating the experience our guests remember.
          </p>
          <div className={styles.coverQuote}>
            <span className={styles.quoteMark}>&ldquo;</span>
            <p>Every plate matters.</p>
            <p>Every guest matters.</p>
            <p>Every detail matters.</p>
            <span className={styles.quoteMarkClose}>&rdquo;</span>
          </div>
        </section>

        {/* 1. Our Values */}
        <section className={styles.section}>
          <h2 className={styles.sectionH}>1. OUR VALUES</h2>
          <ul className={styles.valueList}>
            <li>
              <p className={styles.valueLabel}>RESPECT</p>
              <p className={styles.valueDesc}>
                Treat guests, colleagues, and management with respect.
              </p>
            </li>
            <li>
              <p className={styles.valueLabel}>TEAMWORK</p>
              <p className={styles.valueDesc}>
                Support one another and work together.
              </p>
            </li>
            <li>
              <p className={styles.valueLabel}>PROFESSIONALISM</p>
              <p className={styles.valueDesc}>
                Be punctual, reliable, and presentable.
              </p>
            </li>
            <li>
              <p className={styles.valueLabel}>ATTENTION TO DETAIL</p>
              <p className={styles.valueDesc}>
                Small details create exceptional guest experiences.
              </p>
            </li>
          </ul>
        </section>

        {/* 2. Attendance */}
        <section className={styles.section}>
          <h2 className={styles.sectionH}>2. ATTENDANCE &amp; SHIFT RESPONSIBILITIES</h2>
          <ul className={styles.bulletList}>
            <li>Arrive ready to work at your scheduled start time.</li>
            <li>If you are running late, notify your manager as soon as possible.</li>
            <li>Unapproved absences are not acceptable.</li>
          </ul>
          <p className={styles.subH}>Opening Shifts</p>
          <p className={styles.paragraph}>
            If you are rostered for an opening shift, all setup and preparation
            tasks must be completed before service begins.
          </p>
          <p className={styles.paragraph}>
            Employees are expected to remain on-site during working hours unless
            taking an authorised break or receiving manager approval.
          </p>
        </section>

        {/* 3. Rosters */}
        <section className={styles.section}>
          <h2 className={styles.sectionH}>3. ROSTERS, AVAILABILITY &amp; HOLIDAYS</h2>
          <p className={styles.paragraph}>
            Project Y is YURICA&apos;s official staff communication and scheduling
            platform.
          </p>
          <p className={styles.paragraph}>
            Employees are responsible for checking Project Y regularly.
          </p>
          <p className={styles.paragraph}>
            Any request to change availability or request holiday leave must be
            submitted through Project Y at least{" "}
            <strong>3 weeks in advance</strong> whenever possible.
          </p>
          <p className={styles.paragraph}>
            Submitting a request does not mean it has been approved.
          </p>
          <p className={styles.paragraph}>
            All requests require management approval through Project Y.
          </p>
          <p className={styles.paragraph}>
            Employees must continue to work their scheduled shifts unless
            approval has been provided through Project Y.
          </p>
        </section>

        {/* 4. Appearance & Uniform */}
        <section className={styles.section}>
          <h2 className={styles.sectionH}>4. APPEARANCE &amp; UNIFORM</h2>
          <p className={styles.paragraph}>
            Employees are expected to maintain a clean, neat, and professional
            appearance at all times.
          </p>
          <p className={styles.subH}>HALL STAFF</p>
          <ul className={styles.bulletList}>
            <li>Wear a clean white top.</li>
            <li>Wear the YURICA apron and cap provided.</li>
            <li>Wear closed non-slip shoes.</li>
          </ul>
          <p className={styles.subH}>KITCHEN STAFF</p>
          <ul className={styles.bulletList}>
            <li>Wear the designated chef uniform or YURICA uniform.</li>
            <li>Wear the required cap or kitchen headwear.</li>
            <li>Wear closed non-slip shoes.</li>
          </ul>
          <p className={styles.subH}>Company Uniform Property</p>
          <p className={styles.paragraph}>
            All uniforms, aprons, caps, name tags, and other items supplied by
            YURICA remain company property.
          </p>
          <p className={styles.paragraph}>
            Upon termination of employment, all company-issued items must be
            returned.
          </p>
          <p className={styles.paragraph}>
            Failure to return company property may result in the cost of
            replacement being recovered where permitted by law.
          </p>
        </section>

        {/* 5. Guest Service */}
        <section className={styles.section}>
          <h2 className={styles.sectionH}>5. GUEST SERVICE STANDARDS</h2>
          <p className={styles.subH}>Always</p>
          <ul className={styles.bulletList}>
            <li>Greet guests politely.</li>
            <li>Listen carefully.</li>
            <li>Remain positive and professional.</li>
            <li>Thank guests when they leave.</li>
          </ul>
          <p className={styles.subH}>Never</p>
          <ul className={styles.bulletList}>
            <li>Argue with guests.</li>
            <li>Use inappropriate language.</li>
            <li>Discuss personal issues during service.</li>
            <li>Use mobile phones while serving guests.</li>
          </ul>
          <p className={styles.paragraph}>
            <strong>If you need assistance, speak with a manager.</strong>
          </p>
        </section>

        {/* 6. Food Safety */}
        <section className={styles.section}>
          <h2 className={styles.sectionH}>6. FOOD SAFETY &amp; HYGIENE</h2>
          <p className={styles.paragraph}>All staff are expected to:</p>
          <ul className={styles.bulletList}>
            <li>Wash hands regularly.</li>
            <li>Follow food handling procedures.</li>
            <li>Keep work areas clean and organised.</li>
            <li>Report food safety concerns immediately.</li>
            <li>Follow all workplace food safety requirements.</li>
          </ul>
        </section>

        {/* 7. Phone */}
        <section className={styles.section}>
          <h2 className={styles.sectionH}>7. MOBILE PHONE &amp; EARPHONE POLICY</h2>
          <p className={styles.paragraph}>
            Personal mobile phone use should be kept to a minimum during working
            hours.
          </p>
          <p className={styles.paragraph}>
            Phones may only be used during breaks, for approved work purposes,
            or in emergencies.
          </p>
          <p className={styles.paragraph}>
            Personal earphones, AirPods, headphones, or similar devices must not
            be worn during working hours.
          </p>
        </section>

        {/* 8. Conduct */}
        <section className={styles.section}>
          <h2 className={styles.sectionH}>8. WORKPLACE CONDUCT</h2>
          <p className={styles.paragraph}>Employees are expected to:</p>
          <ul className={styles.bulletList}>
            <li>Work together as a team.</li>
            <li>Support fellow team members.</li>
            <li>Remain focused on their duties.</li>
            <li>Represent YURICA professionally.</li>
            <li>Not smoke or vape during working hours.</li>
          </ul>
          <p className={styles.paragraph}>
            The following behaviour will not be tolerated:
          </p>
          <ul className={styles.bulletList}>
            <li>Bullying</li>
            <li>Harassment</li>
            <li>Discrimination</li>
            <li>Aggressive behaviour</li>
            <li>Theft</li>
            <li>Dishonesty</li>
            <li>Working under the influence of alcohol or illegal drugs</li>
          </ul>
          <p className={styles.paragraph}>
            Serious misconduct may result in disciplinary action, including
            termination of employment.
          </p>
        </section>

        {/* 9. Confidentiality */}
        <section className={styles.section}>
          <h2 className={styles.sectionH}>9. CONFIDENTIALITY</h2>
          <p className={styles.paragraph}>
            Information relating to YURICA&apos;s customers, systems, suppliers,
            recipes, pricing, and business operations is confidential.
          </p>
          <p className={styles.paragraph}>
            Employees must not share confidential information during or after
            their employment.
          </p>
        </section>

        {/* 10. Service Philosophy */}
        <section className={styles.section}>
          <h2 className={styles.sectionH}>10. SERVICE PHILOSOPHY</h2>
          <p className={styles.paragraph}>
            At YURICA, we do not simply serve food. We create an experience.
          </p>
          <p className={styles.paragraph}>
            The cleanliness of the restaurant, the presentation of every plate,
            the speed of service, and the way we speak to guests all matter.
          </p>
          <p className={styles.paragraph}>Take pride in the small details.</p>
          <p className={styles.paragraph}>
            Exceptional hospitality is built one detail at a time.
          </p>
        </section>

        {/* Final Message */}
        <section className={styles.section}>
          <h2 className={styles.sectionH}>FINAL MESSAGE</h2>
          <p className={styles.paragraph}>
            At YURICA, we are proud of the standards we maintain and the culture
            we build together.
          </p>
          <p className={styles.paragraph}>We ask every team member to:</p>
          <p className={styles.paragraphStrong}>Be respectful.</p>
          <p className={styles.paragraphStrong}>Be reliable.</p>
          <p className={styles.paragraphStrong}>Take pride in your work.</p>
          <p className={styles.paragraphStrong}>Support your team.</p>
          <p className={styles.paragraph}>
            Thank you for being part of YURICA. We look forward to growing
            together and creating exceptional experiences for our guests.
          </p>
        </section>

        {/* Acknowledgement */}
        <section className={styles.section}>
          <h2 className={styles.ackTitle}>EMPLOYEE ACKNOWLEDGEMENT</h2>
          <div className={styles.ackUnderline} />
          <p className={styles.ackBody}>
            Please acknowledge that you have read, understood, and agree to
            follow the policies and expectations outlined in the YURICA Staff
            Handbook.
          </p>

          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={readChecked}
              onChange={(e) => setReadChecked(e.target.checked)}
            />
            <span className={styles.checkboxLabel}>
              I have read and understood the YURICA Staff Handbook.
            </span>
          </label>

          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={agreeChecked}
              onChange={(e) => setAgreeChecked(e.target.checked)}
            />
            <span className={styles.checkboxLabel}>
              I agree to follow the policies, standards and expectations
              outlined above.
            </span>
          </label>

          <div className={styles.metaRow}>
            <div className={styles.metaItem}>
              <span>Version</span>
              <span>{HANDBOOK_VERSION}</span>
            </div>
            <div className={styles.metaItem}>
              <span>Last Updated</span>
              <span>{HANDBOOK_UPDATED}</span>
            </div>
          </div>

          {error && <p className={styles.error}>{error}</p>}

          <button
            type="button"
            className={styles.primaryBtn}
            onClick={handleAgree}
            disabled={!canSubmit}
          >
            {submitting ? "…" : "AGREE & CONTINUE"}
          </button>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => router.push("/onboarding/review-sign")}
          >
            BACK
          </button>
        </section>
      </article>
    </div>
  );
}
