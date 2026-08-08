// The real ASH/Cigna eligibility call and the VOB that was typed from it, both
// supplied by the client. Reproduced verbatim, speech-to-text noise and all — the
// noise is the point.
//
// Kept out of the test files so both the verification suite (does the engine catch
// the defects in this record?) and the extraction suite (would it have prevented
// them?) grade against exactly the same call. `node --test "src/lib/*.test.js"`
// does not glob .fixture.js, so this never runs as a test of its own.

export const ASH_CALL = `ASH | Aug 4, 2026 08:37 AM
 If you are a member calling for assistance, please press 9 now.  If you are a provider, stay on the line for further options.  Calls may be monitored or recorded for training and quality purposes.  During your call with us, we may request personal information from you to verify your identity and assist you with the services. We provide to you.  If, you know your party's 4 digit extension, you may dial it at any time.  If your call is regarding patient eligibility, press 1.  if your  if your call is regarding a patient with Cigna coverage, press 1,  if your call is,  Ash offers a direct line for the sigma site of care, outpatient hospital, physical and occupational therapy program.  You can dial 833-695-1781 for faster, access to the sigma site of care provider service team.

ASH | Aug 4, 2026 08:38 AM
 If you are an ash participating, provider press 1.  If you.  At the end of today's call, you may receive a quick 3 question survey that takes less than a minute.  Your feedback, helps our agents improve their service.  Please remain on the line while we connect you with the next available agent.

ASH | Aug 4, 2026 08:38 AM
 My name is.

Savi Sharma | Aug 4, 2026 08:38 AM
Um, can you spell your name for me? 1 more time, please.

Savi Sharma | Aug 4, 2026 08:39 AM
 J e.  N e, c a like.

ASH | Aug 4, 2026 08:39 AM
 Yeah.  Can I have your name?

Savi Sharma | Aug 4, 2026 08:39 AM
 J. A  Yeah, my name is Tom t o m. Initially is M for Mike, I'm calling from the provider office. I want benefits and eligibility for physical therapy.  Can you assist me regarding this?

ASH | Aug 4, 2026 08:39 AM
 Sure, I could definitely take a look at the numbers beneficial. See the verify, some information. Can I have the tax ID?

Savi Sharma | Aug 4, 2026 08:39 AM
 1030 will be 92, 309 2814.

ASH | Aug 4, 2026 08:39 AM
 Taxation or name and address.

Savi Sharma | Aug 4, 2026 08:39 AM
 At uh the name of the provider will be the remaining kalal and the address will be 8526. Highway 6. North Houston Texas. 777095.

ASH | Aug 4, 2026 08:39 AM
What's the name of the practice?

Savi Sharma | Aug 4, 2026 08:40 AM
 Uh, the first the group name is Aura FY. Texas LLC.

ASH | Aug 4, 2026 08:40 AM
 All right. Can I have the member ID number?

Savi Sharma | Aug 4, 2026 08:40 AM
 Yes, sure. The number ID will be 106.  723 434.

ASH | Aug 4, 2026 08:40 AM
 Full name and date of birth.

Savi Sharma | Aug 4, 2026 08:40 AM
 Number name is carsten basin.  And the date of birth is.  October 7th 2010.

ASH | Aug 4, 2026 08:40 AM
 Can you verify the health plan?

Savi Sharma | Aug 4, 2026 08:40 AM
 Signage.

ASH | Aug 4, 2026 08:41 AM
 Hey, eligibility verification is not a guarantee of payment. Please review your client summary for acceptable, billing codes.  And I am showing the patient eligible for physical therapy occupational. Therapy benefits effective.  October 1st 2025.

ASH | Aug 4, 2026 08:41 AM
 Okay.  Number has a 20% Co insurance.  With.  20 calendar year visits.  Number has a family to deductible of dollars. Remaining 4, 7, 3. 7, 6.

Savi Sharma | Aug 4, 2026 08:42 AM
What is the individual deductible and individual out of pocket?

ASH | Aug 4, 2026 08:42 AM
 $3,000.

Savi Sharma | Aug 4, 2026 08:42 AM
 Okay.  What is the Met amount?

ASH | Aug 4, 2026 08:42 AM
 They showing zero dollars.

Savi Sharma | Aug 4, 2026 08:42 AM
 so, nothing has been

ASH | Aug 4, 2026 08:42 AM
 Out of pocket.

Savi Sharma | Aug 4, 2026 08:42 AM
 With it again. Uh, nothing else.

ASH | Aug 4, 2026 08:42 AM
 Well no, the the the deductible remaining is 473.76.

Savi Sharma | Aug 4, 2026 08:42 AM
 Okay, are you sure out of 3,000? The member has met 526.24, right?

ASH | Aug 4, 2026 08:42 AM
 The individual deductible is and remaining they have thousand dollars 473. 76 cents, remaining.

Savi Sharma | Aug 4, 2026 08:43 AM
Okay.  Uh, 2, 47377 and what is the out of pocket individual?

ASH | Aug 4, 2026 08:43 AM
 6, uh 6,500 and remaining is 5,473.76.

Savi Sharma | Aug 4, 2026 08:43 AM
 Okay, and the member has a 20% Point Insurance, right?

ASH | Aug 4, 2026 08:43 AM
 30%. Yes.

Savi Sharma | Aug 4, 2026 08:43 AM
 Okay. And can you just please provide me the group now, uh, the group ID.

ASH | Aug 4, 2026 08:43 AM
 00633.  434.

Savi Sharma | Aug 4, 2026 08:43 AM
 Okay.  And can you just tell me out of 20? Visit how many visit has been used?

ASH | Aug 4, 2026 08:43 AM
 They haven't used any visits.

Savi Sharma | Aug 4, 2026 08:43 AM
 They haven't used any visit.  Um, but in the portal I have seen that 1. Visit has been used, so can you just please reach out.

ASH | Aug 4, 2026 08:44 AM
 Oh, for physical therapy. Yes, for physical therapy. They have 19 business remaining.

Savi Sharma | Aug 4, 2026 08:44 AM
Okay, and it's a hard match of 20 visit, right?

ASH | Aug 4, 2026 08:44 AM
Yeah.

Savi Sharma | Aug 4, 2026 08:44 AM
 Okay. Uh, after how many visit the O will be required? The medical necessity review?

ASH | Aug 4, 2026 08:44 AM
 1 moment.

ASH | Aug 4, 2026 08:44 AM
 After the eighth visit?

Savi Sharma | Aug 4, 2026 08:44 AM
 after 8, visit  Okay, and so it will be required through Ash, right?

ASH | Aug 4, 2026 08:44 AM
 Yeah.

Savi Sharma | Aug 4, 2026 08:44 AM
 And um, can you just tell me that is the member having any secondary insurance?

ASH | Aug 4, 2026 08:45 AM
 No, we we wouldn't be able to see that on our end.

Savi Sharma | Aug 4, 2026 08:45 AM
 And you are the primary 1, right? Correct.

ASH | Aug 4, 2026 08:45 AM
 Yeah.

Savi Sharma | Aug 4, 2026 08:45 AM
Okay.  And can you just please provide me?  the timely filing limit, uh, timely filing days for initial claim And Timely reporting test for corrected claims,

ASH | Aug 4, 2026 08:45 AM
180 days from the data service for original submission for a claim.

Savi Sharma | Aug 4, 2026 08:45 AM
 Okay.

ASH | Aug 4, 2026 08:45 AM
 and,  To correct. You said resubmission.

Savi Sharma | Aug 4, 2026 08:45 AM
 I have, I have asked you for. What is the timely calling for fresh claim? And what is the timing calling days for corrected claims? So, for fresh claim, you have told that it 18 days, right?

ASH | Aug 4, 2026 08:45 AM
Yeah.

Savi Sharma | Aug 4, 2026 08:45 AM
 And and what is the time?

ASH | Aug 4, 2026 08:45 AM
 So if it's a if it's it's it's it's the correct practitioner error or to correct the ash error.

Savi Sharma | Aug 4, 2026 08:46 AM
 Correct. Ma'am. I'm asking you for the timely, following days, for corrected claims.

ASH | Aug 4, 2026 08:46 AM
 I heard what you said. I'm asking you is it to correct from the practitioner or from Ash because it's 2 different ones. So that's what I'm asking you is it to correct a practitioner error will be will be an error on your end or error on Ash's end.

Savi Sharma | Aug 4, 2026 08:46 AM
 Uh, practitioners from our side.

ASH | Aug 4, 2026 08:46 AM
 Oh, okay.  Um, so it's 180 days from the date of service or 60 calendar days from the ra. Um, elbe.

Savi Sharma | Aug 4, 2026 08:46 AM
 Okay, and what you have told your name. Can you spell your name 1 more time, please.

ASH | Aug 4, 2026 08:46 AM
 J a h. N e e v. A

Savi Sharma | Aug 4, 2026 08:46 AM
 Uh your name is j a h n e e z a right.

ASH | Aug 4, 2026 08:47 AM
 V as in Victor. A

Savi Sharma | Aug 4, 2026 08:47 AM
 Okay, your name is, Danielle jhn. Westvirginia, what's the initial?  Okay, please provide me the call options.

ASH | Aug 4, 2026 08:47 AM
20874738.

Savi Sharma | Aug 4, 2026 08:47 AM
 Uh, 2087.  4738. Right.

ASH | Aug 4, 2026 08:47 AM
 Correct.

Savi Sharma | Aug 4, 2026 08:47 AM
 Okay, thank you so much for the information. Have a nice day. Bye bye.

ASH | Aug 4, 2026 08:47 AM
 You're welcome. Thank you for calling America, social have a great day, please stay on the line to complete.

Savi Sharma | Aug 4, 2026 08:47 AM
 Bye.`;

// The VOB as it was actually filled in, errors included.
export const FILLED = {
  lastName: "BAZAN", firstName: "CARSTEN", dob: "2010-10-07", today: "2026-08-04", verifiedBy: "SP",
  insName: "CIGNA ASH", insPhone: "800-972-4226", policyId: "106723434-01", groupId: "00633434",
  planType: "OPEN ACCESS PLUS", serviceType: "PT", network: "IN NETWORK",
  coverage: "INN BENEFITS WITH AUTH", authAfter: "5",
  effDate: "2025-10-01", termDate: "", payerId: "ASHP1", hra: "NO",
  copay: "NO", copayAmt: "", covPct: "80%", coins: "YES", coinsAmt: "20%",
  dedApply: "YES", dedInd: "$3000.00", dedMet: "$526.24", dedRem: "$2473.76",
  oop: "$6500.00", oopMet: "$1026.24", oopRem: "$5473.76",
  visitLimit: "20 (HARD MAX)", visitUsed: "01",
  authEval: "NO", authTx: "YES", referral: "NO", pcpRef: "NO",
  authHow: "THROUGH ASH (800-972-4226)", claimAddr: "",
  tfl: "90 DAYS FROM DOS", tflCorr: "180 DAYS FROM DOS",
  repName: "JAHNEEVA.C", callRef: "20874738", primary: "CIGNA ASH", hasSec: "NO",
};

// What the operator marked as coming from somewhere other than the call.
export const META = {
  payerId: { source: "carrier" },
  planType: { source: "portal" },
  insPhone: { source: "carrier" },
  claimAddr: { source: "carrier" },
  tfl: { source: "carrier" },
  oopMet: { source: "derived" },
  termDate: { bypass: { reason: "NOT_ON_CALL", auto: false } },
};


// The VOB as it SHOULD have been filled: the three defects the call disproves,
// corrected. This is what extraction is graded against.
export const TRUTH = {
  ...FILLED,
  tfl: "180 DAYS FROM DOS",
  authAfter: "8",
  dedRem: "$473.76",
  dedMet: "$0.00",     // the rep answered "They showing zero dollars"; $526.24 was our own arithmetic
};
