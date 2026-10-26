import { describe, expect, test } from "bun:test";

import { validateReleasePlan } from "./validate-release-plan";

const packageNames = [
  "@naakwu/flowkit-auth",
  "@naakwu/flowkit-consumer",
  "@naakwu/flowkit-core",
  "@naakwu/flowkit-definitions",
  "@naakwu/flowkit-notify",
  "@naakwu/flowkit-tasks",
  "@naakwu/flowkit-temporal",
];

const planWith = (releases: Array<{ name: string; version: string }>) => ({
  version: 1,
  plan: [releases.map((release) => ({ kind: "publish", ...release }))],
});

describe("validateReleasePlan", () => {
  test("accepts exactly the seven unpublished FlowKit packages at 1.0.0", () => {
    expect(validateReleasePlan(planWith(packageNames.map((name) => ({ name, version: "1.0.0" }))))).toEqual(
      "1.0.0",
    );
  });

  test("rejects a publish plan that omits a FlowKit package", () => {
    expect(() =>
      validateReleasePlan(planWith(packageNames.slice(1).map((name) => ({ name, version: "1.0.0" })))),
    ).toThrow("must include exactly the seven FlowKit packages");
  });

  test("rejects a publish plan that omits only the definitions package", () => {
    expect(() =>
      validateReleasePlan(
        planWith(
          packageNames
            .filter((name) => name !== "@naakwu/flowkit-definitions")
            .map((name) => ({ name, version: "1.0.0" })),
        ),
      ),
    ).toThrow("must include exactly the seven FlowKit packages");
  });

  test("rejects a publish plan with a changed target version", () => {
    expect(() =>
      validateReleasePlan(planWith(packageNames.map((name) => ({ name, version: "1.0.1" })))),
    ).toThrow("must target 1.0.0");
  });

  test("accepts the version supplied by a later lockstep release PR", () => {
    expect(
      validateReleasePlan(
        planWith(packageNames.map((name) => ({ name, version: "1.0.1" }))),
        "1.0.1",
      ),
    ).toEqual("1.0.1");
  });

  test("rejects a publish plan that includes an unknown package", () => {
    expect(() =>
      validateReleasePlan(
        planWith([
          ...packageNames.map((name) => ({ name, version: "1.0.0" })),
          { name: "@naakwu/flowkit-unknown", version: "1.0.0" },
        ]),
      ),
    ).toThrow("must include exactly the seven FlowKit packages");
  });

  test("rejects a publish plan with no packages", () => {
    expect(() => validateReleasePlan(planWith([]))).toThrow("must include exactly the seven FlowKit packages");
  });
});
