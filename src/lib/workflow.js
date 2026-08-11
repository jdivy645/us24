// The life of a saved record after the call is over.
//
// This is a SECOND gate, and it is deliberately not the one in ReviewGate. That one
// is the operator checking their own work against the call before it is written —
// it can only ever catch what the transcript disagrees with. This one is another
// person reading the finished record. Collapsing the two would mean the person who
// made a mistake is the only person who ever looks for it.
//
// The pipeline starts at the question the client starts at — "is authorization
// required, yes or no?" — because that answer decides what work is left to do:
//
//   draft ──submit──┬─ auth required ──▶ auth_pending ──auth done──▶ submitted
//                   └─ not required ─────────────────────────────▶  submitted
//                                                                     │
//                                          finished ◀──pass── in_qa ◀─┘
//                                                        │
//                        returned ◀────── return ────────┘
//                            └──── resubmit (findings resolved) ──▶ submitted
//
// Pure functions only. The database layer applies what these decide.

export const STATUS = {
  draft: "Draft",
  auth_pending: "Authorization",
  submitted: "Awaiting QA",
  in_qa: "In QA",
  returned: "Returned",
  finished: "Finished",
};

export const STATUS_ORDER = ["draft", "auth_pending", "submitted", "in_qa", "returned", "finished"];

// Records nobody is waiting on. Used by the dashboard and the queue counts.
export const OPEN_STATUSES = ["draft", "auth_pending", "submitted", "in_qa", "returned"];

// What QA found, sorted into the kinds that recur. One table, so the entry form,
// the Excel column and the dashboard can never describe the same mistake three
// different ways.
export const ERROR_CATEGORIES = {
  WRONG_DATA: "Wrong value",
  MISSING: "Missing information",
  WRONG_PATIENT: "Wrong patient or policy",
  TRANSCRIPTION: "Misread from the call",
  FORMATTING: "Formatting",
  PROCESS: "Process not followed",
  OTHER: "Other",
};

// Points deducted from a record's 100 for each finding against it. Tunable in one
// place on purpose: every team weighs these differently, and the only thing that
// must not change is that they are weighed somewhere findable.
export const ERROR_POINTS = { P1: 25, P2: 10, P3: 5, NONE: 0 };

export const PRIORITIES = ["P1", "P2", "P3", "NONE"];

export const PRIORITY_LABEL = {
  P1: "P1 — critical",
  P2: "P2 — moderate",
  P3: "P3 — minor",
  NONE: "No error",
};

// P1 first: a list sorted by "worst thing found" is the only order a QA lead reads.
export const PRIORITY_RANK = { P1: 0, P2: 1, P3: 2, NONE: 3 };

// `to` is either a status or a function of the context, because where a submitted
// record goes is a property of the record, not of the button. This is the one place
// the authorization answer changes the shape of the work.
export const TRANSITIONS = {
  submit: {
    from: ["draft", "returned"],
    to: (ctx) => (ctx.needsAuthWork ? "auth_pending" : "submitted"),
    roles: ["agent", "admin"],
  },
  // Whoever chased the authorization says what came back. Not restricted to QA:
  // obtaining an auth is the operator's job, not the checker's.
  authDone: { from: ["auth_pending"], to: "submitted", roles: ["agent", "qa", "admin"] },
  pickUp: { from: ["submitted"], to: "in_qa", roles: ["qa", "admin"] },
  pass: { from: ["in_qa", "submitted"], to: "finished", roles: ["qa", "admin"] },
  return: { from: ["in_qa", "submitted"], to: "returned", roles: ["qa", "admin"] },
  reopen: { from: ["finished"], to: "in_qa", roles: ["admin"] },
};

export const isStatus = (s) => Object.prototype.hasOwnProperty.call(STATUS, s);

// Where `action` would take a record in this context. Exported so the UI can label
// a button with its destination rather than guessing.
export const targetOf = (action, ctx = {}) => {
  const t = TRANSITIONS[action];
  if (!t) return "";
  return typeof t.to === "function" ? t.to(ctx) : t.to;
};

// Why a transition is refused, in words a toast can show. Null means allowed.
//
// `errors` is the findings already attached to the record — `return` requires at
// least one real one, because handing work back with no reason recorded is how a
// correction becomes an argument three weeks later.
export function refusal(action, { status, role = "agent", errors = [], blocking = 0, incomplete = false, authOutcome = "" } = {}) {
  const t = TRANSITIONS[action];
  if (!t) return `Unknown action "${action}"`;
  if (!t.from.includes(status)) {
    return `A record that is ${STATUS[status] ? STATUS[status].toLowerCase() : status} cannot be ${action === "pickUp" ? "picked up" : action + "ed"}`;
  }
  if (!t.roles.includes(role)) return `Only ${t.roles.join(" or ")} can do that`;
  if (action === "submit" && blocking > 0) return `${blocking} field${blocking > 1 ? "s" : ""} still need a decision before this can go on`;
  if (action === "submit" && incomplete) return "Fill or mark N/A every required field before sending this on";
  // Leaving `returned` means the findings have been dealt with. Without this the
  // correction loop is a suggestion, and a returned record can bounce straight back
  // to QA unchanged.
  if (action === "submit" && status === "returned") {
    const open = unresolved(errors);
    if (open.length) {
      return `${open.length} QA finding${open.length > 1 ? "s are" : " is"} still open — fix ${open.length > 1 ? "them" : "it"} and mark ${open.length > 1 ? "them" : "it"} done first`;
    }
  }
  // A denial is a finished answer and passes. Blank or still-pending is not: a
  // record moved on with "PENDING" tells the next person nothing happened.
  if (action === "authDone") {
    const o = String(authOutcome || "").trim().toUpperCase();
    if (!o || o === "PENDING") return "Record what the payer came back with before sending this to QA";
  }
  if (action === "return" && !errors.some((e) => e.priority && e.priority !== "NONE")) {
    return "Log at least one P1, P2 or P3 error before returning this record";
  }
  return null;
}

export const can = (action, ctx) => refusal(action, ctx) === null;

// The actions worth offering for a record in this state, in the order a person
// working the queue would reach for them.
export function actionsFor(status, role) {
  return Object.entries(TRANSITIONS)
    .filter(([, t]) => t.from.includes(status) && t.roles.includes(role))
    .map(([action]) => action);
}

const nowISO = () => new Date().toISOString();

// A brand-new record's workflow block. `status` is passed in because saving from
// the form and saving a draft are the same write with a different intent.
export function newWorkflow({ status = "draft", username = "", at = nowISO() } = {}) {
  return {
    status, username, qaName: "",
    createdAt: at, submittedAt: "", qaAt: "", finishedAt: "",
    history: [{ from: "", to: status, by: username, at, note: "" }],
  };
}

// Applies a transition to a workflow block and returns a NEW one. Timestamps are
// stamped once and never overwritten on a second pass through the same state —
// "when did this first reach QA" survives a return-and-resubmit round trip.
export function applyTransition(workflow, action, { by = "", note = "", at = nowISO(), needsAuthWork = false } = {}) {
  const t = TRANSITIONS[action];
  if (!t) throw new Error(`Unknown action "${action}"`);
  const from = workflow?.status || "draft";
  const to = targetOf(action, { needsAuthWork });
  const next = {
    ...workflow,
    status: to,
    history: [...(workflow?.history || []), { from, to, by, at, note }],
  };
  if (to === "auth_pending" && !next.authStartedAt) next.authStartedAt = at;
  if (to === "submitted" && !next.submittedAt) next.submittedAt = at;
  if (to === "in_qa" && !next.qaAt) next.qaAt = at;
  if (action === "authDone") next.authBy = by || next.authBy;
  if (action === "pass" || action === "return") next.qaName = by || next.qaName;
  if (to === "finished") next.finishedAt = at;
  // Reopening clears the finish stamp: a record that is back in QA is not finished,
  // and a dashboard counting finishedAt would otherwise double-count it.
  if (action === "reopen") next.finishedAt = "";
  return next;
}

// The worst thing QA found, for a one-glance column. NONE rows are real findings
// ("looked, found nothing") but they are not what a queue is sorted by.
export function topPriority(errors = []) {
  const real = errors.filter((e) => e.priority && e.priority !== "NONE");
  if (!real.length) return errors.length ? "NONE" : "";
  return real.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])[0].priority;
}

export const errorCount = (errors = []) => errors.filter((e) => e.priority && e.priority !== "NONE").length;

// Real findings nobody has fixed yet. A NONE row is never "open" — there is
// nothing to do about "we looked and found nothing".
export const unresolved = (errors = []) =>
  errors.filter((e) => e.priority && e.priority !== "NONE" && !e.resolvedAt);

export const pointsOf = (errors = []) =>
  errors.reduce((n, e) => n + (ERROR_POINTS[e.priority] || 0), 0);

// A record starts at 100 and loses points for what was found on it. Floored at
// zero: a score below zero says nothing more than a score of zero, and a negative
// number in a quality column reads as a bug.
//
// Resolved findings still count. The point of a quality score is what the work was
// like when it was handed over — if fixing a mistake erased it, the score would
// measure diligence at correcting rather than accuracy at doing.
export const recordScore = (errors = []) => Math.max(0, 100 - pointsOf(errors));

// A record has been checked once anything at all has been logged against it,
// including a clean pass. An empty list means nobody has looked yet.
export const isChecked = (errors = []) => errors.length > 0;
