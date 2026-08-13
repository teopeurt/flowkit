export const flowKitPackages = [
  "@naakwu/flowkit-auth",
  "@naakwu/flowkit-consumer",
  "@naakwu/flowkit-core",
  "@naakwu/flowkit-notify",
  "@naakwu/flowkit-tasks",
  "@naakwu/flowkit-temporal",
] as const;

type Release = { name?: unknown; newVersion?: unknown };
type ReleasePlan = { releases?: unknown };

export function validateReleasePlan(plan: ReleasePlan): string {
  if (!Array.isArray(plan.releases)) {
    throw new Error("Release plan must contain a releases array");
  }

  const releases = plan.releases as Release[];
  const releaseNames = releases.map((release) => release.name);
  if (releaseNames.some((name) => typeof name !== "string")) {
    throw new Error("Release plan must include exactly the six FlowKit packages");
  }

  const expectedNames = new Set<string>(flowKitPackages);
  const actualNames = new Set(releaseNames as string[]);
  if (
    releases.length !== flowKitPackages.length ||
    actualNames.size !== flowKitPackages.length ||
    [...actualNames].some((name) => !expectedNames.has(name)) ||
    flowKitPackages.some((name) => !actualNames.has(name))
  ) {
    throw new Error("Release plan must include exactly the six FlowKit packages");
  }

  const releaseVersions = releases.map((release) => release.newVersion);
  if (releaseVersions.some((version) => typeof version !== "string")) {
    throw new Error("Release plan must use one shared target version");
  }

  const targetVersions = new Set(releaseVersions as string[]);
  if (targetVersions.size !== 1) {
    throw new Error("Release plan must use one shared target version");
  }

  return targetVersions.values().next().value as string;
}

if (import.meta.main) {
  const releasePlanPath = Bun.argv[2] ?? ".changeset/release-plan.json";
  const releasePlan = JSON.parse(await Bun.file(releasePlanPath).text()) as ReleasePlan;
  const targetVersion = validateReleasePlan(releasePlan);
  console.log(`Release plan is valid: all FlowKit packages target ${targetVersion}`);
}
