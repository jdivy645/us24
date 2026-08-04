import test from "node:test";
import assert from "node:assert";
import { stitch } from "./stitch.js";

test("the repeated overlap is dropped, not duplicated", () => {
  const a = "the member id is one zero one six one nine five three five seven zero zero";
  const b = "five three five seven zero zero and the group number is triple zero three";
  assert.strictEqual(stitch(a, b),
    "the member id is one zero one six one nine five three five seven zero zero and the group number is triple zero three");
});

test("punctuation and case differences still count as a repeat", () => {
  assert.strictEqual(stitch("covered at one hundred percent.", "One hundred percent, with no copay"),
    "covered at one hundred percent. with no copay");
});

test("unrelated windows are simply joined", () => {
  assert.strictEqual(stitch("timely filing is one twenty days", "the rep name is Clark"),
    "timely filing is one twenty days the rep name is Clark");
});

test("a single repeated word is not treated as an overlap", () => {
  // one shared word is coincidence, not a boundary repeat — dropping it would lose speech
  assert.strictEqual(stitch("the deductible is met", "met means nothing is owed"),
    "the deductible is met met means nothing is owed");
});

test("empty inputs are handled", () => {
  assert.strictEqual(stitch("", "first window text"), "first window text");
  assert.strictEqual(stitch("only text", ""), "only text");
  assert.strictEqual(stitch("", ""), "");
});

test("a window that fully repeats the previous one adds nothing", () => {
  assert.strictEqual(stitch("no referral is required", "no referral is required"), "no referral is required");
});
