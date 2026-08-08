// A benefits call conducted the way they usually are: the rep answers what they
// are asked, in words, one figure at a time. The ASH fixture is the opposite —
// a real call, badly transcribed — and between them they say something useful
// about extraction that neither says alone.
//
// Kept out of the test glob so it can be shared. `node --test "src/lib/*.test.js"`
// does not match .fixture.js.

export const CLEAN_CALL = `Rep | Aug 4, 2026 09:00 AM
 Thank you for calling Aetna, my name is Clark. How can I help?

Agent | Aug 4, 2026 09:01 AM
 I need benefits for physical therapy. Member ID one zero one six one nine five three five seven zero zero.

Rep | Aug 4, 2026 09:02 AM
 Group number is zero zero zero zero zero three. The payer ID is six zero zero five four.
 The plan is effective March first twenty twenty six. They are in network.

Agent | Aug 4, 2026 09:03 AM
 What is the individual deductible?

Rep | Aug 4, 2026 09:04 AM
 The individual deductible is fifteen hundred dollars, with two hundred fifty met and one thousand two hundred fifty remaining.

Agent | Aug 4, 2026 09:05 AM
 And the out of pocket maximum?

Rep | Aug 4, 2026 09:06 AM
 Out of pocket is three thousand dollars, five hundred met and two thousand five hundred remaining.

Agent | Aug 4, 2026 09:07 AM
 Is authorization required for the initial evaluation?

Rep | Aug 4, 2026 09:08 AM
 Yes.

Agent | Aug 4, 2026 09:09 AM
 And for treatment?

Rep | Aug 4, 2026 09:10 AM
 Yes, that is correct.

Agent | Aug 4, 2026 09:11 AM
 Is a referral required?

Rep | Aug 4, 2026 09:12 AM
 No.

Agent | Aug 4, 2026 09:13 AM
 Is a PCP referral required for approval?

Rep | Aug 4, 2026 09:14 AM
 No, it is not.

Agent | Aug 4, 2026 09:15 AM
 How many visits are allowed?

Rep | Aug 4, 2026 09:16 AM
 Twenty visits per calendar year, and they have used three visits.

Agent | Aug 4, 2026 09:17 AM
 What is the co-insurance?

Rep | Aug 4, 2026 09:18 AM
 Co-insurance is twenty percent, covered at eighty percent. There is no copay.

Agent | Aug 4, 2026 09:19 AM
 Timely filing?

Rep | Aug 4, 2026 09:20 AM
 One hundred twenty days from date of service.

Agent | Aug 4, 2026 09:21 AM
 May I have the call reference number?

Rep | Aug 4, 2026 09:22 AM
 Three five eight four two eight one one four.`;

// What the rep actually stated. Extraction is graded against this.
export const CLEAN_TRUTH = {
  groupId: "000003", payerId: "60054", effDate: "2026-03-01", network: "IN NETWORK",
  dedInd: "$1500.00", dedMet: "$250.00", dedRem: "$1250.00",
  oop: "$3000.00", oopMet: "$500.00", oopRem: "$2500.00",
  authEval: "YES", authTx: "YES", referral: "NO", pcpRef: "NO",
  visitLimit: "20", visitUsed: "3", coinsAmt: "20%", covPct: "80%", copay: "NO",
  tfl: "120 DAYS FROM DOS", callRef: "358428114", serviceType: "PT",
};
