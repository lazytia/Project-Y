"use client";

/**
 * The employment agreement, to read. It is agreed to once, inside the
 * onboarding form; this is the published copy HR Records links to.
 */

import PolicyDocumentPage from "@/components/PolicyDocumentPage";
import EmploymentAgreementDocument from "@/components/EmploymentAgreementDocument";
// The agreement is set in the handbook's stylesheet, so it wants the
// handbook's sheet under it — see the privacy policy next door.
import policyStyles from "@/app/onboarding/policies/staff-handbook/page.module.css";

export default function EmploymentContractReadPage() {
  return (
    <PolicyDocumentPage docKey="employmentContract">
      <div className={policyStyles.page}>
        <EmploymentAgreementDocument />
      </div>
    </PolicyDocumentPage>
  );
}
