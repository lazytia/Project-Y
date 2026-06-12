import styles from "./Splash.module.css";

type Props = {
  /** Optional sub-text under the wordmark. Defaults to nothing. */
  label?: string;
};

export default function Splash({ label }: Props) {
  return (
    <div className={styles.splash} role="status" aria-live="polite">
      <div className={styles.logo} aria-hidden="true">
        <span className={styles.mark}>Y</span>
      </div>
      <div className={styles.wordmark}>Project Y</div>
      <div className={styles.dots} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      {label && <div className={styles.label}>{label}</div>}
    </div>
  );
}
