"use client";

/**
 * The privacy policy, to read. Signing it happens once, inside the onboarding
 * form; this is the published copy HR Records links to.
 */

import PolicyDocumentPage from "@/components/PolicyDocumentPage";
import PrivacyPolicyDocument from "@/components/PrivacyPolicyDocument";
// The document's own page frame — white sheet, document type colour. Same
// wrapper /staff/handbook puts around the handbook body, and for the same
// reason: the body styles itself, the sheet it sits on does not come with it.
import policyStyles from "@/app/onboarding/policies/privacy-policy/page.module.css";

export default function PrivacyPolicyReadPage() {
  return (
    <PolicyDocumentPage docKey="privacyPolicy">
      <div className={policyStyles.page}>
        <PrivacyPolicyDocument />
      </div>
    </PolicyDocumentPage>
  );
}
