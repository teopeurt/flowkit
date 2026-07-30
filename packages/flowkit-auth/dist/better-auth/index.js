var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/better-auth/config.ts
function validateBetterAuthOptions(options) {
  if (!options.secret.trim() || options.secret.length < 32) throw new Error("BetterAuth secret must be at least 32 characters");
  if (options.environment === "production" && options.trustedOrigins.some((origin) => origin.includes("localhost"))) throw new Error("Localhost trusted origins are not allowed in production");
  return Object.freeze({
    ...options,
    basePath: options.basePath ?? "/api/auth",
    enabled: options.enabled ?? true
  });
}
__name(validateBetterAuthOptions, "validateBetterAuthOptions");

// src/better-auth/runtime.ts
function createAuthRuntime(options) {
  const config = validateBetterAuthOptions(options);
  return Object.freeze({
    config,
    enabled: config.enabled,
    getOptions: /* @__PURE__ */ __name(() => config, "getOptions")
  });
}
__name(createAuthRuntime, "createAuthRuntime");
var createBetterAuthRuntime = createAuthRuntime;

// src/better-auth/hooks.ts
function composeAuthHooks(required, extensions = []) {
  return async (context) => {
    for (const hook of [
      ...required,
      ...extensions
    ]) await hook(context);
  };
}
__name(composeAuthHooks, "composeAuthHooks");

// src/better-auth/phone-policy.ts
function createPhonePolicy(input) {
  const callingCode = input.callingCode.replace(/^\+/, "");
  const trunk = input.trunkPrefix ?? "0";
  return Object.freeze({
    normalize(value) {
      let raw = value.replace(/[\s()-]/g, "");
      if (raw.startsWith("+")) return `+${raw.slice(1)}`;
      if (raw.startsWith(trunk)) raw = raw.slice(trunk.length);
      return `+${callingCode}${raw}`;
    },
    isValid(value) {
      return input.nationalNumber.test(value.replace(/[\s()-]/g, "").replace(new RegExp(`^\\+${callingCode}`), "").replace(new RegExp(`^${trunk}`), ""));
    }
  });
}
__name(createPhonePolicy, "createPhonePolicy");
function createCustomPhonePolicy(normalize, isValid) {
  return Object.freeze({
    normalize,
    isValid
  });
}
__name(createCustomPhonePolicy, "createCustomPhonePolicy");

// src/errors.ts
var AuthError = class extends Error {
  static {
    __name(this, "AuthError");
  }
  code;
  details;
  name;
  constructor(code, message, details) {
    super(message), this.code = code, this.details = details, this.name = "AuthError";
  }
};

// src/better-auth/otp-intents.ts
function createOtpIntentRegistry(intents) {
  const map = new Map(intents.map((intent) => [
    intent.name,
    intent
  ]));
  return Object.freeze({
    async authorize(input) {
      const found = map.get(input.intent);
      if (!found) return {
        ok: false,
        error: new AuthError("permission_denied", "Unknown OTP intent")
      };
      const result = await found.authorize({
        identity: input.identity,
        context: input.context ?? {}
      });
      return result.allowed ? {
        ok: true,
        value: {
          reason: result.reason
        }
      } : {
        ok: false,
        error: new AuthError("permission_denied", result.reason)
      };
    }
  });
}
__name(createOtpIntentRegistry, "createOtpIntentRegistry");

// src/better-auth/test-otp.ts
import { timingSafeEqual } from "crypto";
function parseTestOtpCodes(environment, values) {
  if (environment === "production" && values && Object.keys(values).length) throw new Error("Fixed OTP codes are not allowed in production");
  return Object.freeze({
    ...values ?? {}
  });
}
__name(parseTestOtpCodes, "parseTestOtpCodes");
function matchesTestOtp(expected, actual) {
  if (!expected || expected.length !== actual.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}
__name(matchesTestOtp, "matchesTestOtp");
export {
  composeAuthHooks,
  createAuthRuntime,
  createBetterAuthRuntime,
  createCustomPhonePolicy,
  createOtpIntentRegistry,
  createPhonePolicy,
  matchesTestOtp,
  parseTestOtpCodes,
  validateBetterAuthOptions
};
