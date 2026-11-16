import assert from "node:assert/strict";
import { test } from "node:test";
import { COMPARISON_EXAMPLE, INVESTMENT_CASE } from "./landing-demo.ts";

test("the investment example applies the private policy to the annual-report equity", () => {
  assert.equal(INVESTMENT_CASE.limitPercent, 25);
  assert.equal(INVESTMENT_CASE.limit, 12_150_000);
  assert.equal(INVESTMENT_CASE.overrun, 2_050_000);
  assert.equal(INVESTMENT_CASE.limit + INVESTMENT_CASE.overrun, INVESTMENT_CASE.budget);
});

test("the comparison uses two peers, positive bar values and consistent differences", () => {
  assert.equal(COMPARISON_EXAMPLE.organizations.length, 2);
  for (const metric of COMPARISON_EXAMPLE.metrics) {
    assert.equal(metric.values.length, 2);
    assert.ok(metric.values.every((value) => Number.isFinite(value) && value > 0));
    assert.ok(metric.page > 0);
  }
  assert.deepEqual(COMPARISON_EXAMPLE.metrics.map((m) => Number((m.values[0] - m.values[1]).toFixed(1))), [14.5, 1.3, -1.2]);
});
