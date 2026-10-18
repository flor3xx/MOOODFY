import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_EMAIL_LENGTH,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  checkCredentials,
  messageFor,
} from "./auth-validation.ts";

const valid = { email: "tizio@example.com", password: "password-segreta" };

function errorFields(result: ReturnType<typeof checkCredentials>) {
  assert.equal(result.ok, false);
  return result.ok ? [] : result.errors.map((error) => `${error.field}:${error.code}`);
}

test("a valid set of credentials is accepted and the email is trimmed", () => {
  const result = checkCredentials({ email: "  tizio@example.com  ", password: "password-segreta" });
  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.deepEqual(result.value, valid);
});

test("a missing or blank email is required", () => {
  assert.deepEqual(errorFields(checkCredentials({ ...valid, email: "   " })), ["email:required"]);
  assert.deepEqual(errorFields(checkCredentials({ ...valid, email: undefined })), ["email:required"]);
  assert.deepEqual(errorFields(checkCredentials({ ...valid, email: 42 })), ["email:required"]);
});

test("an email without a domain or with spaces is invalid", () => {
  for (const email of ["tizio", "tizio@", "@example.com", "tizio @example.com", "tizio@example"]) {
    assert.deepEqual(errorFields(checkCredentials({ ...valid, email })), ["email:invalid"], email);
  }
});

test("an over-long email is rejected as too long", () => {
  const email = `${"a".repeat(MAX_EMAIL_LENGTH)}@example.com`;
  assert.deepEqual(errorFields(checkCredentials({ ...valid, email })), ["email:too_long"]);
});

test("passwords shorter than the minimum, or longer than the maximum, are rejected", () => {
  assert.deepEqual(
    errorFields(checkCredentials({ ...valid, password: "a".repeat(MIN_PASSWORD_LENGTH - 1) })),
    ["password:too_short"],
  );
  assert.deepEqual(
    errorFields(checkCredentials({ ...valid, password: "a".repeat(MAX_PASSWORD_LENGTH + 1) })),
    ["password:too_long"],
  );
});

test("passwords are not trimmed before the length check", () => {
  const padded = "  abcdef  "; // 10 characters, only 6 once trimmed
  const result = checkCredentials({ email: valid.email, password: padded });
  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.password, padded, "the password must be passed through unchanged");
});

test("sign-up requires the confirmation to match", () => {
  assert.deepEqual(
    errorFields(
      checkCredentials({
        email: valid.email,
        password: valid.password,
        confirmation: "password-sbagliata",
        requireConfirmation: true,
      }),
    ),
    ["confirmation:mismatch"],
  );
  assert.deepEqual(
    errorFields(
      checkCredentials({
        email: valid.email,
        password: valid.password,
        confirmation: "",
        requireConfirmation: true,
      }),
    ),
    ["confirmation:required"],
  );
  const matching = checkCredentials({
    email: valid.email,
    password: valid.password,
    confirmation: valid.password,
    requireConfirmation: true,
  });
  assert.equal(matching.ok, true);
});

test("sign-in ignores the confirmation field", () => {
  const result = checkCredentials({ ...valid, confirmation: "ignorata" });
  assert.equal(result.ok, true);
});

test("several problems are reported together", () => {
  assert.deepEqual(
    errorFields(checkCredentials({ email: "no", password: "corta", confirmation: "x", requireConfirmation: true })),
    ["email:invalid", "password:too_short", "confirmation:mismatch"],
  );
});

test("every error code has a message that never echoes the input", () => {
  const results = [
    checkCredentials({ email: "no", password: "x", confirmation: "y", requireConfirmation: true }),
    checkCredentials({ email: `${"a".repeat(MAX_EMAIL_LENGTH)}@example.com`, password: "password-ok" }),
    checkCredentials({ email: valid.email, password: "a".repeat(MAX_PASSWORD_LENGTH + 1) }),
  ];

  for (const result of results) {
    assert.equal(result.ok, false);
    if (result.ok) continue;
    for (const error of result.errors) {
      const message = messageFor(error);
      assert.ok(message.length > 0);
      assert.equal(message.includes("aaaa"), false, message);
    }
  }
});
