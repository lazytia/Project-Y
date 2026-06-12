import styles from "./PageShell.module.css";

type Props = {
  title: string;
  description?: string;
  children?: React.ReactNode;
};

export default function PageShell({ title, description, children }: Props) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{title}</h1>
        {description && <p className={styles.description}>{description}</p>}
      </header>
      <section className={styles.body}>
        {children ?? (
          <div className={styles.placeholder}>
            <span>This page is intentionally blank.</span>
          </div>
        )}
      </section>
    </div>
  );
}
