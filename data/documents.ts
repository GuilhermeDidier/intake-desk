// Synthetic inbound documents. Every name, number and organization is invented.
// NPIs are Luhn-valid on purpose (except the one that is meant to fail).

export type SeedDocument = {
  slug: string;
  channel: "fax" | "portal" | "email";
  sender: string;
  receivedAt: string; // ISO, clinic local time is America/Chicago
  pages: number;
  text: string;
};

export const DOCUMENTS: SeedDocument[] = [
  {
    slug: "referral-okafor",
    channel: "fax",
    sender: "Lakeside Family Medicine",
    receivedAt: "2026-09-23T13:12:00Z",
    pages: 1,
    text: `LAKESIDE FAMILY MEDICINE
2210 Orchard Ave, Suite 4 · Riverton, IL
Phone (555) 010-4471 · Fax (555) 010-4472

REFERRAL FOR SPECIALTY CONSULTATION

To: Kestrel Valley Specialty Care, Orthopedics
Date: 09/22/2026

Patient name: Maria Okafor
Date of birth: 03/14/1961
Phone: (555) 013-8820

Referring provider: Dr. Alan Brierley, MD
NPI: 1482035718

Reason for referral: Right knee pain for 4 months, not improving
with physical therapy. Please evaluate; MRI of the right knee
requested if clinically indicated.

Insurance: Crestline Health Plan PPO
Member ID: CHP-77310554

Priority: Routine

Signed: A. Brierley, MD`,
  },
  {
    slug: "referral-farrow",
    channel: "fax",
    sender: "Riverton Internal Medicine",
    receivedAt: "2026-09-23T13:40:00Z",
    pages: 1,
    text: `RIVERTON INTERNAL MEDICINE
Fax (555) 010-6310

*** URGENT REFERRAL, PLEASE EXPEDITE ***

Kestrel Valley Specialty Care, Cardiology

Patient: Dennis Farrow
DOB: 11/02/1954
Contact: (555) 014-2297

Referring: Priya Raman, MD
NPI 1938460270

Reason: New atrial fibrillation on ECG 09/21/2026. Requesting
cardiology evaluation and anticoagulation management.

Insurance: Medicare Part B, ID to follow

Thank you,
P. Raman MD`,
  },
  {
    slug: "auth-okafor",
    channel: "fax",
    sender: "Crestline Health Plan",
    receivedAt: "2026-09-23T14:05:00Z",
    pages: 1,
    text: `CRESTLINE HEALTH PLAN
Utilization Management · Fax (555) 019-0020

PRIOR AUTHORIZATION DETERMINATION

Provider: Kestrel Valley Specialty Care
Member: OKAFOR, MARIA
Member DOB: 03/14/1961
Member ID: CHP-77310554

Determination: APPROVED
Authorization #: PA-2026-0918-4471
Service: MRI lower extremity joint without contrast
CPT: 73721
Units approved: 1
Valid from: 09/10/2026
Valid through: 10/02/2026

Services performed outside the valid dates will not be covered.
This is not a guarantee of payment.`,
  },
  {
    slug: "intake-park",
    channel: "portal",
    sender: "Patient portal · New patient form",
    receivedAt: "2026-09-23T14:22:00Z",
    pages: 2,
    text: `NEW PATIENT REGISTRATION · submitted via patient portal

Legal name: Lena Park
Date of birth: 07/30/1988
Mobile phone: (555) 017-3345
Home address: 48 Birchwood Lane, Apt 2B, Riverton, IL 60410

Primary insurance: Crestline Health Plan, Silver HMO
Member ID: CHP-20488913
Policy holder: Self

Emergency contact: Daniel Park (spouse), (555) 017-3346

CONSENT TO TREAT AND FINANCIAL RESPONSIBILITY
I consent to evaluation and treatment and accept financial
responsibility for charges not covered by my insurance.

Patient signature: ______________________
Date: __________

Preferred language: English`,
  },
  {
    slug: "records-hale",
    channel: "fax",
    sender: "Hale & Norquist LLP",
    receivedAt: "2026-09-23T14:51:00Z",
    pages: 2,
    text: `HALE & NORQUIST LLP
Attorneys at Law · 900 Commerce St · Riverton, IL
Fax (555) 016-9000

RE: Request for medical records
Our client: Thomas Beck, DOB 05/09/1979

Please send complete medical and billing records for dates of
service 01/01/2025 through present to the undersigned.

Enclosed: Authorization for release of protected health information

  I authorize Kestrel Valley Specialty Care to release my complete
  medical and billing records to Hale & Norquist LLP.
  This authorization expires on: ______
  Patient signature: Thomas Beck        Date: 09/15/2026

Sincerely,
Rachel Norquist, Esq.`,
  },
  {
    slug: "coverage-alvarez",
    channel: "email",
    sender: "patient email · r.alvarez@example.com",
    receivedAt: "2026-09-23T15:10:00Z",
    pages: 1,
    text: `From: Rosa Alvarez <r.alvarez@example.com>
Subject: New insurance starting next month

Hi, this is Rosa Alvarez (date of birth 12/01/1970). My employer
changed plans. Starting 10/01/2026 my insurance will be
BlueHarbor Choice PPO, member ID BHC-55017742. I have an
appointment on 10/14 with Dr. Chen. Can you update my file?

Thanks,
Rosa
(555) 012-6618`,
  },
  {
    slug: "message-whitfield",
    channel: "portal",
    sender: "Patient portal · Message",
    receivedAt: "2026-09-23T15:34:00Z",
    pages: 1,
    text: `PORTAL MESSAGE
From: James Whitfield · DOB 04/22/1957
To: Cardiology front desk
Subject: Reschedule my appointment

Hello, I need to move my follow-up on 09/29 to later in the
afternoon if possible, after 3pm.

Also, since I started the new blood pressure pill last week I have
had some chest tightness and I get short of breath climbing the
stairs. Probably nothing but wanted to mention it.

Thank you,
James`,
  },
  {
    slug: "referral-osei",
    channel: "fax",
    sender: "Northfield Pediatrics & Family",
    receivedAt: "2026-09-23T15:58:00Z",
    pages: 1,
    text: `NORTHFIELD PEDIATRICS & FAMILY
Fax (555) 011-2020

REFERRAL · Neurology

Patient: Kwame Osei
DOB: 02/17/2009
Parent phone: (555) 015-7781

Referring provider: Dr. Helen Marsh
NPI: 1629503845

Reason for referral: Recurrent headaches, 3 to 4 per week since
June, school absences. Evaluation requested.

Insurance: Prairie Kids CHIP
Member ID: PKC-0092217

Routine`,
  },
  {
    slug: "fax-fragment",
    channel: "fax",
    sender: "Unknown sender · (555) 018-0000",
    receivedAt: "2026-09-23T16:15:00Z",
    pages: 1,
    text: `P. 2 / 3

...continued from previous page

and follow-up in 6 weeks. Please call our office with any
questions regarding the above.

[pages 1 and 3 not received]`,
  },
];
