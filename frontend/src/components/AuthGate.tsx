import { FormEvent, ReactNode, RefObject, useCallback, useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { createApiClient, fetchWithTimeout } from "../api/client";
import "./auth-gate.css";

type AuthConfig = { enabled: boolean; setup_required: boolean; registration_open?: boolean };
export type AuthUser = { id?: number; email: string; display_name?: string; has_avatar?: boolean };
type AuthSession = { access_token: string; user: AuthUser };
type Captcha = { captcha_id: string; svg: string; accessible_text?: string };
type FieldErrors = { email?: string; password?: string; passwordConfirmation?: string; captcha?: string };
type LoginIssue = { kind: "captcha" | "credentials" | "network" | "throttled" | "exists" | "generic"; message: string; field?: keyof FieldErrors };

const tokenStorageKey = "careerloop-auth-token";
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const successPauseMs = 320;
const restoreRetryMs = 1500;

function readStoredToken() {
  const local = window.localStorage.getItem(tokenStorageKey);
  if (local) return local;
  const session = window.sessionStorage.getItem(tokenStorageKey);
  if (!session) return null;
  window.localStorage.setItem(tokenStorageKey, session);
  window.sessionStorage.removeItem(tokenStorageKey);
  return session;
}

function writeStoredToken(token: string) {
  window.localStorage.setItem(tokenStorageKey, token);
  window.sessionStorage.removeItem(tokenStorageKey);
}

function clearStoredToken() {
  window.localStorage.removeItem(tokenStorageKey);
  window.sessionStorage.removeItem(tokenStorageKey);
}

class SessionRestoreError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

function isExpiredSession(reason: unknown) {
  return reason instanceof SessionRestoreError && reason.status === 401;
}

async function restoreSession(apiBase: string, token: string) {
  let response: Response;
  try {
    response = await fetchWithTimeout(`${apiBase}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch (reason) {
    throw new SessionRestoreError(
      reason instanceof Error ? reason.message : "登录服务暂时不可用，正在重试…"
    );
  }
  if (response.status === 401) {
    throw new SessionRestoreError("登录状态已失效，请重新登录", 401);
  }
  if (!response.ok) {
    throw new SessionRestoreError("登录服务暂时不可用，正在重试…", response.status);
  }
  const payload = await response.json() as { user: AuthUser };
  return payload.user;
}

function normalizeCaptchaCode(value: string) {
  return value.replace(/\s+/g, "").toUpperCase().slice(0, 5);
}

function classifyLoginError(reason: unknown, registering: boolean): LoginIssue {
  const message = reason instanceof Error ? reason.message : "登录失败，请稍后重试";
  const endpoint = registering ? "/auth/register" : "/auth/login";
  if (/failed to fetch|networkerror|load failed|网络|无法连接|请求超时/i.test(message)) {
    return { kind: "network", message: "网络已断开，请检查连接后点重新连接。" };
  }
  if (message.includes("次数过多") || message.includes(`${endpoint} 请求失败（429）`)) {
    return { kind: "throttled", message: message.includes("请在") ? message : "登录失败次数过多，请稍后再试。" };
  }
  if (message.includes("验证码") || message.includes(`${endpoint} 请求失败（422）`)) {
    return { kind: "captcha", message: "验证码不正确或已过期，已为你更换，请重新输入。", field: "captcha" };
  }
  if (message.includes("已注册") || message.includes(`${endpoint} 请求失败（409）`)) {
    return { kind: "exists", message: "该邮箱已注册，请直接登录。", field: "email" };
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
  registering: boolean;
}): FieldErrors {
  const next: FieldErrors = {};
  if (!input.email.trim()) next.email = "请输入邮箱";
  else if (!emailPattern.test(input.email.trim())) next.email = "请输入有效的邮箱地址";
  if (!input.password) next.password = "请输入密码";
  else if (input.password.length < 8) next.password = "密码至少 8 位";
  if (input.registering) {
    if (!input.passwordConfirmation) next.passwordConfirmation = "请再次输入密码";
    else if (input.password !== input.passwordConfirmation) next.passwordConfirmation = "两次输入的密码不一致";
  }
  if (!input.captcha) next.captcha = "验证码正在加载，请稍后再试";
  else if (normalizeCaptchaCode(input.captchaCode).length !== 5) next.captcha = "请输入图中的 5 位验证码";
  return next;
}

export function AuthGate({ apiBase, children }: { apiBase: string; children: (accessToken: string, onLogout: () => void, user: AuthUser, updateSession: (token: string, user: AuthUser) => void) => ReactNode }) {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [token, setToken] = useState<string | null>(() => readStoredToken());
  const [validatedToken, setValidatedToken] = useState<string | null>(null);
  const [sessionUser, setSessionUser] = useState<AuthUser | null>(null);
  const [restoreError, setRestoreError] = useState("");
  const [restoreNonce, setRestoreNonce] = useState(0);
  const [registering, setRegistering] = useState(false);
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
        setRegistering(Boolean(next.setup_required));
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
    let cancelled = false;
    void restoreSession(apiBase, token)
      .then((user) => {
        if (cancelled) return;
        writeStoredToken(token);
        setSessionUser(user);
        setValidatedToken(token);
        setRestoreError("");
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        if (isExpiredSession(reason)) {
          clearStoredToken();
          setToken(null);
          setValidatedToken(null);
          setSessionUser(null);
          setRestoreError("");
          return;
        }
        setRestoreError(reason instanceof Error ? reason.message : "登录服务暂时不可用，正在重试…");
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, token, validatedToken, restoreNonce]);

  useEffect(() => {
    if (!token || token === validatedToken || !restoreError) return;
    const timer = window.setTimeout(() => setRestoreNonce((value) => value + 1), restoreRetryMs);
    return () => window.clearTimeout(timer);
  }, [token, validatedToken, restoreError]);

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
      registering
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
      const session = await createApiClient(apiBase)<AuthSession>(registering ? "/auth/register" : "/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, captcha_id: captcha.captcha_id, captcha_code: normalizeCaptchaCode(captchaCode) })
      });
      writeStoredToken(session.access_token);
      setEntering(true);
      if (!prefersReducedMotion()) {
        await new Promise((resolve) => window.setTimeout(resolve, successPauseMs));
      }
      setPassword("");
      setPasswordConfirmation("");
      setSessionUser(session.user);
      setToken(session.access_token);
      setValidatedToken(session.access_token);
    } catch (reason) {
      const issue = classifyLoginError(reason, registering);
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
    clearStoredToken();
    setValidatedToken(null);
    setToken(null);
    setSessionUser(null);
    setRestoreError("");
  }

  function updateSession(nextToken: string, nextUser: AuthUser) {
    writeStoredToken(nextToken);
    setToken(nextToken);
    setValidatedToken(nextToken);
    setSessionUser(nextUser);
    setRestoreError("");
  }
  if (token && token !== validatedToken) {
    return (
      <AuthStatus
        message={restoreError || "正在验证登录状态…"}
        alert={Boolean(restoreError)}
        onRetry={restoreError ? () => { setRestoreError(""); setRestoreNonce((value) => value + 1); } : undefined}
      />
    );
  }
  if (token && sessionUser) {
    return <>
      {children(token, logout, sessionUser, updateSession)}
    </>;
  }
  if (error && !config) {
    return <AuthStatus message={error} alert onRetry={() => { setError(""); setBootNonce((value) => value + 1); void refreshCaptcha(); }} />;
  }
  if (!config) return <AuthStatus message="正在连接登录服务…" />;
  const confirmMismatch = Boolean(registering && passwordConfirmation && password !== passwordConfirmation);
  return (
    <AuthGateShell>
      <div className="auth-shell">
        <aside className="auth-intro" aria-label="CareerLoop 如何与你协作">
          <p className="auth-intro-kicker">让资料在每次对话中持续发挥作用</p>
          <h2>从真实资料出发，完成分析与创作。</h2>
          <p>CareerLoop 帮你整理长期资料，在对话中完成搜索、分析和内容生成，并把结果沉淀到工作台。</p>
          <ol className="auth-intro-steps">
            <li>整理资料</li>
            <li>开始对话</li>
            <li>沉淀成果</li>
          </ol>
          <ul>
            <li><strong>有据可循</strong><span>分析和内容都能回到你提供的资料。</span></li>
            <li><strong>始终可控</strong><span>联网研究和资料使用均由你决定。</span></li>
            <li><strong>持续积累</strong><span>确认过的信息可以在后续任务中复用。</span></li>
          </ul>
        </aside>

        <form className="auth-card" onSubmit={submit} noValidate aria-busy={busy}>
          <div className="auth-brand">
            <img className="auth-logo" src="/careerloop-mark-v2.png" alt="" draggable={false} />
            <h1 className="auth-eyebrow">CAREERLOOP</h1>
          </div>
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
                  autoComplete={registering ? "new-password" : "current-password"}
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
            {registering ? (
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
          <button className="auth-submit" type="submit" disabled={busy || entering || !captcha} aria-busy={busy || entering}>{entering ? "正在进入…" : busy ? (registering ? "正在创建…" : "正在登录…") : registering ? "创建账号" : "登录"}</button>
          <p className="auth-mode-switch">
            {registering ? (
              <button type="button" onClick={() => { setRegistering(false); setPasswordConfirmation(""); setFieldErrors({}); setError(""); }} disabled={busy}>已有账号？去登录</button>
            ) : (
              <button type="button" onClick={() => { setRegistering(true); setFieldErrors({}); setError(""); }} disabled={busy}>没有账号？创建账号</button>
            )}
          </p>
        </form>
      </div>
    </AuthGateShell>
  );
}

function prefersReducedMotion() {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const gridCellPx = 36;

function useAuthGridLinger(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || prefersReducedMotion()) return;
    const grid = root.querySelector(".auth-grid");
    if (!(grid instanceof HTMLElement)) return;

    const onPointerMove = (event: PointerEvent) => {
      const rect = grid.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const cellX = Math.floor((event.clientX - rect.left) / gridCellPx) * gridCellPx;
      const cellY = Math.floor((event.clientY - rect.top) / gridCellPx) * gridCellPx;
      root.style.setProperty("--cell-x", `${cellX}px`);
      root.style.setProperty("--cell-y", `${cellY}px`);
      root.style.setProperty("--linger", "1");
    };

    const onPointerLeave = () => {
      root.style.setProperty("--linger", "0");
    };

    root.addEventListener("pointermove", onPointerMove, { passive: true });
    root.addEventListener("pointerleave", onPointerLeave);
    return () => {
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerleave", onPointerLeave);
    };
  }, [rootRef]);
}

function isAuthFormTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("form, input, button, textarea, label, .auth-card, .auth-status-card"));
}

function suppressBackgroundDoubleClick(event: { target: EventTarget | null; preventDefault: () => void }) {
  if (isAuthFormTarget(event.target)) return;
  event.preventDefault();
}

function AuthGateShell({ status = false, children }: { status?: boolean; children: ReactNode }) {
  const rootRef = useRef<HTMLElement>(null);
  useAuthGridLinger(rootRef);
  return (
    <main ref={rootRef} className={status ? "auth-gate auth-gate-status" : "auth-gate"} onDoubleClick={suppressBackgroundDoubleClick}>
      <AuthAtmosphere />
      {children}
    </main>
  );
}

function AuthAtmosphere() {
  return (
    <div className="auth-atmosphere" aria-hidden="true" onDoubleClick={suppressBackgroundDoubleClick}>
      <span className="auth-veil" />
      <span className="auth-grid">
        <span className="auth-cell" />
      </span>
      <span className="auth-gleam" />
      <span className="auth-grain" />
    </div>
  );
}

function AuthStatus({ message, alert = false, onRetry }: { message: string; alert?: boolean; onRetry?: () => void }) {
  return (
    <AuthGateShell status>
      <div className="auth-status-card">
        <p role={alert ? "alert" : undefined}>{message}</p>
        {onRetry ? <button type="button" className="auth-status-retry" onClick={onRetry}>重新连接</button> : null}
      </div>
    </AuthGateShell>
  );
}
