"use client";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type Mode = "login" | "register" | "forgot" | "reset";
const safeNext = (value: string | null) => value?.startsWith("/") && !value.startsWith("//") ? value : "/";

export function AuthForm({ mode }: { mode: Mode }) {
  const params = useSearchParams();
  const [message, setMessage] = useState(mode === "login" && params.get("verified") ? "Email verified. You can now sign in." : "");
  const [error, setError] = useState(mode === "login" && params.get("verification") ? "That verification link is invalid or expired." : "");
  const [busy, setBusy] = useState(false);
  const [google, setGoogle] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  useEffect(() => { if (mode === "login" || mode === "register") fetch("/api/auth/providers").then((response) => response.json()).then((data) => setGoogle(Boolean(data.google))).catch(() => undefined); }, [mode]);
  const endpoint = mode === "login" ? "/api/auth/login" : mode === "register" ? "/api/auth/register" : mode === "forgot" ? "/api/auth/forgot-password" : "/api/auth/reset-password";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    if (mode === "reset") payload.token = params.get("token") ?? "";
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setError(body.message ?? "Something went wrong. Please try again."); setBusy(false); return; }
    if (mode === "login") { window.location.assign(safeNext(params.get("next"))); return; }
    setMessage(body.message ?? "Done."); setBusy(false);
  }
  const title = mode === "login" ? "Welcome, Glad to see you!" : mode === "register" ? "Create Account" : mode === "forgot" ? "Reset your password" : "Choose a new password";
  return <main className="authPage"><section className="authCard"><Link className="backLink" href="/">← Back</Link><Link className="brand" href="/">LUZON <span>TOLLMAP</span></Link><h1>{title}</h1>
    {mode === "register" && <p>To get started now!</p>}
    {mode === "forgot" && <p>Enter your verified account email. We will send a one-hour reset link.</p>}
    {mode === "reset" && !params.get("token") && <p className="formError">This reset link is incomplete.</p>}
    <form onSubmit={submit} className="authForm">
      {mode === "register" && <label>FULL NAME<input required name="fullName" autoComplete="name" minLength={2} maxLength={100}/></label>}
      {mode !== "reset" && <label>EMAIL ADDRESS<input required type="email" name="email" autoComplete="email" maxLength={254}/></label>}
      {(mode === "login" || mode === "register" || mode === "reset") && <label>PASSWORD<span className="passwordField"><input required type={showPassword ? "text" : "password"} name="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "login" ? 1 : 12} maxLength={128}/><button type="button" className="passwordToggle" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? "Hide" : "Show"}</button></span></label>}
      {mode === "login" && <Link className="forgotLink" href="/forgot-password">Forgot Password?</Link>}
      {(mode === "register" || mode === "reset") && <label>CONFIRM PASSWORD<span className="passwordField"><input required type={showConfirmation ? "text" : "password"} name="confirmPassword" autoComplete="new-password" minLength={12} maxLength={128}/><button type="button" className="passwordToggle" onClick={() => setShowConfirmation((visible) => !visible)} aria-label={showConfirmation ? "Hide confirmation password" : "Show confirmation password"}>{showConfirmation ? "Hide" : "Show"}</button></span></label>}
      {error && <p role="alert" className="formError">{error}</p>}{message && <p role="status" className="formSuccess">{message}</p>}
      <button className="calculate" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Login" : mode === "register" ? "Create Account" : mode === "forgot" ? "Send reset link" : "Reset password"}</button>
    </form>
    {google && (mode === "login" || mode === "register") && <><div className="authDivider"><span>{mode === "login" ? "Or Login with" : "Or Sign Up with"}</span></div><a className="oauthButton" href="/api/auth/google">{mode === "login" ? "Continue with Google" : "Sign up with Google"}</a></>}
    <div className="authLinks">{mode === "login" && <Link href="/register">Don&apos;t have an account? <b>Sign Up Now</b></Link>}{mode === "register" && <Link href="/login">Already have an account? <b>Login Now</b></Link>}{mode === "forgot" && <Link href="/login">Back to login</Link>}{mode === "reset" && <Link href="/login">Back to login</Link>}</div>
  </section></main>;
}
