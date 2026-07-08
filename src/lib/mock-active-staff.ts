/**
 * Placeholder roster used by /people/active and its detail page while real
 * staff_onboarding docs aren't seeded. Both surfaces read from the same
 * function so the list rows and the details screen stay in sync.
 *
 * Dates are computed relative to today at read time so the visa / birthday
 * countdowns animate as time passes.
 */

export type MockActiveStaff = {
  uid: string;
  name: string;
  positionKind: "hall" | "kitchen" | "other";
  positionLabel: string;
  rate: number | null;
  visaExpiry: Date | null;
  visaType: string;
  dob: Date | null;
  startDate: Date;
  phone: string;
  documents: {
    tfn: string;
    bank: { bsb: string; accountNumber: string; superFund: string; memberNumber: string };
    contract: { signedOn: Date; version: string };
    handbook: { acknowledgedOn: Date };
    hrNotes: { date: Date; author: string; note: string }[];
    uploaded: { label: string; uploadedOn: Date; sizeKb: number }[];
  };
};

export type MockNotice = {
  id: string;
  employeeUid: string;
  employeeName: string;
  lastWorkingDay: string;
};

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysFromToday(n: number): Date {
  const d = startOfToday();
  d.setDate(d.getDate() + n);
  return d;
}

// Anchored to 1998 so the DOB feels plausible; only month/day matter for
// the birthday-in-N-days chip.
function birthdayInDays(n: number): Date {
  const d = daysFromToday(n);
  d.setFullYear(1998);
  return d;
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function getMockActiveStaff(): MockActiveStaff[] {
  return [
    {
      uid: "m1",
      name: "Hiyori Nozawa",
      positionKind: "hall",
      positionLabel: "Hall",
      rate: 30,
      visaExpiry: daysFromToday(18),
      visaType: "Working Holiday",
      dob: birthdayInDays(120),
      startDate: daysFromToday(-380),
      phone: "0404 123 456",
      documents: {
        tfn: "123 456 789",
        bank: { bsb: "062-000", accountNumber: "1234 5678", superFund: "AustralianSuper", memberNumber: "AS-9982114" },
        contract: { signedOn: daysFromToday(-378), version: "Hall Staff v3" },
        handbook: { acknowledgedOn: daysFromToday(-378) },
        hrNotes: [
          { date: daysFromToday(-60), author: "Yurina", note: "Excellent guest service on Friday dinner — front of house team lead mentioned in the weekly report." },
        ],
        uploaded: [
          { label: "Passport photo page.pdf", uploadedOn: daysFromToday(-378), sizeKb: 420 },
          { label: "Visa grant notice.pdf", uploadedOn: daysFromToday(-378), sizeKb: 220 },
          { label: "RSA certificate.pdf", uploadedOn: daysFromToday(-300), sizeKb: 180 },
        ],
      },
    },
    {
      uid: "m2",
      name: "Lucy Chen",
      positionKind: "hall",
      positionLabel: "Hall",
      rate: 28,
      visaExpiry: daysFromToday(12),
      visaType: "Student (subclass 500)",
      dob: birthdayInDays(200),
      startDate: daysFromToday(-260),
      phone: "0431 887 002",
      documents: {
        tfn: "987 654 321",
        bank: { bsb: "084-004", accountNumber: "8877 2211", superFund: "Hostplus", memberNumber: "HP-4487721" },
        contract: { signedOn: daysFromToday(-258), version: "Hall Staff v3" },
        handbook: { acknowledgedOn: daysFromToday(-258) },
        hrNotes: [],
        uploaded: [
          { label: "Passport photo page.pdf", uploadedOn: daysFromToday(-258), sizeKb: 380 },
          { label: "Visa grant notice.pdf", uploadedOn: daysFromToday(-258), sizeKb: 260 },
        ],
      },
    },
    {
      uid: "m3",
      name: "Suti Kawano",
      positionKind: "kitchen",
      positionLabel: "Kitchen",
      rate: 33,
      visaExpiry: daysFromToday(92),
      visaType: "Working Holiday",
      dob: birthdayInDays(9),
      startDate: daysFromToday(-540),
      phone: "0402 554 118",
      documents: {
        tfn: "441 208 776",
        bank: { bsb: "062-183", accountNumber: "4409 8821", superFund: "AustralianSuper", memberNumber: "AS-7791024" },
        contract: { signedOn: daysFromToday(-538), version: "Kitchen Staff v2" },
        handbook: { acknowledgedOn: daysFromToday(-538) },
        hrNotes: [
          { date: daysFromToday(-120), author: "Head Chef", note: "Promoted to lead prep shift on Tuesday and Thursday." },
        ],
        uploaded: [
          { label: "Passport photo page.pdf", uploadedOn: daysFromToday(-538), sizeKb: 410 },
          { label: "Food handler certificate.pdf", uploadedOn: daysFromToday(-500), sizeKb: 300 },
        ],
      },
    },
    {
      uid: "m4",
      name: "James Min",
      positionKind: "kitchen",
      positionLabel: "Kitchen",
      rate: 32,
      visaExpiry: daysFromToday(320),
      visaType: "Permanent Resident",
      dob: birthdayInDays(5),
      startDate: daysFromToday(-720),
      phone: "0410 223 998",
      documents: {
        tfn: "552 331 907",
        bank: { bsb: "112-879", accountNumber: "5521 4478", superFund: "REST Super", memberNumber: "RS-2299018" },
        contract: { signedOn: daysFromToday(-718), version: "Kitchen Staff v2" },
        handbook: { acknowledgedOn: daysFromToday(-718) },
        hrNotes: [],
        uploaded: [
          { label: "PR grant notice.pdf", uploadedOn: daysFromToday(-718), sizeKb: 340 },
          { label: "Food handler certificate.pdf", uploadedOn: daysFromToday(-600), sizeKb: 290 },
        ],
      },
    },
    {
      uid: "m5",
      name: "Yuki Tanaka",
      positionKind: "hall",
      positionLabel: "Hall",
      rate: 26,
      visaExpiry: daysFromToday(1537),
      visaType: "Permanent Resident",
      dob: birthdayInDays(180),
      startDate: daysFromToday(-95),
      phone: "0403 776 552",
      documents: {
        tfn: "308 991 774",
        bank: { bsb: "062-000", accountNumber: "7712 3388", superFund: "Hostplus", memberNumber: "HP-2201983" },
        contract: { signedOn: daysFromToday(-93), version: "Hall Staff v3" },
        handbook: { acknowledgedOn: daysFromToday(-93) },
        hrNotes: [],
        uploaded: [{ label: "PR grant notice.pdf", uploadedOn: daysFromToday(-93), sizeKb: 350 }],
      },
    },
    {
      uid: "m6",
      name: "Timothy Yang",
      positionKind: "kitchen",
      positionLabel: "Kitchen",
      rate: 30,
      visaExpiry: daysFromToday(1461),
      visaType: "Permanent Resident",
      dob: birthdayInDays(60),
      startDate: daysFromToday(-410),
      phone: "0411 663 210",
      documents: {
        tfn: "774 552 118",
        bank: { bsb: "032-002", accountNumber: "2211 8890", superFund: "Aware Super", memberNumber: "AW-6633778" },
        contract: { signedOn: daysFromToday(-408), version: "Kitchen Staff v2" },
        handbook: { acknowledgedOn: daysFromToday(-408) },
        hrNotes: [
          { date: daysFromToday(-30), author: "Head Chef", note: "Requested Saturday lunch off next month — noted." },
        ],
        uploaded: [{ label: "Food handler certificate.pdf", uploadedOn: daysFromToday(-408), sizeKb: 300 }],
      },
    },
    {
      uid: "m7",
      name: "Chiaki Sato",
      positionKind: "hall",
      positionLabel: "Hall",
      rate: 29,
      visaExpiry: daysFromToday(410),
      visaType: "Working Holiday",
      dob: birthdayInDays(150),
      startDate: daysFromToday(-620),
      phone: "0409 118 224",
      documents: {
        tfn: "228 661 007",
        bank: { bsb: "062-000", accountNumber: "9908 5522", superFund: "AustralianSuper", memberNumber: "AS-1122009" },
        contract: { signedOn: daysFromToday(-618), version: "Hall Staff v3" },
        handbook: { acknowledgedOn: daysFromToday(-618) },
        hrNotes: [
          { date: daysFromToday(-12), author: "Yurina", note: "Notice given — last working day recorded on the notice form." },
        ],
        uploaded: [{ label: "Passport photo page.pdf", uploadedOn: daysFromToday(-618), sizeKb: 400 }],
      },
    },
    {
      uid: "m8",
      name: "Jared Kim",
      positionKind: "kitchen",
      positionLabel: "Kitchen",
      rate: 34,
      visaExpiry: daysFromToday(650),
      visaType: "Permanent Resident",
      dob: birthdayInDays(90),
      startDate: daysFromToday(-810),
      phone: "0432 887 445",
      documents: {
        tfn: "119 002 887",
        bank: { bsb: "112-879", accountNumber: "3311 7788", superFund: "REST Super", memberNumber: "RS-8877221" },
        contract: { signedOn: daysFromToday(-808), version: "Kitchen Staff v2" },
        handbook: { acknowledgedOn: daysFromToday(-808) },
        hrNotes: [
          { date: daysFromToday(-22), author: "Head Chef", note: "Notice given — helping train replacement over the next three weeks." },
        ],
        uploaded: [{ label: "Food handler certificate.pdf", uploadedOn: daysFromToday(-808), sizeKb: 310 }],
      },
    },
    {
      uid: "m9",
      name: "Aoi Yamamoto",
      positionKind: "hall",
      positionLabel: "Hall",
      rate: 27,
      visaExpiry: daysFromToday(240),
      visaType: "Student (subclass 500)",
      dob: birthdayInDays(45),
      startDate: daysFromToday(-140),
      phone: "0421 003 668",
      documents: {
        tfn: "667 220 118",
        bank: { bsb: "084-004", accountNumber: "1188 4477", superFund: "Hostplus", memberNumber: "HP-3344225" },
        contract: { signedOn: daysFromToday(-138), version: "Hall Staff v3" },
        handbook: { acknowledgedOn: daysFromToday(-138) },
        hrNotes: [],
        uploaded: [
          { label: "Passport photo page.pdf", uploadedOn: daysFromToday(-138), sizeKb: 390 },
          { label: "Visa grant notice.pdf", uploadedOn: daysFromToday(-138), sizeKb: 250 },
        ],
      },
    },
    {
      uid: "m10",
      name: "Ryo Fujita",
      positionKind: "hall",
      positionLabel: "Hall",
      rate: 28,
      visaExpiry: daysFromToday(800),
      visaType: "Permanent Resident",
      dob: birthdayInDays(300),
      startDate: daysFromToday(-475),
      phone: "0405 992 118",
      documents: {
        tfn: "441 887 552",
        bank: { bsb: "062-000", accountNumber: "6633 1177", superFund: "AustralianSuper", memberNumber: "AS-2244881" },
        contract: { signedOn: daysFromToday(-473), version: "Hall Staff v3" },
        handbook: { acknowledgedOn: daysFromToday(-473) },
        hrNotes: [],
        uploaded: [{ label: "PR grant notice.pdf", uploadedOn: daysFromToday(-473), sizeKb: 330 }],
      },
    },
  ];
}

export function getMockActiveNotices(): MockNotice[] {
  return [
    { id: "n1", employeeUid: "m7", employeeName: "Chiaki Sato", lastWorkingDay: isoOf(daysFromToday(12)) },
    { id: "n2", employeeUid: "m8", employeeName: "Jared Kim", lastWorkingDay: isoOf(daysFromToday(22)) },
  ];
}
