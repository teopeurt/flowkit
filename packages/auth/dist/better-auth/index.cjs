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

// src/better-auth/index.ts
var better_auth_exports = {};
__export(better_auth_exports, {
  composeAuthHooks: () => composeAuthHooks,
  createAuthRuntime: () => createAuthRuntime,
  createBetterAuthRuntime: () => createBetterAuthRuntime,
  createCustomPhonePolicy: () => createCustomPhonePolicy,
  createOtpIntentRegistry: () => createOtpIntentRegistry,
  createPhonePolicy: () => createPhonePolicy,
  matchesTestOtp: () => matchesTestOtp,
  parseTestOtpCodes: () => parseTestOtpCodes,
  validateBetterAuthOptions: () => validateBetterAuthOptions
});
module.exports = __toCommonJS(better_auth_exports);

// src/better-auth/config.ts
function validateBetterAuthOptions(options) {
  if (!options.secret.trim() || options.secret.length < 32) throw new Error("BetterAuth secret must be at least 32 characters");
  if (options.environment === "production" && options.trustedOrigins.some((origin) => origin.includes("localhost"))) throw new Error("Localhost trusted origins are not allowed in production");
  return Object.freeze({ ...options, basePath: options.basePath ?? "/api/auth", enabled: options.enabled ?? true });
}

// src/better-auth/runtime.ts
function createAuthRuntime(options) {
  const config = validateBetterAuthOptions(options);
  return Object.freeze({ config, enabled: config.enabled, getOptions: () => config });
}
var createBetterAuthRuntime = createAuthRuntime;

// src/better-auth/hooks.ts
function composeAuthHooks(required, extensions = []) {
  return async (context) => {
    for (const hook of [...required, ...extensions]) await hook(context);
  };
}

// src/better-auth/phone-policy.ts
function createPhonePolicy(input) {
  const callingCode = input.callingCode.replace(/^\+/, "");
  const trunk = input.trunkPrefix ?? "0";
  return Object.freeze({ normalize(value) {
    let raw = value.replace(/[\s()-]/g, "");
    if (raw.startsWith("+")) return `+${raw.slice(1)}`;
    if (raw.startsWith(trunk)) raw = raw.slice(trunk.length);
    return `+${callingCode}${raw}`;
  }, isValid(value) {
    return input.nationalNumber.test(value.replace(/[\s()-]/g, "").replace(new RegExp(`^\\+${callingCode}`), "").replace(new RegExp(`^${trunk}`), ""));
  } });
}
function createCustomPhonePolicy(normalize, isValid) {
  return Object.freeze({ normalize, isValid });
}

// src/errors.ts
var AuthError = class extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
  code;
  details;
  name = "AuthError";
};

// src/better-auth/otp-intents.ts
function createOtpIntentRegistry(intents) {
  const map = new Map(intents.map((intent) => [intent.name, intent]));
  return Object.freeze({ async authorize(input) {
    const found = map.get(input.intent);
    if (!found) return { ok: false, error: new AuthError("permission_denied", "Unknown OTP intent") };
    const result = await found.authorize({ identity: input.identity, context: input.context ?? {} });
    return result.allowed ? { ok: true, value: { reason: result.reason } } : { ok: false, error: new AuthError("permission_denied", result.reason) };
  } });
}

// src/better-auth/test-otp.ts
var import_node_crypto = require("crypto");
function parseTestOtpCodes(environment, values) {
  if (environment === "production" && values && Object.keys(values).length) throw new Error("Fixed OTP codes are not allowed in production");
  return Object.freeze({ ...values ?? {} });
}
function matchesTestOtp(expected, actual) {
  if (!expected || expected.length !== actual.length) return false;
  return (0, import_node_crypto.timingSafeEqual)(Buffer.from(expected), Buffer.from(actual));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  composeAuthHooks,
  createAuthRuntime,
  createBetterAuthRuntime,
  createCustomPhonePolicy,
  createOtpIntentRegistry,
  createPhonePolicy,
  matchesTestOtp,
  parseTestOtpCodes,
  validateBetterAuthOptions
});
