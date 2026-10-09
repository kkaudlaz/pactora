"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to sign in.");
      router.replace("/workspace");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to sign in."); }
    finally { setBusy(false); }
  }

  return <main className="auth-page"><section className="auth-card"><Link className="brand auth-brand" href="/"><span className="brand-mark">P</span><span><strong>pactora</strong><small>PRIVATE LEDGER</small></span></Link><div className="eyebrow">OWNER ACCESS</div><h1>Welcome back.</h1><p className="auth-copy">Sign in to manage members, loan drafts, and financial records.</p><form className="auth-form" onSubmit={submit}><label>Email address<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} /></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required maxLength={256} /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button auth-submit" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in securely"}</button></form><p className="auth-footnote">Owner account must be created on the server first. Do not use a shared or reused password.</p></section></main>;
}
