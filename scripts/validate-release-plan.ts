import { checkLockstepVersions } from "./check-lockstep-versions";

export const flowKitPackages = [
  "@teopeurt/flowkit-auth",
  "@teopeurt/flowkit-consumer",
  "@teopeurt/flowkit-core",
  "@teopeurt/flowkit-definitions",
  "@teopeurt/flowkit-notify",
  "@teopeurt/flowkit-tasks",
  "@teopeurt/flowkit-temporal",
] as const;

const initialReleaseVersion = "1.0.0";
const flowKitPackageDirectories = [
  "auth",
  "consumer",
  "core",
  "definitions",
  "notify",
  "tasks",
  "temporal",
];

type PublishRelease = { kind?: unknown; name?: unknown; version?: unknown };
type PublishPlan = { version?: unknown; plan?: unknown };

export function validateReleasePlan(
  publishPlan: PublishPlan,
  expectedVersion = initialReleaseVersion,
): string {
  if (publishPlan.version !== 1 || !Array.isArray(publishPlan.plan)) {
    throw new Error("Release plan must be a Changesets publish plan");
  }

  const releases = publishPlan.plan.flat() as PublishRelease[];
  if (releases.some((release) => release.kind !== "publish" || typeof release.name !== "string")) {
    throw new Error("Release plan must include exactly the seven FlowKit packages");
  }

  const expectedNames = new Set<string>(flowKitPackages);
  const actualNames = new Set(releases.map((release) => release.name as string));
  if (
    releases.length !== flowKitPackages.length ||
    actualNames.size !== flowKitPackages.length ||
    [...actualNames].some((name) => !expectedNames.has(name)) ||
    flowKitPackages.some((name) => !actualNames.has(name))
  ) {
    throw new Error("Release plan must include exactly the seven FlowKit packages");
  }

  if (releases.some((release) => release.version !== expectedVersion)) {
    throw new Error(`Release plan must target ${expectedVersion}`);
  }

  return expectedVersion;
}

if (import.meta.main) {
  const releasePlanPath = Bun.argv[2] ?? ".changeset/release-plan.json";
  const releasePlan = JSON.parse(await Bun.file(releasePlanPath).text()) as PublishPlan;
  const manifests = await Promise.all(
    flowKitPackageDirectories.map(async (directory) => {
      const manifest = (await Bun.file(`packages/${directory}/package.json`).json()) as {
        name: string;
        version: string;
      };
      return manifest;
    }),
  );
  const targetVersion = validateReleasePlan(releasePlan, checkLockstepVersions(manifests));
  console.log(`Release plan is valid: all FlowKit packages target ${targetVersion}`);
}
