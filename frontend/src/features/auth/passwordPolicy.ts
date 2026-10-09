import policy from "../../../../backend/app/password_policy.json";

export const passwordMinLength = policy.minLength;
export const passwordMaxLength = policy.maxLength;
export const legacyPasswordMaxLength = policy.legacyMaxLength;
export const passwordHint = policy.hint;
const blockedPasswords = new Set(policy.blocklist);

export function passwordLength(password: string): number {
  return Array.from(password.normalize("NFC")).length;
}

export function newPasswordError(password: string, email = ""): string | undefined {
  const normalized = password.normalize("NFC");
  const length = passwordLength(normalized);
  if (length < passwordMinLength) return `密码至少需要 ${passwordMinLength} 个字符`;
  if (length > passwordMaxLength) return `密码不能超过 ${passwordMaxLength} 个字符`;
  const identity = email.trim().normalize("NFC").toLowerCase();
  const lower = normalized.toLowerCase();
  if (blockedPasswords.has(lower) || lower === identity || lower === identity.split("@")[0]) return policy.weakMessage;
  return undefined;
}
