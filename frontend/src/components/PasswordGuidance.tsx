import { newPasswordError, passwordHint, passwordLength, passwordMinLength } from "../features/auth/passwordPolicy";
import "./password-guidance.css";

export function PasswordGuidance({ password, email, id }: { password: string; email: string; id: string }) {
  const error = password ? newPasswordError(password, email) : undefined;
  const missing = passwordMinLength - passwordLength(password);
  return (
    <span className="password-guidance" id={id}>
      <span className="password-guidance-hint">{passwordHint}</span>
      <span className="password-guidance-status" role="status" data-status={password ? error ? "invalid" : "valid" : "empty"}>
        {password ? error ? missing > 0 ? `还需 ${missing} 个字符` : error : "符合密码要求" : ""}
      </span>
    </span>
  );
}
