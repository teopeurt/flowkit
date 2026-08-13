import { describe, expect, test } from "bun:test";

import { validateReleasePlan } from "./validate-release-plan";

const packageNames = [
  "@naakwu/flowkit-auth",
  "@naakwu/flowkit-consumer",
  "@naakwu/flowkit-core",
  "@naakwu/flowkit-notify",
  "@naakwu/flowkit-tasks",
  "@naakwu/flowkit-temporal",
];

const planWith = (releases: Array<{ name: string; newVersion: string }>) => ({ releases });

describe("validateReleasePlan", () => {
  test("accepts exactly the six FlowKit packages at one target version", () => {
    expect(validateReleasePlan(planWith(packageNames.map((name) => ({ name, newVersion: "0.2.1" }))))).toEqual(
      "0.2.1",
    );
  });

  test("rejects a release plan that omits a FlowKit package", () => {
    expect(() =>
      validateReleasePlan(planWith(packageNames.slice(1).map((name) => ({ name, newVersion: "0.2.1" })))),
    ).toThrow("must include exactly the six FlowKit packages");
  });

  test("rejects a release plan with different target versions", () => {
    expect(() =>
      validateReleasePlan(
        planWith(
          packageNames.map((name, index) => ({ name, newVersion: index === 0 ? "0.2.2" : "0.2.1" })),
        ),
      ),
    ).toThrow("one shared target version");
  });

  test("rejects a release plan that includes an unknown package", () => {
    expect(() =>
      validateReleasePlan(
        planWith([
          ...packageNames.map((name) => ({ name, newVersion: "0.2.1" })),
          { name: "@naakwu/flowkit-unknown", newVersion: "0.2.1" },
        ]),
      ),
    ).toThrow("must include exactly the six FlowKit packages");
  });
});
