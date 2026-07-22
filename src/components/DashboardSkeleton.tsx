import styles from "./DashboardSkeleton.module.css";

export default function DashboardSkeleton() {
  return (
    <div className={styles.page} aria-busy="true" aria-label="Loading dashboard">
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <div className={`${styles.line} ${styles.title}`} />
          <div className={`${styles.line} ${styles.subtitle}`} />
        </div>
        <div className={`${styles.line} ${styles.pill}`} />
      </div>
      <div className={styles.card}>
        <div className={`${styles.line} ${styles.cardLabel}`} />
        <div className={styles.cardRow}>
          <div>
            <div className={`${styles.line} ${styles.cardAmount}`} />
            <div className={`${styles.line} ${styles.cardSub}`} />
          </div>
          <div>
            <div className={`${styles.line} ${styles.cardAmount}`} />
            <div className={`${styles.line} ${styles.cardSub}`} />
          </div>
        </div>
      </div>
      <div className={styles.cardDark}>
        <div className={`${styles.line} ${styles.cardLabel}`} />
        <div className={`${styles.line} ${styles.cardAmount}`} />
        <div className={`${styles.line} ${styles.cardSub}`} />
      </div>
      <div className={styles.splitRow}>
        <div className={styles.card}>
          <div className={`${styles.line} ${styles.cardLabel}`} />
          <div className={`${styles.line} ${styles.cardAmount}`} />
        </div>
        <div className={styles.card}>
          <div className={`${styles.line} ${styles.cardLabel}`} />
          <div className={`${styles.line} ${styles.cardAmount}`} />
        </div>
      </div>
      <div className={styles.card}>
        <div className={`${styles.line} ${styles.cardLabel}`} />
        <div className={`${styles.line} ${styles.cardSub}`} />
        <div className={`${styles.line} ${styles.cardSub}`} />
      </div>
    </div>
  );
}
