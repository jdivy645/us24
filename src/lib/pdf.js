import { jsPDF } from "jspdf";
import "jspdf-autotable";
import { fmtDate, dash as d } from "../data/fields.js";
import { vobName } from "./files.js";

// Expects a trimmed snapshot from collect(); validation happens in App.
// Returns the generated filename (stored on the saved record as _file).
export function makePDF(v) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth();
  const M = 42;
  const NAVY = [27, 58, 107], ORANGE = [232, 118, 31], INK = [15, 27, 45], SOFT = [67, 83, 107], LINE = [221, 228, 238];

  // Header
  doc.setFont("helvetica", "bold"); doc.setFontSize(17); doc.setTextColor(...NAVY);
  doc.text("US", M, 54);
  const w1 = doc.getTextWidth("US");
  doc.setTextColor(...ORANGE); doc.text("24", M + w1, 54);
  const w2 = doc.getTextWidth("24");
  doc.setTextColor(...NAVY); doc.text(" SOLUTIONS", M + w1 + w2, 54);
  doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...SOFT);
  doc.text("I N N O V A T I V E   T E C H N O L O G Y   D R I V E N", M, 66);

  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...NAVY);
  doc.text("Pre-Authorization & Benefits Determination", W - M, 52, { align: "right" });

  const pct = v.covPct || ((v.copay === "NO" && v.coins === "NO") ? "100%" : "");
  const stamp = pct ? `PATIENT RESPONSIBILITY COVERED: ${pct}` : "BENEFITS VERIFIED";
  doc.setFontSize(7.5);
  const sw = doc.getTextWidth(stamp) + 16;
  doc.setFillColor(231, 245, 239); doc.setDrawColor(185, 227, 210);
  doc.roundedRect(W - M - sw, 58, sw, 15, 3, 3, "FD");
  doc.setTextColor(14, 124, 90); doc.text(stamp, W - M - sw / 2, 68, { align: "center" });

  doc.setDrawColor(...NAVY); doc.setLineWidth(2); doc.line(M, 80, W - M, 80);

  let y = 96;
  if (v.note) {
    doc.setFillColor(253, 240, 228); doc.rect(M, y, W - M * 2, 22, "F");
    doc.setFillColor(...ORANGE); doc.rect(M, y, 3, 22, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(...INK);
    doc.text(doc.splitTextToSize(v.note, W - M * 2 - 20), M + 10, y + 13);
    y += 32;
  }

  const name = `${v.lastName || ""}${v.lastName && v.firstName ? ", " : ""}${v.firstName || ""}`;
  const section = (title, rows) => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...ORANGE);
    doc.text(title.toUpperCase(), M, y);
    doc.setDrawColor(...LINE); doc.setLineWidth(.6); doc.line(M, y + 3, W - M, y + 3);
    y += 6;
    doc.autoTable({
      startY: y, margin: { left: M, right: M },
      body: rows, theme: "plain",
      styles: { fontSize: 8, cellPadding: { top: 2.6, bottom: 2.6, left: 0, right: 6 }, textColor: INK, lineWidth: 0 },
      columnStyles: {
        0: { cellWidth: (W - M * 2) / 4 - 6, textColor: SOFT },
        1: { cellWidth: (W - M * 2) / 4 - 6, fontStyle: "bold", halign: "left" },
        2: { cellWidth: (W - M * 2) / 4 - 6, textColor: SOFT },
        3: { cellWidth: (W - M * 2) / 4 - 6, fontStyle: "bold", halign: "left" }
      },
      didDrawCell: (dt) => {
        if (dt.section === "body" && dt.column.index === 3) {
          doc.setDrawColor(238, 242, 247); doc.setLineWidth(.4);
          doc.line(M, dt.cell.y + dt.cell.height, W - M, dt.cell.y + dt.cell.height);
        }
      }
    });
    y = doc.lastAutoTable.finalY + 12;
  };
  const R = (a, b, c, e) => [a, d(b), c || "", c ? d(e) : ""];

  section("Patient", [
    R("Patient name", name, "Date of birth", fmtDate(v.dob)),
    R("Verification date", fmtDate(v.today), "Verified by", v.verifiedBy)
  ]);
  section("Insurance & plan", [
    R("Insurance", v.insName, "Payer phone", v.insPhone),
    R("Policy ID", v.policyId, "Group ID", v.groupId),
    R("Plan type", v.planType, "Service type", v.serviceType),
    R("Network status", v.network, "Coverage", v.coverage),
    R("Effective date", fmtDate(v.effDate), "Termination date", v.termDate),
    R("Payer ID", v.payerId, "HCA / HRA", v.hra)
  ]);
  section("Patient financial responsibility", [
    R("Co-pay", v.copay, "Co-pay amount", v.copayAmt),
    R("Co-insurance", v.coins, "Co-insurance %", v.coinsAmt),
    R("Deductible applies", v.dedApply, "Deductible (individual)", v.dedInd),
    R("Deductible met", v.dedMet, "Deductible remaining", v.dedRem),
    R("Out of pocket max", v.oop, "OOP met", v.oopMet),
    R("OOP remaining", v.oopRem, "Coverage %", v.covPct)
  ]);
  section("Visits & authorization", [
    R("Visit limitation", v.visitLimit, "Visits used", v.visitUsed),
    R("Auth — initial eval", v.authEval, "Auth — treatment", v.authTx),
    R("Referral required", v.referral, "PCP referral", v.pcpRef),
    R("Authorization #", v.authNum, "Auth coverage dates", v.authDates),
    R("How to obtain auth", v.authHow, "Request window from DOS", v.authWindow)
  ]);
  section("Claims & call record", [
    R("Timely filing — claims", v.tfl, "Timely filing — corrected", v.tflCorr),
    R("Primary payer", v.primary, "Secondary on file", v.hasSec),
    R("Insurance rep", v.repName, "Call reference", v.callRef),
    R("Claim mailing address", v.claimAddr, "", "")
  ]);
  if (v.hasSec === "YES") {
    section("Secondary insurance", [
      R("Insurance", v.secName, "Plan name", v.secPlan),
      R("Policy ID", v.secPolicy, "Effective date", fmtDate(v.secEff)),
      R("Deductible", v.secDed, "Visit limit", v.secVisit),
      R("Used limit", v.secUsed, "", "")
    ]);
  }

  // Footer on every page
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    const H = doc.internal.pageSize.getHeight();
    doc.setDrawColor(...LINE); doc.setLineWidth(.6); doc.line(M, H - 42, W - M, H - 42);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...SOFT);
    doc.text("US24 Solutions — Confidential. Benefits quoted are not a guarantee of payment.", M, H - 30);
    doc.text(`Page ${i} of ${pages}`, W - M, H - 30, { align: "right" });
  }

  const fn = vobName(v) + ".pdf";
  doc.save(fn);
  return fn;
}
