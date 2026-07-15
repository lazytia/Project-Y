/**
 * English/Japanese translation dictionary for staff-facing UI. The
 * owner asked for Japanese support on the staff pages (and especially
 * the onboarding flow) because a large chunk of the crew is Japanese.
 * Manager/owner/chef surfaces are intentionally NOT translated — those
 * users are English-only per owner direction.
 *
 * Flat keys keep lookups simple in components. Missing keys fall back
 * to the English string, so callers can render either t("nav.home") or
 * just plain English when a translation isn't wired up yet.
 */

export type Lang = "en" | "ja";
export const LANG_STORAGE_KEY = "y.lang";
export const LANGS: readonly Lang[] = ["en", "ja"];

type Dict = Record<string, string>;

const EN: Dict = {
  // Sidebar / nav
  "nav.home": "Home",
  "nav.onboarding": "Onboarding",
  "nav.schedule": "Schedule",
  "nav.roster": "Roster",
  "nav.requestHoliday": "Request Holiday",
  "nav.availabilityChange": "Availability Change",
  "nav.payslips": "Payslips",
  "nav.myDocuments": "My Documents",
  "nav.settings": "Settings",
  "nav.signOut": "Sign out",

  // Common actions
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.back": "Back",
  "common.continue": "Continue",
  "common.saveAndContinue": "Save & Continue",
  "common.saveAndExit": "Save & Exit",
  "common.next": "Next",
  "common.done": "Done",
  "common.loading": "Loading…",
  "common.language": "Language",
  "common.english": "English",
  "common.japanese": "日本語",

  // Notifications prompt
  "notif.title": "Enable Notifications",
  "notif.subtitle": "Stay up to date with important updates from Project Y.",
  "notif.reason.newRoster": "New roster published",
  "notif.reason.rosterChanges": "Roster changes",
  "notif.reason.shiftReminders": "Shift reminders",
  "notif.reason.announcements": "Important company announcements",
  "notif.trust": "We will only send you relevant updates.",
  "notif.denied": "Notifications are required to continue. Please allow the prompt in your browser or check your device settings, then try again.",
  "notif.enabling": "Enabling…",
  "notif.enableBtn": "Enable Notifications",

  // Settings page
  "settings.title": "Settings",
  "settings.language.title": "Language",
  "settings.language.help": "Choose the language you'd like to see across the app.",

  // Onboarding overview
  "onb.welcome": "Welcome",
  "onb.subGreeting": "Let's get you all set up.",
  "onb.overviewHeader": "ONBOARDING OVERVIEW",
  "onb.startDate": "Start Date",
  "onb.payrollCutoff": "Payroll Cut-off",
  "onb.payrollCutoffHelp": "Submit by this date to be paid in the following week.",
  "onb.completed": "Completed",
  "onb.completedShort": "You're all set!",
  "onb.continueOnboarding": "Continue Onboarding",
  "onb.remaining": "REMAINING ITEMS",
  "onb.pending": "Pending",
  "onb.allDone": "ALL DONE 🎉",
  "onb.allDoneMsg": "You have completed all onboarding steps. Welcome to the team!",
  "onb.stepOf": "of",
  "onb.stepPrefix": "Step",
  "onb.steps.personal": "Personal Information",
  "onb.steps.tfn": "TFN Declaration",
  "onb.steps.bank": "Bank & Super Details",
  "onb.steps.documents": "Documents",
  "onb.steps.policies": "Policies",
  "onb.steps.review": "Review & Sign",
  "onb.steps.complete": "Complete",

  // Onboarding — personal information
  "onb.personal.title": "Personal Information",
  "onb.personal.subtitle": "Tell us a bit about yourself.",
  "onb.personal.fullName": "Full Legal Name",
  "onb.personal.preferredName": "Preferred Name",
  "onb.personal.dob": "Date of Birth",
  "onb.personal.email": "Email",
  "onb.personal.mobile": "Mobile Number",
  "onb.personal.address": "Home Address",
  "onb.personal.suburb": "Suburb",
  "onb.personal.state": "State",
  "onb.personal.postcode": "Postcode",
  "onb.personal.emergency": "Emergency Contact",
  "onb.personal.emergencyName": "Name",
  "onb.personal.emergencyRelation": "Relationship",
  "onb.personal.emergencyPhone": "Phone",

  // Onboarding — TFN
  "onb.tfn.title": "TFN Declaration",
  "onb.tfn.subtitle": "This information is submitted electronically to the ATO.",
  "onb.tfn.personalSection": "Personal Details",
  "onb.tfn.tfnSection": "Tax File Number",
  "onb.tfn.taxSection": "Tax Details",
  "onb.tfn.declarationSection": "Declaration",
  "onb.tfn.dateLabel": "Date",

  // Onboarding — bank & super
  "onb.bank.title": "Bank & Super Details",
  "onb.bank.subtitle": "We use this to pay your wages and superannuation.",
  "onb.bank.bankSection": "Bank Account",
  "onb.bank.bsb": "BSB",
  "onb.bank.accountNumber": "Account Number",
  "onb.bank.accountName": "Account Name",
  "onb.bank.superSection": "Superannuation Fund",
  "onb.bank.superFund": "Super Fund Name",
  "onb.bank.usi": "USI",
  "onb.bank.memberNumber": "Member Number",

  // Onboarding — documents
  "onb.docs.title": "Documents",
  "onb.docs.subtitle": "Please upload clear photos of the required documents.",
  "onb.docs.formTitle": "Upload your documents.",
  "onb.docs.formSubtitle": "All fields marked with * are required.",
  "onb.docs.takePhoto": "Take a photo",
  "onb.docs.chooseFile": "Choose file",
  "onb.docs.addAnother": "Add another",
  "onb.docs.camera": "Camera",
  "onb.docs.gallery": "Gallery",
  "onb.docs.limit": "Maximum of 3 photos reached. Remove one to add another.",
  "onb.docs.passportTitle": "1. Passport / Photo ID *",
  "onb.docs.passportHelp": "We need a clear photo of your passport or either government-issued photo ID.",
  "onb.docs.visaTitle": "2. Visa *",
  "onb.docs.visaHelp": "We need a copy of your current visa.",
  "onb.docs.rsaTitle": "3. RSA Certificate",
  "onb.docs.rsaHelp": "Upload your valid RSA certificate (required for all hall staff).",

  // Onboarding — policies index & pages
  "onb.pol.title": "Policies",
  "onb.pol.subtitle": "Please read and acknowledge each policy below.",
  "onb.pol.handbookCard": "Staff Handbook",
  "onb.pol.agreementCard": "Employment Agreement",
  "onb.pol.privacyCard": "Privacy Policy",
  "onb.pol.notSigned": "Not signed",
  "onb.pol.signed": "Signed",
  "onb.pol.signBtn": "Sign here",
  "onb.pol.resign": "Re-sign",
  "onb.pol.agreeContinue": "AGREE & CONTINUE",
  "onb.pol.signatureIntroHandbook": "Signature — by signing you confirm you have read, understood, and agree to follow the YURICA Staff Handbook.",
  "onb.pol.signatureIntroPrivacy": "Signature — by signing you confirm you have read and understood this Privacy Policy and consent to the collection and use of your personal information.",
  "onb.pol.signatureIntroAgreement": "Signature — by signing you confirm you have read, understood, and agree to be bound by this Employment Agreement.",

  // Onboarding — review & sign / complete
  "onb.review.title": "Review & Sign",
  "onb.review.subtitle": "Please review your details before we send everything off.",
  "onb.review.submit": "Submit & Finish",
  "onb.complete.title": "Onboarding Submitted!",
  "onb.complete.subtitle": "Thank you! Your onboarding has been submitted and is now under review.",
  "onb.complete.reviewNote": "We'll review your information and documents. You will receive a notification once your profile has been approved.",
  "onb.complete.status": "Status",
  "onb.complete.underReview": "Under Review",
  "onb.complete.goHome": "Go to Home",

  // Payslips
  "pay.title": "Payslips",
  "pay.nextPay": "Next Pay Date",
  "pay.frequency": "Paid weekly",
  "pay.latest": "Latest Payslip",
  "pay.previous": "Previous Payslips",
  "pay.payPeriod": "Pay Period",
  "pay.netPay": "Net Pay",
  "pay.paid": "Paid",
  "pay.viewPayslip": "View Payslip",
  "pay.available12Months": "Payslips are available for the last 12 months.",
  "pay.loadingList": "Loading your payslips…",
  "pay.loadError": "Couldn't load payslips.",
  "pay.empty": "No payslips yet — as soon as payroll runs the first pay week for you, it will appear here.",
};

const JA: Dict = {
  // Sidebar / nav
  "nav.home": "ホーム",
  "nav.onboarding": "オンボーディング",
  "nav.schedule": "スケジュール",
  "nav.roster": "シフト表",
  "nav.requestHoliday": "休暇申請",
  "nav.availabilityChange": "勤務可能日変更",
  "nav.payslips": "給与明細",
  "nav.myDocuments": "マイドキュメント",
  "nav.settings": "設定",
  "nav.signOut": "ログアウト",

  // Common actions
  "common.save": "保存",
  "common.cancel": "キャンセル",
  "common.back": "戻る",
  "common.continue": "続ける",
  "common.saveAndContinue": "保存して次へ",
  "common.saveAndExit": "保存して終了",
  "common.next": "次へ",
  "common.done": "完了",
  "common.loading": "読み込み中…",
  "common.language": "言語",
  "common.english": "English",
  "common.japanese": "日本語",

  // Notifications prompt
  "notif.title": "通知をオンにする",
  "notif.subtitle": "Project Y からの大切なお知らせを受け取りましょう。",
  "notif.reason.newRoster": "新しいシフト表の公開",
  "notif.reason.rosterChanges": "シフトの変更",
  "notif.reason.shiftReminders": "シフトのリマインダー",
  "notif.reason.announcements": "会社からの重要なお知らせ",
  "notif.trust": "必要な通知のみお送りします。",
  "notif.denied": "続けるには通知の許可が必要です。ブラウザのプロンプトを許可するか、端末の設定を確認してから、もう一度お試しください。",
  "notif.enabling": "有効化しています…",
  "notif.enableBtn": "通知をオンにする",

  // Settings page
  "settings.title": "設定",
  "settings.language.title": "言語",
  "settings.language.help": "アプリで使用する言語を選択してください。",

  // Onboarding overview
  "onb.welcome": "ようこそ",
  "onb.subGreeting": "セットアップを始めましょう。",
  "onb.overviewHeader": "オンボーディング概要",
  "onb.startDate": "勤務開始日",
  "onb.payrollCutoff": "給与締切日",
  "onb.payrollCutoffHelp": "この日までに提出すると翌週に支給されます。",
  "onb.completed": "完了",
  "onb.completedShort": "すべて完了しました！",
  "onb.continueOnboarding": "オンボーディングを続ける",
  "onb.remaining": "残りのステップ",
  "onb.pending": "未完了",
  "onb.allDone": "すべて完了 🎉",
  "onb.allDoneMsg": "すべてのオンボーディングステップが完了しました。ようこそチームへ！",
  "onb.stepOf": "／",
  "onb.stepPrefix": "ステップ",
  "onb.steps.personal": "個人情報",
  "onb.steps.tfn": "TFN 申告",
  "onb.steps.bank": "銀行・スーパー情報",
  "onb.steps.documents": "書類",
  "onb.steps.policies": "各種ポリシー",
  "onb.steps.review": "確認・署名",
  "onb.steps.complete": "完了",

  // Onboarding — personal information
  "onb.personal.title": "個人情報",
  "onb.personal.subtitle": "あなたのことを少し教えてください。",
  "onb.personal.fullName": "氏名（正式）",
  "onb.personal.preferredName": "呼び名",
  "onb.personal.dob": "生年月日",
  "onb.personal.email": "メールアドレス",
  "onb.personal.mobile": "携帯電話番号",
  "onb.personal.address": "住所",
  "onb.personal.suburb": "サバーブ",
  "onb.personal.state": "州",
  "onb.personal.postcode": "郵便番号",
  "onb.personal.emergency": "緊急連絡先",
  "onb.personal.emergencyName": "氏名",
  "onb.personal.emergencyRelation": "続柄",
  "onb.personal.emergencyPhone": "電話番号",

  // Onboarding — TFN
  "onb.tfn.title": "TFN 申告",
  "onb.tfn.subtitle": "この情報は ATO（オーストラリア国税庁）に電子提出されます。",
  "onb.tfn.personalSection": "個人情報",
  "onb.tfn.tfnSection": "タックスファイルナンバー",
  "onb.tfn.taxSection": "税務情報",
  "onb.tfn.declarationSection": "宣言",
  "onb.tfn.dateLabel": "日付",

  // Onboarding — bank & super
  "onb.bank.title": "銀行・スーパー情報",
  "onb.bank.subtitle": "給与とスーパーアニュエーションのお支払いに使用します。",
  "onb.bank.bankSection": "銀行口座",
  "onb.bank.bsb": "BSB",
  "onb.bank.accountNumber": "口座番号",
  "onb.bank.accountName": "口座名義",
  "onb.bank.superSection": "スーパーアニュエーション",
  "onb.bank.superFund": "スーパーファンド名",
  "onb.bank.usi": "USI",
  "onb.bank.memberNumber": "会員番号",

  // Onboarding — documents
  "onb.docs.title": "書類",
  "onb.docs.subtitle": "必要書類の鮮明な写真をアップロードしてください。",
  "onb.docs.formTitle": "書類をアップロードしてください。",
  "onb.docs.formSubtitle": "* が付いている項目は必須です。",
  "onb.docs.takePhoto": "写真を撮る",
  "onb.docs.chooseFile": "ファイルを選択",
  "onb.docs.addAnother": "追加する",
  "onb.docs.camera": "カメラ",
  "onb.docs.gallery": "ギャラリー",
  "onb.docs.limit": "最大3枚までアップロードできます。追加するには1枚削除してください。",
  "onb.docs.passportTitle": "1. パスポート / 写真付き身分証 *",
  "onb.docs.passportHelp": "パスポートまたは政府発行の写真付き身分証の鮮明な写真が必要です。",
  "onb.docs.visaTitle": "2. ビザ *",
  "onb.docs.visaHelp": "現在有効なビザのコピーを提出してください。",
  "onb.docs.rsaTitle": "3. RSA 資格証",
  "onb.docs.rsaHelp": "有効な RSA 資格証をアップロードしてください（ホールスタッフは必須）。",

  // Onboarding — policies index & pages
  "onb.pol.title": "各種ポリシー",
  "onb.pol.subtitle": "以下の各ポリシーを読んで同意してください。",
  "onb.pol.handbookCard": "スタッフハンドブック",
  "onb.pol.agreementCard": "雇用契約書",
  "onb.pol.privacyCard": "プライバシーポリシー",
  "onb.pol.notSigned": "未署名",
  "onb.pol.signed": "署名済み",
  "onb.pol.signBtn": "ここに署名",
  "onb.pol.resign": "署名し直す",
  "onb.pol.agreeContinue": "同意して次へ",
  "onb.pol.signatureIntroHandbook": "署名 — 署名することで、YURICA スタッフハンドブックを読み、理解し、遵守することに同意したものとみなされます。",
  "onb.pol.signatureIntroPrivacy": "署名 — 署名することで、本プライバシーポリシーを読み理解した上で、個人情報の収集・利用に同意したものとみなされます。",
  "onb.pol.signatureIntroAgreement": "署名 — 署名することで、本雇用契約書を読み、理解し、その条件に拘束されることに同意したものとみなされます。",

  // Onboarding — review & sign / complete
  "onb.review.title": "確認・署名",
  "onb.review.subtitle": "送信前にご自身の情報を確認してください。",
  "onb.review.submit": "送信して完了",
  "onb.complete.title": "オンボーディングを送信しました！",
  "onb.complete.subtitle": "ありがとうございます。オンボーディング内容が送信され、現在確認中です。",
  "onb.complete.reviewNote": "情報と書類を確認します。プロフィールが承認され次第、通知が届きます。",
  "onb.complete.status": "ステータス",
  "onb.complete.underReview": "確認中",
  "onb.complete.goHome": "ホームへ",

  // Payslips
  "pay.title": "給与明細",
  "pay.nextPay": "次回支給日",
  "pay.frequency": "毎週支給",
  "pay.latest": "最新の給与明細",
  "pay.previous": "過去の給与明細",
  "pay.payPeriod": "支給対象期間",
  "pay.netPay": "手取り額",
  "pay.paid": "支給日",
  "pay.viewPayslip": "明細を見る",
  "pay.available12Months": "過去12ヶ月分の給与明細を確認できます。",
  "pay.loadingList": "給与明細を読み込んでいます…",
  "pay.loadError": "給与明細を読み込めませんでした。",
  "pay.empty": "まだ給与明細はありません。最初の支給が処理されるとここに表示されます。",
};

export const TRANSLATIONS: Record<Lang, Dict> = { en: EN, ja: JA };

export function translate(lang: Lang, key: string, fallback?: string): string {
  return TRANSLATIONS[lang][key] ?? TRANSLATIONS.en[key] ?? fallback ?? key;
}
