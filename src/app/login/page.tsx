"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type LoginResult = { error?: string; member?: { id: string; displayName: string; role: string } };

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "accept": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const responseText = await response.text();
      let result: LoginResult;
      try {
        result = responseText ? JSON.parse(responseText) as LoginResult : {};
      } catch {
        throw new Error(
          response.status >= 500
            ? `The sign-in service returned an unexpected server response (HTTP ${response.status}). Please check the deployment logs.`
            : `Unexpected response from the sign-in service (HTTP ${response.status}). Please refresh and try again.`,
        );
      }

      if (!response.ok) throw new Error(result.error || `Unable to sign in (HTTP ${response.status}).`);
      if (!result.member) throw new Error("The sign-in service did not confirm a session. Please try again.");
      router.replace("/workspace");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to sign in. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-page"><section className="auth-card"><Link className="brand auth-brand" href="/"><span className="brand-mark">P</span><span><strong>pactora</strong><small>PRIVATE LEDGER</small></span></Link><div className="eyebrow">OWNER ACCESS</div><h1>Welcome back.</h1><p className="auth-copy">Sign in to manage members, loan drafts, and financial records.</p><form className="auth-form" onSubmit={submit}><label>Email address<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} /></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required maxLength={256} /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button auth-submit" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in securely"}</button></form><p className="auth-footnote">Owner account must be created on the server first. Do not use a shared or reused password.</p></section></main>;
}
