import { describe, expect, it } from "vitest";
import { newPasswordError, passwordLength } from "./passwordPolicy";

describe("new password policy", () => {
  it.each(["x".repeat(7), "😀".repeat(7), "e\u0301".repeat(7)])("counts Unicode characters and rejects a short password", (password) => {
    expect(newPasswordError(password)).toBe("密码至少需要 8 个字符");
  });

  it("enforces the upper bound without truncating the input", () => {
    expect(newPasswordError("x".repeat(129))).toBe("密码不能超过 128 个字符");
  });

  it.each(["mV!8kP2z", "rkt9876543!", "x".repeat(128), "😀".repeat(8), "a phrase with spaces", "密码passwordpassword并非完整弱密码"])("accepts passwords at the length boundaries without character composition rules", (password) => {
    expect(newPasswordError(password)).toBeUndefined();
  });

  it("matches the whole weak password and account identity", () => {
    expect(newPasswordError("passwordpassword")).toMatch(/容易被猜到/);
    expect(newPasswordError("PASSWORDPASSWORD")).toMatch(/容易被猜到/);
    expect(newPasswordError("owner@example.com", "owner@example.com")).toMatch(/容易被猜到/);
    expect(newPasswordError("careerloop123456")).toMatch(/容易被猜到/);
    expect(newPasswordError("12345678")).toMatch(/容易被猜到/);
    expect(newPasswordError("password")).toMatch(/容易被猜到/);
    expect(newPasswordError("PASSWORD")).toMatch(/容易被猜到/);
    expect(newPasswordError("careerloop")).toMatch(/容易被猜到/);
  });

  it("uses NFC code point counts without trimming whitespace", () => {
    expect(passwordLength("e\u0301".repeat(8))).toBe(8);
    expect(newPasswordError("e\u0301".repeat(8))).toBeUndefined();
    expect(passwordLength(" a phrase with spaces ")).toBe(22);
  });
});
