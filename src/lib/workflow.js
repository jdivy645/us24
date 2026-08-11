// The life of a saved record after the call is over.
//
// This is a SECOND gate, and it is deliberately not the one in ReviewGate. That one
// is the operator checking their own work against the call before it is written —
// it can only ever catch what the transcript disagrees with. This one is another
// person reading the finished record. Collapsing the two would mean the person who
// made a mistake is the only person who ever looks for it.
//
//   draft ──submit──▶ submitted ──pick up──▶ in_qa ──pass──▶ finished
//                        ▲                      │
//                        └───── resubmit ───────┴── return ──▶ returned
//
// Pure functions only. The database layer applies what these decide.

export const STATUS = {
  draft: "Draft",
  submitted: "Awaiting QA",
  in_qa: "In QA",
  returned: "Returned",
  finished: "Finished",
};

export const STATUS_ORDER = ["draft", "submitted", "in_qa", "returned", "finished"];

// Records nobody is waiting on. Used by the dashboard and the queue counts.
export const OPEN_STATUSES = ["draft", "submitted", "in_qa", "returned"];

export const PRIORITIES = ["P1", "P2", "P3", "NONE"];

export const PRIORITY_LABEL = {
  P1: "P1 — critical",
  P2: "P2 — moderate",
  P3: "P3 — minor",
  NONE: "No error",
};

// P1 first: a list sorted by "worst thing found" is the only order a QA lead reads.
export const PRIORITY_RANK = { P1: 0, P2: 1, P3: 2, NONE: 3 };

export const TRANSITIONS = {
  submit: { from: ["draft", "returned"], to: "submitted", roles: ["agent", "admin"] },
  pickUp: { from: ["submitted"], to: "in_qa", roles: ["qa", "admin"] },
  pass: { from: ["in_qa", "submitted"], to: "finished", roles: ["qa", "admin"] },
  return: { from: ["in_qa", "submitted"], to: "returned", roles: ["qa", "admin"] },
  reopen: { from: ["finished"], to: "in_qa", roles: ["admin"] },
};

export const isStatus = (s) => Object.prototype.hasOwnProperty.call(STATUS, s);

// Why a transition is refused, in words a toast can show. Null means allowed.
//
// `errors` is the findings already attached to the record — `return` requires at
// least one real one, because handing work back with no reason recorded is how a
// correction becomes an argument three weeks later.
export function refusal(action, { status, role = "agent", errors = [], blocking = 0, incomplete = false } = {}) {
  const t = TRANSITIONS[action];
  if (!t) return `Unknown action "${action}"`;
  if (!t.from.includes(status)) {
    return `A record that is ${STATUS[status] ? STATUS[status].toLowerCase() : status} cannot be ${action === "pickUp" ? "picked up" : action + "ed"}`;
  }
  if (!t.roles.includes(role)) return `Only ${t.roles.join(" or ")} can do that`;
  if (action === "submit" && blocking > 0) return `${blocking} field${blocking > 1 ? "s" : ""} still need a decision before this can go to QA`;
  if (action === "submit" && incomplete) return "Fill or mark N/A every required field before sending this to QA";
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
export function applyTransition(workflow, action, { by = "", note = "", at = nowISO() } = {}) {
  const t = TRANSITIONS[action];
  if (!t) throw new Error(`Unknown action "${action}"`);
  const from = workflow?.status || "draft";
  const next = {
    ...workflow,
    status: t.to,
    history: [...(workflow?.history || []), { from, to: t.to, by, at, note }],
  };
  if (t.to === "submitted" && !next.submittedAt) next.submittedAt = at;
  if (t.to === "in_qa" && !next.qaAt) next.qaAt = at;
  if (action === "pass" || action === "return") next.qaName = by || next.qaName;
  if (t.to === "finished") next.finishedAt = at;
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
