import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { createApiClient } from "../api/client";
import "./auth-gate.css";

type AuthConfig = { enabled: boolean; setup_required: boolean };
type AuthSession = { access_token: string; user: { email: string } };
type Captcha = { captcha_id: string; svg: string; accessible_text?: string };
type FieldErrors = { email?: string; password?: string; passwordConfirmation?: string; captcha?: string };
type LoginIssue = { kind: "captcha" | "credentials" | "network" | "throttled" | "generic"; message: string; field?: keyof FieldErrors };

const sessionStorageKey = "bosscopilot-auth-token";
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const successPauseMs = 320;

function normalizeCaptchaCode(value: string) {
  return value.replace(/\s+/g, "").toUpperCase().slice(0, 5);
}

function classifyLoginError(reason: unknown, setupRequired: boolean): LoginIssue {
  const message = reason instanceof Error ? reason.message : "登录失败，请稍后重试";
  const endpoint = setupRequired ? "/auth/bootstrap" : "/auth/login";
  if (/failed to fetch|networkerror|load failed|网络|无法连接|请求超时/i.test(message)) {
    return { kind: "network", message: "网络已断开，请检查连接后点重新连接。" };
  }
  if (message.includes("次数过多") || message.includes(`${endpoint} 请求失败（429）`)) {
    return { kind: "throttled", message: message.includes("请在") ? message : "登录失败次数过多，请稍后再试。" };
  }
  if (message.includes("验证码") || message.includes(`${endpoint} 请求失败（422）`)) {
    return { kind: "captcha", message: "验证码不正确或已过期，已为你更换，请重新输入。", field: "captcha" };
  }
  if (message.includes("邮箱或密码") || message.includes(`${endpoint} 请求失败（401）`)) {
    return { kind: "credentials", message: "邮箱或密码不正确，请核对后重试。验证码已更新。", field: "password" };
  }
  return { kind: "generic", message };
}

function validateLoginFields(input: {
  email: string;
  password: string;
  passwordConfirmation: string;
  captcha: Captcha | null;
  captchaCode: string;
  setupRequired: boolean;
}): FieldErrors {
  const next: FieldErrors = {};
  if (!input.email.trim()) next.email = "请输入邮箱";
  else if (!emailPattern.test(input.email.trim())) next.email = "请输入有效的邮箱地址";
  if (!input.password) next.password = "请输入密码";
  else if (input.password.length < 8) next.password = "密码至少 8 位";
  if (input.setupRequired) {
    if (!input.passwordConfirmation) next.passwordConfirmation = "请再次输入密码";
    else if (input.password !== input.passwordConfirmation) next.passwordConfirmation = "两次输入的密码不一致";
  }
  if (!input.captcha) next.captcha = "验证码正在加载，请稍后再试";
  else if (normalizeCaptchaCode(input.captchaCode).length !== 5) next.captcha = "请输入图中的 5 位验证码";
  return next;
}

export function AuthGate({ apiBase, children }: { apiBase: string; children: (accessToken: string, onLogout: () => void) => ReactNode }) {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [token, setToken] = useState<string | null>(() => window.sessionStorage.getItem(sessionStorageKey));
  const [validatedToken, setValidatedToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [captcha, setCaptcha] = useState<Captcha | null>(null);
  const [captchaCode, setCaptchaCode] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [captchaRefreshing, setCaptchaRefreshing] = useState(false);
  const [bootNonce, setBootNonce] = useState(0);
  const [error, setError] = useState("");
  const [errorKind, setErrorKind] = useState<LoginIssue["kind"] | "">("");
  const [entering, setEntering] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const emailInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const passwordConfirmationRef = useRef<HTMLInputElement>(null);
  const captchaInputRef = useRef<HTMLInputElement>(null);

  const refreshCaptcha = useCallback(async () => {
    setCaptchaCode("");
    setCaptchaRefreshing(true);
    try {
      const nextCaptcha = await createApiClient(apiBase)<Captcha>("/auth/captcha");
      setCaptcha(nextCaptcha);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "验证码加载失败，请重试");
    } finally {
      setCaptchaRefreshing(false);
    }
  }, [apiBase]);

  useEffect(() => {
    // A saved token is sufficient to start validation. The configuration is
    // only needed for the sign-in form, so fetching it here adds a round trip
    // to every returning visitor's critical path.
    if (token) return;
    void createApiClient(apiBase)<AuthConfig>("/auth/config")
      .then((next) => {
        setConfig(next);
        setError("");
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "无法连接登录服务"));
  }, [apiBase, token, bootNonce]);

  useEffect(() => {
    // A returning, signed-in visitor never sees the login form. Avoid a
    // needless uncached captcha request on every app refresh.
    if (token) return;
    void refreshCaptcha();
  }, [refreshCaptcha, token]);

  useEffect(() => {
    if (!token || token === validatedToken) return;
    void createApiClient(apiBase, token)<{ user: { email: string } }>("/auth/me")
      .then(() => setValidatedToken(token))
      .catch(() => {
        window.sessionStorage.removeItem(sessionStorageKey);
        setToken(null);
        setValidatedToken(null);
      });
  }, [apiBase, token, validatedToken]);

  function focusFirstInvalid(next: FieldErrors) {
    if (next.email) emailInputRef.current?.focus();
    else if (next.password) passwordInputRef.current?.focus();
    else if (next.passwordConfirmation) passwordConfirmationRef.current?.focus();
    else if (next.captcha) captchaInputRef.current?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const nextFields = validateLoginFields({
      email,
      password,
      passwordConfirmation,
      captcha,
      captchaCode,
      setupRequired: Boolean(config?.setup_required)
    });
    setFieldErrors(nextFields);
    if (Object.keys(nextFields).length) {
      setError("");
      focusFirstInvalid(nextFields);
      return;
    }
    if (!captcha) return;
    setBusy(true);
    setError("");
    setErrorKind("");
    try {
      const session = await createApiClient(apiBase)<AuthSession>(config?.setup_required ? "/auth/bootstrap" : "/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, captcha_id: captcha.captcha_id, captcha_code: normalizeCaptchaCode(captchaCode) })
      });
      window.sessionStorage.setItem(sessionStorageKey, session.access_token);
      setEntering(true);
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        await new Promise((resolve) => window.setTimeout(resolve, successPauseMs));
      }
      setPassword("");
      setPasswordConfirmation("");
      setToken(session.access_token);
      setValidatedToken(session.access_token);
    } catch (reason) {
      const issue = classifyLoginError(reason, Boolean(config?.setup_required));
      setError(issue.message);
      setErrorKind(issue.kind);
      setFieldErrors(issue.field ? { [issue.field]: issue.message } : {});
      await refreshCaptcha();
      if (issue.kind === "captcha") captchaInputRef.current?.focus();
      else if (issue.kind === "credentials") passwordInputRef.current?.focus();
    } finally {
      setBusy(false);
      setEntering(false);
    }
  }

  function logout() {
    window.sessionStorage.removeItem(sessionStorageKey);
    setValidatedToken(null);
    setToken(null);
  }
  if (token && token !== validatedToken) {
    return <AuthStatus message="正在验证登录状态…" />;
  }
  if (token) {
    return <>
      {children(token, logout)}
    </>;
  }
  if (error && !config) {
    return <AuthStatus message={error} alert onRetry={() => { setError(""); setBootNonce((value) => value + 1); void refreshCaptcha(); }} />;
  }
  if (!config) return <AuthStatus message="正在连接登录服务…" />;
  const confirmMismatch = Boolean(config.setup_required && passwordConfirmation && password !== passwordConfirmation);
  return (
    <main className="auth-gate">
      <AuthAtmosphere />
      <div className="auth-shell">
        <aside className="auth-intro" aria-label="CareerLoop 如何帮助求职">
          <p className="auth-intro-kicker">把求职变成可持续推进的过程</p>
          <h2>从真实经历出发，准备每一次机会。</h2>
          <p>CareerLoop 帮你整理职业证据、判断岗位匹配，并把面试复盘沉淀为下一次的准备。</p>
          <ol className="auth-intro-steps">
            <li>验证身份</li>
            <li>进入求职系统</li>
            <li>登录只在当前标签页</li>
          </ol>
          <ul>
            <li><strong>有据可循</strong><span>每份建议回到你的经历与岗位要求。</span></li>
            <li><strong>始终可控</strong><span>联网研究和资料使用均由你决定。</span></li>
            <li><strong>注重隐私</strong><span>先处理敏感信息，再用于后续分析。</span></li>
          </ul>
        </aside>

        <form className="auth-card" onSubmit={submit} noValidate aria-busy={busy}>
          <div className="auth-brand">
            <img className="auth-logo" src="/careerloop-mark-v2.png" alt="" />
            <div className="auth-brand-copy">
              <p className="auth-eyebrow">CAREERLOOP</p>
              <p className="auth-brand-line">职业成长助手</p>
            </div>
          </div>
          <header className="auth-card-header">
            <h1>{config.setup_required ? "创建管理员账户" : "登录继续你的求职计划"}</h1>
            <p>{config.setup_required ? "首次使用，请先创建唯一的本地管理员账户。" : "使用账户进入你的职业成长工作台。"}</p>
            <p className="auth-card-path">验证身份 → 进入求职系统，登录只在当前标签页。</p>
          </header>
          <div className="auth-fields">
            <div className="auth-field">
              <label htmlFor="auth-email">邮箱</label>
              <input
                id="auth-email"
                ref={emailInputRef}
                type="email"
                name="username"
                autoComplete="username"
                autoFocus
                placeholder="name@example.com"
                value={email}
                disabled={busy}
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={fieldErrors.email ? "auth-email-error" : undefined}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (fieldErrors.email) setFieldErrors((current) => ({ ...current, email: undefined }));
                }}
              />
              {fieldErrors.email ? <small id="auth-email-error" className="auth-field-error">{fieldErrors.email}</small> : null}
            </div>
            <div className="auth-field">
              <label htmlFor="auth-password">密码</label>
              <span className="auth-password-field">
                <input
                  id="auth-password"
                  ref={passwordInputRef}
                  type={passwordVisible ? "text" : "password"}
                  name="password"
                  minLength={8}
                  autoComplete={config.setup_required ? "new-password" : "current-password"}
                  placeholder="至少 8 位"
                  value={password}
                  disabled={busy}
                  aria-invalid={Boolean(fieldErrors.password)}
                  aria-describedby={fieldErrors.password ? "auth-password-error" : undefined}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    if (fieldErrors.password) setFieldErrors((current) => ({ ...current, password: undefined }));
                  }}
                />
                <button
                  className="auth-show-password"
                  type="button"
                  aria-label={passwordVisible ? "隐藏密码" : "显示密码"}
                  aria-pressed={passwordVisible}
                  aria-controls="auth-password"
                  onClick={() => setPasswordVisible((visible) => !visible)}
                >
                  {passwordVisible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                </button>
              </span>
              {fieldErrors.password ? <small id="auth-password-error" className="auth-field-error" role="alert">{fieldErrors.password}</small> : null}
            </div>
            {config.setup_required ? (
              <div className="auth-field">
                <label htmlFor="auth-password-confirm">确认密码</label>
                <span className="auth-password-field">
                  <input
                    id="auth-password-confirm"
                    ref={passwordConfirmationRef}
                    type={passwordVisible ? "text" : "password"}
                    minLength={8}
                    autoComplete="new-password"
                    placeholder="再次输入密码"
                    value={passwordConfirmation}
                    disabled={busy}
                    aria-invalid={Boolean(fieldErrors.passwordConfirmation || confirmMismatch)}
                    aria-describedby={fieldErrors.passwordConfirmation || confirmMismatch ? "auth-password-confirm-error" : undefined}
                    onChange={(event) => {
                      setPasswordConfirmation(event.target.value);
                      if (fieldErrors.passwordConfirmation) setFieldErrors((current) => ({ ...current, passwordConfirmation: undefined }));
                    }}
                  />
                </span>
                {fieldErrors.passwordConfirmation || confirmMismatch ? <small id="auth-password-confirm-error" className="auth-field-error">{fieldErrors.passwordConfirmation || "两次输入的密码不一致"}</small> : null}
              </div>
            ) : null}
            <div className="auth-field">
              <label htmlFor="auth-captcha">验证码</label>
              <span className="auth-captcha-row">
                {captcha && !captchaRefreshing ? (
                  <button className="auth-captcha-preview" type="button" onClick={() => void refreshCaptcha()} disabled={busy} aria-label="点击更换验证码">
                    <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(captcha.svg)}`} alt="图形验证码" />
                  </button>
                ) : <span className="auth-captcha-preview auth-captcha-skeleton" aria-hidden="true" />}
                <span className="auth-captcha-entry">
                  <input
                    id="auth-captcha"
                    ref={captchaInputRef}
                    className="auth-captcha-input"
                    type="text"
                    name="captcha"
                    inputMode="text"
                    autoComplete="off"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="go"
                    minLength={5}
                    maxLength={5}
                    placeholder="输入 5 位字符"
                    aria-invalid={Boolean(fieldErrors.captcha)}
                    aria-describedby={fieldErrors.captcha ? "auth-captcha-error" : undefined}
                    value={captchaCode}
                    disabled={busy}
                    onChange={(event) => {
                      setCaptchaCode(normalizeCaptchaCode(event.target.value));
                      if (fieldErrors.captcha) setFieldErrors((current) => ({ ...current, captcha: undefined }));
                    }}
                  />
                  <button className="auth-refresh-captcha" type="button" onClick={() => void refreshCaptcha()} disabled={captchaRefreshing || busy} aria-label="更换验证码">{captchaRefreshing ? "更换中…" : "换一张"}</button>
                </span>
              </span>
              {fieldErrors.captcha ? <small id="auth-captcha-error" className="auth-field-error" role="alert">{fieldErrors.captcha}</small> : null}
            </div>
          </div>
          {error && !fieldErrors.captcha && !fieldErrors.password ? (
            <p className="auth-error" role="alert">
              <span>{error}</span>
              {errorKind === "network" ? <button type="button" className="auth-error-action" onClick={() => { setError(""); setErrorKind(""); void refreshCaptcha(); }}>重新连接</button> : null}
            </p>
          ) : null}
          <button className="auth-submit" type="submit" disabled={busy || entering || !captcha} aria-busy={busy || entering}>{entering ? "正在进入…" : busy ? "正在登录…" : config.setup_required ? "创建并进入系统" : "安全登录"}</button>
          <p className="auth-security-note">登录状态只保存在当前标签页，关闭后需要重新登录。</p>
        </form>
      </div>
    </main>
  );
}

function AuthAtmosphere() {
  return (
    <div className="auth-atmosphere" aria-hidden="true">
      <span className="auth-orb auth-orb-a" />
      <span className="auth-orb auth-orb-b" />
      <span className="auth-orb auth-orb-c" />
    </div>
  );
}

function AuthStatus({ message, alert = false, onRetry }: { message: string; alert?: boolean; onRetry?: () => void }) {
  return (
    <main className="auth-gate auth-gate-status">
      <AuthAtmosphere />
      <div className="auth-status-card">
        <p role={alert ? "alert" : undefined}>{message}</p>
        {onRetry ? <button type="button" className="auth-status-retry" onClick={onRetry}>重新连接</button> : null}
      </div>
    </main>
  );
}
