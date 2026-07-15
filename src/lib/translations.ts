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
  "notif.trust": "We will only send you relevant updates. You can change this anytime in settings.",
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
  "onb.nextStep": "Your Next Step",
  "onb.continueOnboarding": "Continue Onboarding",
  "onb.completed": "You're all set!",
  "onb.remaining": "Remaining Steps",
  "onb.stepOf": "of",
  "onb.steps.personal": "Personal Information",
  "onb.steps.tfn": "TFN Declaration",
  "onb.steps.bank": "Bank & Super Details",
  "onb.steps.documents": "Documents",
  "onb.steps.policies": "Policies",
  "onb.steps.review": "Review & Sign",
  "onb.steps.complete": "Complete",

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
  "notif.trust": "必要な通知のみお送りします。設定からいつでも変更できます。",
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
  "onb.nextStep": "次のステップ",
  "onb.continueOnboarding": "オンボーディングを続ける",
  "onb.completed": "すべて完了しました！",
  "onb.remaining": "残りのステップ",
  "onb.stepOf": "／",
  "onb.steps.personal": "個人情報",
  "onb.steps.tfn": "TFN 申告",
  "onb.steps.bank": "銀行・スーパー情報",
  "onb.steps.documents": "書類",
  "onb.steps.policies": "各種ポリシー",
  "onb.steps.review": "確認・署名",
  "onb.steps.complete": "完了",

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
