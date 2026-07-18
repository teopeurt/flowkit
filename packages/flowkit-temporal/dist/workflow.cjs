"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/workflow.ts
var workflow_exports = {};
__export(workflow_exports, {
  createFlowkitWorkflow: () => createFlowkitWorkflow
});
module.exports = __toCommonJS(workflow_exports);
var import_workflow = require("@temporalio/workflow");
var import_core3 = require("@flowkit/core");

// ../../node_modules/@noble/hashes/utils.js
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function abytes(value, length, title = "") {
  const bytes = isBytes(value);
  const len = value?.length;
  const needsLen = length !== void 0;
  if (!bytes || needsLen && len !== length) {
    const prefix = title && `"${title}" `;
    const ofLen = needsLen ? ` of length ${length}` : "";
    const got = bytes ? `length=${len}` : `type=${typeof value}`;
    throw new Error(prefix + "expected Uint8Array" + ofLen + ", got " + got);
  }
  return value;
}
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}
function aoutput(out, instance) {
  abytes(out, void 0, "digestInto() output");
  const min = instance.outputLen;
  if (out.length < min) {
    throw new Error('"digestInto() output" expected to be of length >=' + min);
  }
}
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
function rotr(word, shift) {
  return word << 32 - shift | word >>> shift;
}
var hasHexBuiltin = /* @__PURE__ */ (() => (
  // @ts-ignore
  typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function"
))();
var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
function bytesToHex(bytes) {
  abytes(bytes);
  if (hasHexBuiltin)
    return bytes.toHex();
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += hexes[bytes[i]];
  }
  return hex;
}
function createHasher(hashCons, info = {}) {
  const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
  const tmp = hashCons(void 0);
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = (opts) => hashCons(opts);
  Object.assign(hashC, info);
  return Object.freeze(hashC);
}
var oidNist = (suffix) => ({
  oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, suffix])
});

// ../../node_modules/@noble/hashes/_md.js
function Chi(a, b, c) {
  return a & b ^ ~a & c;
}
function Maj(a, b, c) {
  return a & b ^ a & c ^ b & c;
}
var HashMD = class {
  blockLen;
  outputLen;
  padOffset;
  isLE;
  // For partial updates less than block size
  buffer;
  view;
  finished = false;
  length = 0;
  pos = 0;
  destroyed = false;
  constructor(blockLen, outputLen, padOffset, isLE) {
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView(this.buffer);
  }
  update(data) {
    aexists(this);
    abytes(data);
    const { view, buffer, blockLen } = this;
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView(data);
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        continue;
      }
      buffer.set(data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
      }
    }
    this.length += data.length;
    this.roundClean();
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    clean(this.buffer.subarray(pos));
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      pos = 0;
    }
    for (let i = pos; i < blockLen; i++)
      buffer[i] = 0;
    view.setBigUint64(blockLen - 8, BigInt(this.length * 8), isLE);
    this.process(view, 0);
    const oview = createView(out);
    const len = this.outputLen;
    if (len % 4)
      throw new Error("_sha2: outputLen must be aligned to 32bit");
    const outLen = len / 4;
    const state = this.get();
    if (outLen > state.length)
      throw new Error("_sha2: outputLen bigger than state");
    for (let i = 0; i < outLen; i++)
      oview.setUint32(4 * i, state[i], isLE);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneInto(to) {
    to ||= new this.constructor();
    to.set(...this.get());
    const { blockLen, buffer, length, finished, destroyed, pos } = this;
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    if (length % blockLen)
      to.buffer.set(buffer);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
};
var SHA256_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);

// ../../node_modules/@noble/hashes/sha2.js
var SHA256_K = /* @__PURE__ */ Uint32Array.from([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var SHA256_W = /* @__PURE__ */ new Uint32Array(64);
var SHA2_32B = class extends HashMD {
  constructor(outputLen) {
    super(64, outputLen, 8, false);
  }
  get() {
    const { A, B, C, D, E, F, G, H } = this;
    return [A, B, C, D, E, F, G, H];
  }
  // prettier-ignore
  set(A, B, C, D, E, F, G, H) {
    this.A = A | 0;
    this.B = B | 0;
    this.C = C | 0;
    this.D = D | 0;
    this.E = E | 0;
    this.F = F | 0;
    this.G = G | 0;
    this.H = H | 0;
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4)
      SHA256_W[i] = view.getUint32(offset, false);
    for (let i = 16; i < 64; i++) {
      const W15 = SHA256_W[i - 15];
      const W2 = SHA256_W[i - 2];
      const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
      const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
      SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
    }
    let { A, B, C, D, E, F, G, H } = this;
    for (let i = 0; i < 64; i++) {
      const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
      const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
      const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
      const T2 = sigma0 + Maj(A, B, C) | 0;
      H = G;
      G = F;
      F = E;
      E = D + T1 | 0;
      D = C;
      C = B;
      B = A;
      A = T1 + T2 | 0;
    }
    A = A + this.A | 0;
    B = B + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    E = E + this.E | 0;
    F = F + this.F | 0;
    G = G + this.G | 0;
    H = H + this.H | 0;
    this.set(A, B, C, D, E, F, G, H);
  }
  roundClean() {
    clean(SHA256_W);
  }
  destroy() {
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
    clean(this.buffer);
  }
};
var _SHA256 = class extends SHA2_32B {
  // We cannot use array here since array allows indexing by variable
  // which means optimizer/compiler cannot use registers.
  A = SHA256_IV[0] | 0;
  B = SHA256_IV[1] | 0;
  C = SHA256_IV[2] | 0;
  D = SHA256_IV[3] | 0;
  E = SHA256_IV[4] | 0;
  F = SHA256_IV[5] | 0;
  G = SHA256_IV[6] | 0;
  H = SHA256_IV[7] | 0;
  constructor() {
    super(32);
  }
};
var sha256 = /* @__PURE__ */ createHasher(
  () => new _SHA256(),
  /* @__PURE__ */ oidNist(1)
);

// src/snapshot.ts
var import_core = require("@flowkit/core");
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
  const parsed = import_core.flowSchema.safeParse(definitionSnapshot);
  if (!parsed.success) {
    throw new SnapshotError("Definition snapshot fails schema validation.");
  }
}

// src/validation.ts
var import_core2 = require("@flowkit/core");
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

// src/workflow.ts
var stateView = (execution, definition) => ({
  state: execution.state,
  sequence: execution.sequence,
  stepResults: execution.stepResults,
  slaDeadline: execution.slaDeadline,
  completed: execution.completed,
  nextActions: execution.completed ? [] : (0, import_core3.getDeclaredActions)(definition, execution.state.stage)
});
var initialExecution = (input) => input.resume?.execution ?? {
  state: input.initialState ?? (0, import_core3.buildInitialState)(input.published.definitionSnapshot),
  sequence: 0,
  entryEpoch: 0,
  stepResults: {},
  completedInitialEntry: false,
  completed: false
};
var commandFailure = (error) => import_workflow.ApplicationFailure.nonRetryable(
  error instanceof Error ? error.message : "Flowkit command was rejected.",
  "FLOWKIT_COMMAND_REJECTED"
);
function createFlowkitWorkflow(config) {
  const query = (0, import_workflow.defineQuery)(config.queryName ?? "getState");
  const update = (0, import_workflow.defineUpdate)(config.updateName ?? "applyAction");
  const activities = (0, import_workflow.proxyActivities)({
    taskQueue: config.activityTaskQueue,
    startToCloseTimeout: "1 minute",
    ...config.activityOptions ?? {}
  });
  const aiActivities = (0, import_workflow.proxyActivities)({
    taskQueue: config.activityTaskQueue,
    startToCloseTimeout: "1 minute",
    retry: { maximumAttempts: 3 },
    ...config.activityOptions ?? {}
  });
  return async (input) => {
    verifyPublishedDefinition(input.published);
    const definition = input.published.definitionSnapshot;
    const definitionIdentity = {
      id: definition.id,
      version: definition.version,
      hash: input.published.definitionHash
    };
    const execution = initialExecution(input);
    const commands = [];
    let draining = false;
    let automaticTransitions = 0;
    const view = () => stateView(execution, definition);
    const adaptedView = () => config.adaptState?.({ state: view(), input }) ?? view();
    (0, import_workflow.setHandler)(query, view);
    (0, import_workflow.setHandler)(update, async (command) => {
      const updateId = (0, import_workflow.currentUpdateInfo)()?.id;
      if (!updateId) {
        throw import_workflow.ApplicationFailure.nonRetryable("A stable Temporal Update ID is required.", "FLOWKIT_MISSING_UPDATE_ID");
      }
      if (draining) {
        throw import_workflow.ApplicationFailure.nonRetryable("Workflow is draining.", "FLOWKIT_DRAINING");
      }
      const completion = new import_workflow.Trigger();
      commands.push({ operationId: updateId, origin: "human", command, completion });
      return await completion;
    });
    const runEntry = async (reason, priorTransition) => {
      if (definition.stages[execution.state.stage]?.final) {
        execution.completed = true;
        return;
      }
      for (const [index, step] of (definition.stages[execution.state.stage]?.entry ?? []).entries()) {
        const key = `${execution.entryEpoch}:${index}`;
        if (step.kind === "system") {
          const result = await activities.executeSystemStep({ ref: step.ref, definition: definitionIdentity, subject: input.subject, state: execution.state, entryEpoch: execution.entryEpoch, entryReason: reason, priorTransition });
          execution.stepResults[key] = { ref: step.ref, kind: "system", status: "completed", entryEpoch: execution.entryEpoch, output: result.output };
          continue;
        }
        if (step.kind === "ai") {
          try {
            const result = await aiActivities.executeAiStep({ ref: step.ref, definition: definitionIdentity, subject: input.subject, state: execution.state, entryEpoch: execution.entryEpoch, entryReason: reason, priorTransition });
            execution.stepResults[key] = { ref: step.ref, kind: "ai", status: "completed", entryEpoch: execution.entryEpoch, output: result.output };
          } catch {
            execution.stepResults[key] = { ref: step.ref, kind: "ai", status: "degraded_to_human", entryEpoch: execution.entryEpoch };
          }
          continue;
        }
        const action = config.registries.rules?.[step.ref]?.run({ definition, state: execution.state, subject: input.subject.metadata ?? {}, facts: {}, priorTransition });
        if (action) {
          if (automaticTransitions >= (config.maxAutomaticTransitionsPerTurn ?? 32)) {
            throw import_workflow.ApplicationFailure.nonRetryable("Automatic transition limit exceeded.", "FLOWKIT_AUTOMATIC_LOOP");
          }
          automaticTransitions += 1;
          commands.push({ operationId: `rule:${execution.entryEpoch}:${index}`, origin: "rule", command: { action, actorId: "system" } });
        }
      }
    };
    const armSla = async () => {
      const sla = definition.stages[execution.state.stage]?.sla;
      if (!sla) {
        execution.slaDeadline = void 0;
        return;
      }
      const duration = parseSlaDuration(sla.after);
      if (duration === void 0) {
        throw import_workflow.ApplicationFailure.nonRetryable(`Invalid SLA duration "${sla.after}".`, "FLOWKIT_INVALID_SLA");
      }
      execution.slaDeadline = Date.now() + duration;
      await activities.recordStageReady({ workflowId: (0, import_workflow.workflowInfo)().workflowId, definition: definitionIdentity, subject: input.subject, state: execution.state, entryEpoch: execution.entryEpoch, slaDeadline: execution.slaDeadline });
    };
    if (!execution.completedInitialEntry) {
      await runEntry("initial");
      execution.completedInitialEntry = true;
      await armSla();
    }
    while (!execution.completed) {
      const receivedCommand = execution.slaDeadline === void 0 ? (await (0, import_workflow.condition)(() => commands.length > 0), true) : await (0, import_workflow.condition)(() => commands.length > 0, Math.max(1, execution.slaDeadline - Date.now()));
      if (!receivedCommand) {
        const sla = definition.stages[execution.state.stage]?.sla;
        const deadline = execution.slaDeadline;
        execution.slaDeadline = void 0;
        if (sla?.escalate.notify) {
          try {
            await activities.dispatchNotification({ operationKey: `sla:${execution.entryEpoch}`, definition: definitionIdentity, subject: input.subject, notification: { template: sla.escalate.notify, channels: [] } });
          } catch {
          }
        }
        if (sla?.escalate.action) {
          commands.push({ operationId: `sla:${execution.entryEpoch}`, origin: "sla", command: { action: sla.escalate.action, actorId: "system" } });
        }
        if (deadline === void 0) continue;
      }
      const envelope = commands.shift();
      if (!envelope) {
        continue;
      }
      try {
        const stage = definition.stages[execution.state.stage];
        const action = stage?.actions?.[envelope.command.action];
        const expectedKind = envelope.origin === "human" ? "human" : "system";
        if (!action || (action.kind ?? "human") !== expectedKind) {
          throw new Error(`Action "${envelope.command.action}" is not a valid ${expectedKind} action from stage "${execution.state.stage}".`);
        }
        const context = await activities.resolveActionContext({
          workflowId: (0, import_workflow.workflowInfo)().workflowId,
          runId: (0, import_workflow.workflowInfo)().runId,
          operationId: envelope.operationId,
          origin: envelope.origin,
          definition: definitionIdentity,
          subject: input.subject,
          state: execution.state,
          command: envelope.command
        });
        if (context.priorResult) {
          execution.state = context.priorResult.state;
          envelope.completion?.resolve(adaptedView());
          continue;
        }
        const outcome = (0, import_core3.transition)(definition, execution.state, envelope.command, {
          actor: context.actor,
          facts: context.facts,
          subject: input.subject.metadata,
          policies: config.registries.policies,
          guards: config.registries.guards
        });
        const projected = await activities.recordTransition({
          workflowId: (0, import_workflow.workflowInfo)().workflowId,
          runId: (0, import_workflow.workflowInfo)().runId,
          operationId: envelope.operationId,
          sequence: execution.sequence + 1,
          origin: envelope.origin,
          definition: definitionIdentity,
          subject: input.subject,
          command: envelope.command,
          previousState: execution.state,
          nextState: outcome.state,
          transition: outcome.transition,
          notify: action.notify
        });
        execution.state = projected.state;
        execution.sequence += 1;
        execution.entryEpoch += 1;
        execution.completed = definition.stages[execution.state.stage]?.final === true;
        if (!execution.completed) {
          await runEntry("transition", outcome.transition);
          await armSla();
        }
        envelope.completion?.resolve(adaptedView());
      } catch (error) {
        if (!envelope.completion && error instanceof import_workflow.ApplicationFailure && error.type === "FLOWKIT_AUTOMATIC_LOOP") {
          throw error;
        }
        envelope.completion?.reject(error instanceof import_workflow.ApplicationFailure ? error : commandFailure(error));
      }
      if (!execution.completed && commands.length === 0 && ((0, import_workflow.workflowInfo)().continueAsNewSuggested || !input.resume && config.shouldContinueAsNew?.() === true)) {
        draining = true;
        await (0, import_workflow.condition)(import_workflow.allHandlersFinished);
        return await (0, import_workflow.continueAsNew)({
          published: input.published,
          subject: input.subject,
          initialState: input.initialState,
          resume: { execution }
        });
      }
    }
    draining = true;
    await (0, import_workflow.condition)(import_workflow.allHandlersFinished);
    return adaptedView();
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createFlowkitWorkflow
});
/*! Bundled license information:

@noble/hashes/utils.js:
  (*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) *)
*/
