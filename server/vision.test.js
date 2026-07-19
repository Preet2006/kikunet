import test from "node:test";
import assert from "node:assert/strict";
import { getVisionPreset, listVisionPresets } from "./vision.js";

test("verification demo presets describe visible details without precomputing a match verdict", () => {
  const indore = getVisionPreset("indore_station");
  assert.equal(indore.kind, "location");
  assert.match(indore.visible_details, /INDORE JUNCTION/);
  assert.equal(Object.hasOwn(indore, "matches"), false);
  assert.equal(getVisionPreset("unknown"), null);
  assert.equal(listVisionPresets().length, 4);
});
