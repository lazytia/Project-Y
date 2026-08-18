"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useLang } from "@/components/LanguageProvider";
import SignaturePad from "@/components/SignaturePad";
import {
  fetchDocumentSignatures,
  saveDocumentSignature,
  type DocumentSignature,
  type SignableDocumentKey,
} from "@/lib/document-signatures";
import styles from "./DocumentAcknowledgement.module.css";

type Props = {
  documentKey: SignableDocumentKey;
  /** Version recorded alongside the signature, e.g. "1.0". */
  version: string;
  /** Human label for when the document itself last changed, e.g. "June 2026". */
  updated: string;
  /** Translation key for the sentence the signer is agreeing to. */
  bodyKey: string;
};

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

export default function DocumentAcknowledgement({ documentKey, version, updated, bodyKey }: Props) {
  const { user } = useAuth();
  const { t } = useLang();
  const [signed, setSigned] = useState<DocumentSignature | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [padOpen, setPadOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const all = await fetchDocumentSignatures(user.uid);
        if (!cancelled) setSigned(all[documentKey] ?? null);
      } catch {
        // Leave the block in its unsigned state; signing again is harmless.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, documentKey]);

  const submit = useCallback(async () => {
    if (!user || !draft || saving) return;
    setSaving(true);
    setError(null);
    try {
      await saveDocumentSignature(user.uid, documentKey, { signature: draft, version });
      setSigned({ signature: draft, version, signedAt: new Date() });
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [user, draft, saving, documentKey, version]);

  const preview = signed?.signature ?? draft;

  return (
    <section className={styles.ack}>
      <h2 className={styles.title}>{t("doc.ack.title")}</h2>
      <p className={styles.body}>{t(bodyKey)}</p>

      <div className={styles.card}>
        <div className={styles.statusRow}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <span className={styles.statusLabel}>{t("doc.ack.status")}</span>
          <span className={signed ? styles.statusSigned : styles.statusUnsigned}>
            {signed ? t("doc.ack.signed") : t("doc.ack.notSigned")}
          </span>
        </div>

        {preview ? (
          <div className={styles.signatureBox}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt={t("doc.ack.title")} className={styles.signatureImg} />
          </div>
        ) : (
          <button type="button" className={styles.signBox} onClick={() => setPadOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
            </svg>
            <span>{t("doc.ack.tapToSign")}</span>
          </button>
        )}
      </div>

      {!signed && (
        <>
          <button
            type="button"
            className={styles.ackBtn}
            onClick={draft ? submit : () => setPadOpen(true)}
            disabled={saving}
          >
            {saving ? t("doc.ack.saving") : t("doc.ack.button")}
          </button>
          {!draft && <p className={styles.hint}>{t("doc.ack.hint")}</p>}
        </>
      )}
      {error && <p className={styles.error}>{t("doc.ack.saveError")} {error}</p>}

      <div className={styles.metaRow}>
        <div className={styles.metaItem}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <span>{t("doc.ack.version")} {version}</span>
        </div>
        <div className={styles.metaItem}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span>{t("doc.ack.updated")} {updated}</span>
        </div>
        <div className={styles.metaItem}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <span>{t("doc.ack.signedOn")} {fmtDate(signed?.signedAt ?? null)}</span>
        </div>
      </div>

      {padOpen && (
        <SignaturePad
          onConfirm={(dataUrl) => {
            setDraft(dataUrl);
            setPadOpen(false);
          }}
          onClose={() => setPadOpen(false)}
        />
      )}
    </section>
  );
}
