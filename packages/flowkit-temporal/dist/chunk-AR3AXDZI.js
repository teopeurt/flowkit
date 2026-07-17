// src/snapshot.ts
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { defineFlow, flowSchema } from "@flowkit/core";
var SnapshotError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "SnapshotError";
  }
};
var HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
var isPlainObject = (value) => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
function canonicalizeJson(value) {
  const write = (current) => {
    if (current === null) {
      return "null";
    }
    switch (typeof current) {
      case "string":
        return JSON.stringify(current);
      case "boolean":
        return current ? "true" : "false";
      case "number": {
        if (!Number.isFinite(current)) {
          throw new SnapshotError("Canonical JSON rejects non-finite numbers.");
        }
        return JSON.stringify(current);
      }
      case "object": {
        if (Array.isArray(current)) {
          return `[${current.map((item) => write(item)).join(",")}]`;
        }
        if (!isPlainObject(current)) {
          throw new SnapshotError("Canonical JSON only accepts plain objects.");
        }
        const entries = Object.keys(current).sort().map((key) => {
          const item = current[key];
          if (item === void 0) {
            throw new SnapshotError(`Canonical JSON rejects undefined at key "${key}".`);
          }
          return `${JSON.stringify(key)}:${write(item)}`;
        });
        return `{${entries.join(",")}}`;
      }
      default:
        throw new SnapshotError(`Canonical JSON rejects ${typeof current} values.`);
    }
  };
  return write(value);
}
var encodeUtf8 = (input) => {
  const bytes = [];
  for (let index = 0; index < input.length; index += 1) {
    let code = input.charCodeAt(index);
    if (code >= 55296 && code <= 56319 && index + 1 < input.length) {
      const next = input.charCodeAt(index + 1);
      if (next >= 56320 && next <= 57343) {
        code = 65536 + (code - 55296 << 10) + (next - 56320);
        index += 1;
      }
    }
    if (code < 128) {
      bytes.push(code);
    } else if (code < 2048) {
      bytes.push(192 | code >> 6, 128 | code & 63);
    } else if (code < 65536) {
      bytes.push(224 | code >> 12, 128 | code >> 6 & 63, 128 | code & 63);
    } else {
      bytes.push(
        240 | code >> 18,
        128 | code >> 12 & 63,
        128 | code >> 6 & 63,
        128 | code & 63
      );
    }
  }
  return Uint8Array.from(bytes);
};
function hashCanonicalJson(canonical) {
  return `sha256:${bytesToHex(sha256(encodeUtf8(canonical)))}`;
}
var deepFreeze = (value) => {
  if (typeof value === "object" && value !== null) {
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
    Object.freeze(value);
  }
  return value;
};
function publishDefinition(args) {
  const parsed = defineFlow(args.definition);
  const canonical = canonicalizeJson(parsed);
  const snapshot = deepFreeze(JSON.parse(canonical));
  return {
    definitionSnapshot: snapshot,
    definitionHash: hashCanonicalJson(canonical)
  };
}
function verifyPublishedDefinition(published) {
  if (!published || typeof published !== "object") {
    throw new SnapshotError("Published definition must be an object.");
  }
  const { definitionSnapshot, definitionHash } = published;
  if (typeof definitionHash !== "string" || !HASH_PATTERN.test(definitionHash)) {
    throw new SnapshotError(
      'Definition hash must be "sha256:" followed by 64 lowercase hex characters.'
    );
  }
  const actual = hashCanonicalJson(canonicalizeJson(definitionSnapshot));
  if (actual !== definitionHash) {
    throw new SnapshotError("Definition snapshot does not match its content hash.");
  }
  const parsed = flowSchema.safeParse(definitionSnapshot);
  if (!parsed.success) {
    throw new SnapshotError("Definition snapshot fails schema validation.");
  }
}

// src/validation.ts
import { flowSchema as flowSchema2, lintInterpreterFlow } from "@flowkit/core";
var FlowkitValidationError = class extends Error {
  constructor(issues) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
    this.issues = issues;
    this.name = "FlowkitValidationError";
  }
  issues;
};
var durationUnits = {
  ms: 1,
  s: 1e3,
  m: 6e4,
  h: 36e5,
  d: 864e5
};
function parseSlaDuration(input) {
  const parts = input.match(/(\d+)(ms|s|m|h|d)/g);
  if (!parts || parts.join("") !== input) {
    return void 0;
  }
  const milliseconds = parts.reduce((total, part) => {
    const match = /^(\d+)(ms|s|m|h|d)$/.exec(part);
    if (!match) {
      return Number.NaN;
    }
    return total + Number(match[1]) * durationUnits[match[2]];
  }, 0);
  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : void 0;
}
var pathFor = (...parts) => parts.join(".");
var pushIssue = (issues, code, path, message) => {
  issues.push({ code, path, message });
};
var validateEntryRefs = (definition, registries, issues) => {
  for (const [stageName, stage] of Object.entries(definition.stages)) {
    for (const [index, step] of (stage.entry ?? []).entries()) {
      const path = pathFor("stages", stageName, "entry", index, "ref");
      if (step.kind === "system" && !registries.systemSteps?.[step.ref]) {
        pushIssue(issues, "missing-system-step-ref", path, `Missing system step ref "${step.ref}".`);
      }
      if (step.kind === "ai" && !registries.aiSteps?.[step.ref]) {
        pushIssue(issues, "missing-ai-step-ref", path, `Missing AI step ref "${step.ref}".`);
      }
      if (step.kind !== "rule") {
        continue;
      }
      const rule = registries.rules?.[step.ref];
      if (!rule) {
        pushIssue(issues, "missing-rule-ref", path, `Missing rule ref "${step.ref}".`);
        continue;
      }
      for (const actionName of rule.actions) {
        const action = stage.actions?.[actionName];
        const actionPath = pathFor("stages", stageName, "actions", actionName);
        if (!action) {
          pushIssue(
            issues,
            "rule-action-unavailable",
            actionPath,
            `Rule "${step.ref}" may return "${actionName}", which is unavailable from stage "${stageName}".`
          );
          continue;
        }
        if ((action.kind ?? "human") !== "system") {
          pushIssue(
            issues,
            "rule-action-not-system",
            actionPath,
            `Rule "${step.ref}" may return human action "${actionName}". Rules may target only system actions.`
          );
        }
      }
    }
  }
};
var validateActionRefs = (definition, registries, issues) => {
  for (const [stageName, stage] of Object.entries(definition.stages)) {
    for (const [actionName, action] of Object.entries(stage.actions ?? {})) {
      const actionPath = pathFor("stages", stageName, "actions", actionName);
      if (action.policy && !registries.policies?.[action.policy]) {
        pushIssue(
          issues,
          "missing-policy-ref",
          `${actionPath}.policy`,
          `Missing policy ref "${action.policy}".`
        );
      }
      for (const guard of action.guards ?? []) {
        if (!registries.guards?.[guard]) {
          pushIssue(
            issues,
            "missing-guard-ref",
            `${actionPath}.guards`,
            `Missing guard ref "${guard}".`
          );
        }
      }
      if (action.notify?.template && !registries.templates?.[action.notify.template]) {
        pushIssue(
          issues,
          "missing-template-ref",
          `${actionPath}.notify.template`,
          `Missing template ref "${action.notify.template}".`
        );
      }
      for (const channel of action.notify?.channels ?? []) {
        if (!registries.channels?.[channel]) {
          pushIssue(
            issues,
            "missing-channel-ref",
            `${actionPath}.notify.channels`,
            `Missing channel ref "${channel}".`
          );
        }
      }
    }
  }
};
var validateStageScheduling = (definition, issues) => {
  for (const [stageName, stage] of Object.entries(definition.stages)) {
    if (stage.sla && parseSlaDuration(stage.sla.after) === void 0) {
      pushIssue(
        issues,
        "invalid-sla-duration",
        pathFor("stages", stageName, "sla", "after"),
        `Stage "${stageName}" SLA duration "${stage.sla.after}" must be positive and use ms, s, m, h, or d units.`
      );
    }
    if (stage.final && ((stage.entry?.length ?? 0) > 0 || stage.sla)) {
      pushIssue(
        issues,
        "final-stage-schedules-work",
        pathFor("stages", stageName),
        `Final stage "${stageName}" cannot declare entry work or an SLA.`
      );
    }
  }
};
function validateFlowkit(args) {
  const issues = [];
  try {
    verifyPublishedDefinition(args.published);
  } catch (error) {
    pushIssue(
      issues,
      "invalid-definition-hash",
      "definitionHash",
      error instanceof Error ? error.message : "Definition hash verification failed."
    );
  }
  const schema = flowSchema2.safeParse(args.published.definitionSnapshot);
  if (!schema.success) {
    for (const issue of schema.error.issues) {
      pushIssue(
        issues,
        "schema-error",
        issue.path.length > 0 ? issue.path.join(".") : "<root>",
        issue.message
      );
    }
    return issues;
  }
  for (const issue of lintInterpreterFlow(schema.data)) {
    if (issue.severity === "error") {
      pushIssue(issues, issue.code, issue.path, issue.message);
    }
  }
  validateActionRefs(schema.data, args.registries, issues);
  validateEntryRefs(schema.data, args.registries, issues);
  validateStageScheduling(schema.data, issues);
  return issues;
}
function assertValidFlowkit(args) {
  const issues = validateFlowkit(args);
  if (issues.length > 0) {
    throw new FlowkitValidationError(issues);
  }
}

export {
  SnapshotError,
  canonicalizeJson,
  hashCanonicalJson,
  publishDefinition,
  verifyPublishedDefinition,
  FlowkitValidationError,
  parseSlaDuration,
  validateFlowkit,
  assertValidFlowkit
};
