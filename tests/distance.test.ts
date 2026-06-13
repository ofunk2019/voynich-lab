import { describe, expect, test } from "bun:test";
import type { Signature } from "../src/stats/signature.ts";
import type { MetricDef } from "../src/verify/distance.ts";
import { signatureDistances } from "../src/verify/distance.ts";

// Minimal fake signatures: only the fields used by the test vector matter.
function fakeSig(h1: number, h2: number): Signature {
  return {
    entropy: { h0: 0, h1, h2 },
  } as unknown as Signature;
}

const vector: MetricDef[] = [
  { name: "h1", extract: (s) => s.entropy.h1 },
  { name: "h2", extract: (s) => s.entropy.h2 },
];

describe("signatureDistances", () => {
  test("reference has distance 0 to itself; z-distances are correct", () => {
    // h1 values: ref 4, c1 4, c2 1 -> mean 3, sd sqrt(2)
    // h2 values: ref 2, c1 0, c2 4 -> mean 2, sd sqrt(8/3)
    const result = signatureDistances(
      { name: "ref", signature: fakeSig(4, 2) },
      [
        { name: "c1", signature: fakeSig(4, 0) },
        { name: "c2", signature: fakeSig(1, 4) },
      ],
      vector,
    );

    expect(result.aggregate.ref).toBe(0);

    const h1Row = result.rows[0];
    const h2Row = result.rows[1];
    expect(h1Row?.distances.c1).toBeCloseTo(0, 12); // same value as ref
    expect(h1Row?.distances.c2).toBeCloseTo(3 / Math.sqrt(2), 12);
    expect(h2Row?.distances.c1).toBeCloseTo(2 / Math.sqrt(8 / 3), 12);
    expect(h2Row?.distances.c2).toBeCloseTo(2 / Math.sqrt(8 / 3), 12);

    // aggregate = mean over the 2 metrics
    expect(result.aggregate.c2).toBeCloseTo((3 / Math.sqrt(2) + 2 / Math.sqrt(8 / 3)) / 2, 12);
  });

  test("zero-spread metric contributes distance 0", () => {
    const result = signatureDistances(
      { name: "ref", signature: fakeSig(4, 1) },
      [{ name: "c1", signature: fakeSig(4, 1) }],
      vector,
    );
    expect(result.aggregate.c1).toBe(0);
  });
});
