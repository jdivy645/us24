// Turns an exported call transcript into clean prose plus speaker attribution.
//
// Two reasons this has to exist rather than feeding the raw file to verify.js:
//
// 1. Speaker headers and timestamps are noise the matcher reads as content.
//    prepTranscript() concatenates every digit into a stream so a spoken member ID
//    can be matched across word boundaries — drop "Aug 4, 2026 08:38 AM" into that
//    and those digits sit adjacent to real values, where they can glue onto a
//    policy-ID match. segment() also cuts clauses on [.?!;\n], so a header line
//    becomes a clause of its own.
//
// 2. Knowing WHO said something changes what it proves. Our own agent reads
//    figures back to the rep constantly ("the member has met 526.24, right?").
//    Without attribution the engine counts that as confirmation of the form — the
//    form agreeing with itself. See ROLES below.

const RE_RC_HEADER = /^(.{1,60}?)\s*\|\s*(.{3,40}?\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)\s*$/i;

// Speaker labels, in the shapes real exports actually use. Every one of these was
// previously read as plain text with no speakers at all, which meant auto-fill
// could never run on it and the panel told the operator to fix it with a control
// that is only rendered when speakers exist.
//
//   Savi Sharma: …            bare
//   >> Savi Sharma: …         diarisation marker
//   Savi Sharma (00:12): …    inline timestamp, the most common portal export
//   Kim [00:12:04]: …
//   [00:12] Savi Sharma: …    leading timestamp
//   00:12:04 Kim: …
//
// The timestamp is captured separately so it never reaches the matcher — a clock
// beside a member ID is exactly the kind of digit run that produces a false match.
const TS = "(?:[(\\[]?\\d{1,2}:\\d{2}(?::\\d{2})?(?:\\.\\d+)?\\s*(?:AM|PM)?[)\\]]?)";
const RE_LABEL = new RegExp(
  `^(?:>>\\s*)?(?:(${TS})\\s+)?([A-Za-z][A-Za-z0-9 .'’_-]{0,38}?)\\s*(?:(${TS})\\s*)?:[ \\t]+(.*)$`, "i");
// A speaker on its own line, with the words following underneath.
const RE_LABEL_ALONE = new RegExp(
  `^(?:>>\\s*)?(?:(${TS})\\s+)?([A-Za-z][A-Za-z0-9 .'’_-]{0,38}?)\\s*(?:(${TS})\\s*)?:\\s*$`, "i");

// name + when, from either timestamp position
const labelParts = (m) => ({ speaker: squash(m[2]), at: squash(m[1] || m[3] || ""), text: squash(m[4] ?? "") });
// Microsoft Teams. The speaker and the clock share a line with NO colon, and the
// words follow underneath:
//
//   Saurabh Sharma   0:08
//   You can have it here.
//
// Every other label format in this file is anchored by that colon, so a Teams
// export used to fall through to `plain` — which is not merely a lost feature. The
// clock stays in the text, and "9:00" a few tokens from the word "copay" was
// measured writing $9.00 into a co-pay field on a call where the rep said there
// was none. A timestamp reaching the matcher is the exact hazard this module was
// written to prevent.
const RE_TEAMS_HEADER = /^(?:>>\s*)?([A-Za-z][A-Za-z0-9 .'’_-]{0,58}?)\s{1,}(\d{1,2}:\d{2}(?::\d{2})?)\s*$/;

// Prose can end in a time ("...call me back at 4:30"), so a header must also look
// like a name: no sentence punctuation, and few enough words to be one.
const looksLikeSpeaker = (name) =>
  !/[.!?,;:]/.test(name) && name.trim().split(/\s+/).length <= 5;

const teamsHeader = (line) => {
  const m = line.match(RE_TEAMS_HEADER);
  return m && looksLikeSpeaker(m[1]) ? { speaker: squash(m[1]), at: m[2] } : null;
};

// The chrome Teams wraps a transcript in. The date line is the dangerous one — it
// is a run of digits that tokenises straight into the stream a member ID is matched
// against.
const RE_TEAMS_CHROME = [
  /^.*-\d{8}_\d{6}-Meeting Recording\s*$/i,
  /^[A-Z][a-z]+ \d{1,2}, \d{4},? \d{1,2}:\d{2}\s*(?:AM|PM)?\s*$/i,
  /^\d+m \d+s\s*$/i,
  /^.{1,60} (?:started|stopped) transcription\s*$/i,
];

const RE_VTT_CUE = /^(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{3}\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{3}/;
const RE_VTT_VOICE = /^<v\s+([^>]+)>([\s\S]*?)(?:<\/v>)?$/i;
const RE_SRT_INDEX = /^\d+$/;
const RE_TAGS = /<\/?[^>]+>/g;

// Phone-tree and hold audio. Contributes phone numbers, menu digits and boilerplate
// that belong to no speaker, and every one of them is a false candidate value.
const RE_IVR = /\bpress \d|press one|dial it at any time|monitored or recorded|may be recorded|remain on the line|for further options|question survey|your call is regarding|if you are a\b/i;

const clean = (s) => String(s || "").replace(/\r\n?/g, "\n").replace(/ /g, " ");
const squash = (s) => s.replace(/[ \t]+/g, " ").trim();

// ------------------------------------------------------------------ formats

function parseRingCentral(lines) {
  const turns = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(RE_RC_HEADER);
    if (m) {
      if (cur) turns.push(cur);
      cur = { speaker: squash(m[1]), at: squash(m[2]), parts: [] };
      continue;
    }
    if (cur && line.trim()) cur.parts.push(squash(line));
  }
  if (cur) turns.push(cur);
  return turns.map((t) => ({ speaker: t.speaker, at: t.at, text: t.parts.join(" ") }));
}

function parseTeams(lines) {
  const turns = [];
  let cur = null;
  for (const line of lines) {
    if (RE_TEAMS_CHROME.some((re) => re.test(line.trim()))) continue;
    const h = teamsHeader(line);
    if (h) {
      if (cur) turns.push(cur);
      cur = { speaker: h.speaker, at: h.at, parts: [] };
      continue;
    }
    if (cur && line.trim()) cur.parts.push(squash(line));
  }
  if (cur) turns.push(cur);
  // Teams starts a new block on every pause, so one person answering a question
  // over three breaths becomes three turns. Merged, because the turn is what the
  // Q&A projection reasons about — three fragments of one answer look like three
  // separate answers to it.
  const merged = [];
  for (const t of turns) {
    const text = t.parts.join(" ");
    if (!text) continue;
    const last = merged[merged.length - 1];
    if (last && last.speaker === t.speaker) { last.text += " " + text; continue; }
    merged.push({ speaker: t.speaker, at: t.at, text });
  }
  return merged;
}

function parseLabelled(lines) {
  const turns = [];
  let cur = null;
  for (const line of lines) {
    const alone = line.match(RE_LABEL_ALONE);
    const m = alone || line.match(RE_LABEL);
    if (m) {
      if (cur) turns.push(cur);
      const p = labelParts(m);
      cur = { speaker: p.speaker, at: p.at, parts: alone ? [] : [p.text] };
      continue;
    }
    if (cur && line.trim()) cur.parts.push(squash(line));
  }
  if (cur) turns.push(cur);
  return turns
    .map((t) => ({ speaker: t.speaker, at: t.at, text: t.parts.filter(Boolean).join(" ") }))
    .filter((t) => t.text);
}

// WebVTT and SRT share enough structure to parse together: an optional index line,
// a timing line, then payload until a blank line.
function parseCues(lines) {
  const turns = [];
  let at = "", body = [];
  const flush = () => {
    if (!body.length) return;
    let speaker = "";
    const text = body.map((l) => {
      const v = l.match(RE_VTT_VOICE);
      if (v) { speaker = squash(v[1]); return squash(v[2]); }
      return squash(l);
    }).join(" ").replace(RE_TAGS, "").trim();
    if (text) turns.push({ speaker, at, text });
    body = [];
  };
  for (const line of lines) {
    const t = line.trim();
    if (!t) { flush(); continue; }
    if (t.toUpperCase().startsWith("WEBVTT") || RE_SRT_INDEX.test(t)) continue;
    const cue = t.match(RE_VTT_CUE);
    if (cue) { flush(); at = cue[0].split("-->")[0].trim(); continue; }
    body.push(t);
  }
  flush();

  // Cue files often carry no speaker at all, and where they do, consecutive cues
  // from one speaker are separate cues. Merge them so a turn is a turn.
  const merged = [];
  for (const t of turns) {
    const last = merged[merged.length - 1];
    if (last && last.speaker === t.speaker) { last.text += " " + t.text; continue; }
    merged.push({ ...t });
  }
  return merged;
}

function detect(raw, lines) {
  if (/^﻿?WEBVTT/i.test(raw) || lines.some((l) => RE_VTT_CUE.test(l.trim()))) return "vtt";
  // One header is enough when it opens the file — "Name | Mon D, YYYY H:MM AM" on
  // the first line is not something prose does by accident. Anywhere else, require
  // a second so a stray line cannot reshape a plain transcript.
  const headers = lines.filter((l) => RE_RC_HEADER.test(l)).length;
  const first = lines.find((l) => l.trim());
  if (headers >= 2 || (headers === 1 && first && RE_RC_HEADER.test(first))) return "ringcentral";
  // Teams, before the colon formats: a name-and-clock line carries no colon, so the
  // two cannot be confused. Held to the same bar `labelled` uses — several of them,
  // and a name that repeats — so one line of prose ending in a time cannot reshape
  // a plain transcript.
  const teams = lines.map(teamsHeader).filter(Boolean).map((h) => h.speaker);
  if (teams.length >= 3 && new Set(teams).size < teams.length) return "teams";
  // A label format has to repeat: "Note: ..." at the top of a plain file is not a
  // speaker, so require several labelled lines and at least one repeated name.
  const labels = lines
    .map((l) => l.match(RE_LABEL_ALONE) || l.match(RE_LABEL))
    .filter(Boolean)
    .map((m) => squash(m[2]));
  if (labels.length >= 3 && new Set(labels).size < labels.length) return "labelled";
  // A timestamp beside the name is strong enough on its own — prose does not do
  // that by accident — so two turns are enough when every label carries one.
  const stamped = lines
    .map((l) => l.match(RE_LABEL_ALONE) || l.match(RE_LABEL))
    .filter((m) => m && (m[1] || m[3]));
  if (stamped.length >= 2) return "labelled";
  return "plain";
}

// ------------------------------------------------------------------ roles

// Who said it decides what it proves:
//   rep     the payer's representative — the only voice that CONFIRMS a value
//   agent   our verifier — reading a number back is not the payer stating it
//   ivr     phone tree and hold messages, dropped
//   unknown unattributed; treated as rep, since a plain transcript with no
//           speakers must keep verifying exactly as it did before
const RE_QUESTION = /\?|^\s*(can|could|what|when|who|how|is|are|do|does|did|may|would|will|please)\b/i;

export function assignRoles(turns, { verifiedBy, insName, agentNames } = {}) {
  const names = [...new Set(turns.map((t) => t.speaker).filter(Boolean))];
  if (!names.length) return { turns: turns.map((t) => ({ ...t, role: "unknown" })), speakers: [] };

  const key = (s) => String(s || "").toUpperCase().replace(/[^A-Z]/g, "");
  const carrier = key(insName);
  const mine = new Set([key(verifiedBy), ...(agentNames || []).map(key)].filter(Boolean));

  const stats = names.map((n) => {
    const own = turns.filter((t) => t.speaker === n);
    const questions = own.filter((t) => RE_QUESTION.test(t.text)).length;
    return { name: n, turnCount: own.length, questionRatio: own.length ? questions / own.length : 0 };
  });

  const role = new Map();
  // The payer's own name is the strongest signal available: the transcript labels
  // the rep's channel with the carrier ("ASH" inside "CIGNA ASH"). But if it fits
  // more than one speaker it identifies none of them — calling both the rep would
  // promote our own agent's read-backs into the form, the exact failure this
  // module exists to prevent.
  const carrierHits = carrier
    ? stats.filter((s) => key(s.name).length >= 3 && (carrier.includes(key(s.name)) || key(s.name).includes(carrier)))
    : [];
  if (carrierHits.length === 1) role.set(carrierHits[0].name, "rep");
  for (const s of stats) {
    if (role.has(s.name)) continue;
    if (mine.has(key(s.name))) role.set(s.name, "agent");
  }

  // With two speakers, naming one names the other.
  if (names.length === 2 && role.size === 1) {
    const [known] = [...role.keys()];
    const other = names.find((n) => n !== known);
    role.set(other, role.get(known) === "rep" ? "agent" : "rep");
  }

  // Only our own side got named, and there are others. Everyone else is the payer:
  // with three speakers the pairing rule above cannot fire and the question-ratio
  // fallback below requires nothing to be known, so this case used to leave the
  // call with no rep at all.
  if (role.size && ![...role.values()].includes("rep")) {
    for (const s of stats) if (!role.has(s.name)) role.set(s.name, "rep");
  }

  // Nothing matched by name: the verifier is the one asking the questions.
  if (!role.size && stats.length >= 2) {
    const ranked = [...stats].sort((a, b) => b.questionRatio - a.questionRatio);
    role.set(ranked[0].name, "agent");
    for (const s of ranked.slice(1)) role.set(s.name, "rep");
  }

  return {
    turns: turns.map((t) => ({ ...t, role: role.get(t.speaker) || "unknown" })),
    speakers: stats.map((s) => ({ ...s, role: role.get(s.name) || "unknown" })),
  };
}

// ------------------------------------------------------------------ entry point

export function parseTranscript(raw, opts = {}) {
  const src = clean(raw);
  const lines = src.split("\n");
  const format = detect(src, lines);
  const warnings = [];

  let turns =
    format === "ringcentral" ? parseRingCentral(lines)
      : format === "vtt" ? parseCues(lines)
        : format === "teams" ? parseTeams(lines)
          : format === "labelled" ? parseLabelled(lines)
            : [{ speaker: "", at: "", text: squash(src.replace(/\n+/g, "\n")).trim() }];

  if (format === "plain") {
    // Keep the original line structure — segment() relies on newlines. The export
    // chrome still goes: a Teams file whose speaker lines were not recognised is
    // the case most likely to reach here, and its date line is a digit run that
    // tokenises straight into the stream member IDs are matched against.
    const body = lines.filter((l) => !RE_TEAMS_CHROME.some((re) => re.test(l.trim())));
    turns = [{ speaker: "", at: "", text: body.join("\n").trim() }];
  }

  turns = turns.filter((t) => t.text);

  // Drop the phone tree, but only the run of opening turns from whoever the
  // recording opens with. Once a second voice appears the call has begun, and
  // "press 3 for authorizations" said by a live rep is real content.
  let lead = 0;
  while (lead < turns.length && turns[lead].speaker === turns[0].speaker && RE_IVR.test(turns[lead].text)) lead++;
  if (lead === turns.length) lead = 0; // never throw the whole transcript away
  if (lead) {
    turns = turns.slice(lead).map((t) => ({ ...t }));
    warnings.push(`Skipped ${lead} phone-menu message${lead > 1 ? "s" : ""} at the start of the call.`);
  }

  const withRoles = assignRoles(turns, opts);

  // Build the clean text and record where each turn landed, so a match span can be
  // traced back to the speaker who produced it.
  let text = "";
  const ranges = [];
  withRoles.turns.forEach((t, i) => {
    if (i) text += "\n";
    const start = text.length;
    text += t.text;
    ranges.push({ start, end: text.length, role: t.role, speaker: t.speaker });
  });

  // Whether anything in this call can be traced to the payer rather than to us.
  // Values are still read out of an unattributed transcript — refusing outright
  // helps nobody — but the operator has to be told, because a figure here could be
  // something our own side read back.
  const attributed = withRoles.speakers.some((s) => s.role === "rep");
  if (!attributed) {
    warnings.push(withRoles.speakers.length
      ? "Could not tell which speaker is the insurance rep — set one below, or check every value carefully."
      : "No speakers in this transcript — a value read from it could be something our own side said.");
  }

  return { format, turns: withRoles.turns, speakers: withRoles.speakers, text, ranges, warnings, attributed };
}

// Character offset -> role. Used by verify.js to decide whether a match is a
// confirmation or our own agent echoing a number back.
export function roleAt(ranges, offset) {
  if (!ranges || !ranges.length) return "unknown";
  let lo = 0, hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offset < ranges[mid].start) hi = mid - 1;
    else if (offset >= ranges[mid].end) lo = mid + 1;
    else return ranges[mid].role;
  }
  return "unknown";
}
