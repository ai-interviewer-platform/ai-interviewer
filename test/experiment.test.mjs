import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { assignVariant, variantVersion } from "../public/experiment.js";

const directory = await mkdtemp(join(tmpdir(), "experiment-"));
after(() => rm(directory, { recursive: true, force: true }));
await build({ entryPoints: ["src/experiment.ts"], outdir: directory, outExtension: { ".js": ".mjs" }, bundle: true, format: "esm", platform: "node" });
const { differenceInterval, experimentConfig, landingExperiment, normalQuantile, plannedDocuments } = await import(pathToFileURL(join(directory, "experiment.mjs")));

const contract = {
  id: "hero-fixture", status: "running", start: "2026-09-16T00:00:00.000Z", hypothesis: "Naming the review step raises waitlist intent.", audience: "Landing documents that are not automated or internal.",
  primaryOutcome: { name: "cta_selected", action: "waitlist" }, guardrails: [{ name: "cta_selected", action: "sample" }],
  baseline: { start: "2026-09-01T00:00:00.000Z", end: "2026-09-15T00:00:00.000Z" }, minimumEffect: 0.02, alpha: 0.05, power: 0.8,
  identity: "document", method: "fixed-horizon-two-proportion",
  variants: [{ id: "control", weight: 1 }, { id: "review-first", weight: 1, copy: { headline: "See what your practice shows." } }],
};

test("the sample size and interval match the textbook two-proportion formulas", () => {
  assert.ok(Math.abs(normalQuantile(0.975) - 1.959964) < 1e-6);
  assert.ok(Math.abs(normalQuantile(0.8) - 0.841621) < 1e-6);
  assert.ok(Math.abs(normalQuantile(0.001) + 3.090232) < 1e-6);
  // 10% baseline, 2 points, alpha 0.05, power 0.8, equal allocation: 3841 per group.
  assert.deepEqual(plannedDocuments(0.1, 0.02, 0.05, 0.8, 1), { control: 3841, treatment: 3841 });
  const unequal = plannedDocuments(0.1, 0.02, 0.05, 0.8, 2);
  assert.equal(unequal.treatment, Math.ceil(2 * unequal.control));
  assert.ok(unequal.control < 3841 && unequal.control + unequal.treatment > 2 * 3841, "Unequal allocation needs more documents in total");
  for (const baseline of [0, 1, 0.99]) assert.equal(plannedDocuments(baseline, 0.02, 0.05, 0.8, 1), null, "No plan without variation or room for the effect");
  const result = differenceInterval({ documents: 100, conversions: 20 }, { documents: 100, conversions: 30 }, 0.05);
  assert.ok(Math.abs(result.difference - 0.1) < 1e-12);
  assert.ok(Math.abs(result.interval[0] + 0.0200) < 1e-3 && Math.abs(result.interval[1] - 0.2200) < 1e-3);
  assert.equal(result.excludesZero, false);
});

test("assignment is stable per document and follows the approved weights", () => {
  const ids = Array.from({ length: 20000 }, () => crypto.randomUUID());
  for (const id of ids.slice(0, 50)) assert.equal(assignVariant(contract, id).id, assignVariant(contract, id).id);
  const share = weights => ids.filter(id => assignVariant({ ...contract, variants: contract.variants.map((variant, index) => ({ ...variant, weight: weights[index] })) }, id).id === "control").length / ids.length;
  assert.ok(Math.abs(share([1, 1]) - 0.5) < 0.02);
  assert.ok(Math.abs(share([3, 1]) - 0.75) < 0.02);
  assert.notEqual(variantVersion(contract.variants[1]), variantVersion({ ...contract.variants[1], copy: { headline: "Changed" } }), "Changed copy is a new version");
});

test("an incomplete contract or a stopped experiment serves the control", () => {
  const env = value => ({ LANDING_EXPERIMENT: JSON.stringify(value) });
  assert.deepEqual(landingExperiment({}), { experiment: null, problems: [] });
  assert.equal(experimentConfig(env(contract), true).variants[1].version, variantVersion(contract.variants[1]));
  assert.equal(experimentConfig(env(contract), false), null, "No experiment without measurement");
  assert.equal(experimentConfig(env({ ...contract, status: "stopped", end: "2026-09-20T00:00:00.000Z" }), true), null, "Rollback");
  assert.equal(experimentConfig(env({ ...contract, start: "2999-01-01T00:00:00.000Z" }), true), null, "Nothing is served before the start");
  assert.equal(landingExperiment(env({ ...contract, status: "stopped" })).problems.length, 1, "A stopped experiment records its end");
  for (const [field, value] of [["hypothesis", ""], ["guardrails", []], ["minimumEffect", 0], ["alpha", undefined], ["baseline", { start: "2026-09-15", end: "2026-09-01" }], ["method", "peek-until-significant"], ["start", "2026-09-10T00:00:00.000Z"],
    ["primaryOutcome", { name: "landing_click", action: "none" }], ["variants", [contract.variants[1], contract.variants[0]]], ["variants", [contract.variants[0], { ...contract.variants[1], copy: { footer: "x" } }]]]) {
    const { experiment, problems } = landingExperiment(env({ ...contract, [field]: value }));
    assert.equal(experiment, null, field);
    assert.equal(problems.length, 1, `${field}: ${problems}`);
    assert.equal(experimentConfig(env({ ...contract, [field]: value }), true), null);
  }
  assert.match(landingExperiment({ LANDING_EXPERIMENT: "{" }).problems[0], /not JSON/);
});
