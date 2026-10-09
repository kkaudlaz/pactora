"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function MemberAccessPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
    setToken(value);
    if (value) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const response = await fetch("/api/auth/member-access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, pin }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to verify access.");
      router.replace("/member");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to verify access."); }
    finally { setBusy(false); }
  }

  return <main className="auth-page"><section className="auth-card"><Link className="brand auth-brand" href="/"><span className="brand-mark">P</span><span><strong>pactora</strong><small>PRIVATE LEDGER</small></span></Link><div className="eyebrow">MEMBER ACCESS</div><h1>Your records, protected.</h1><p className="auth-copy">Scan your personal Pactora QR code, then enter your PIN to open only the records you are involved in.</p>{!token && <div className="form-note">No QR token was found. Open the personal access link given to you by the workspace owner.</div>}<form className="auth-form" onSubmit={submit}><label>Personal PIN<input inputMode="numeric" type="password" autoComplete="current-password" pattern="[0-9]{6,12}" minLength={6} maxLength={12} value={pin} onChange={(event) => setPin(event.target.value.replace(/[^0-9]/g, ""))} required /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button auth-submit" type="submit" disabled={busy || !token}>{busy ? "Verifying…" : "Open my records"}</button></form><p className="auth-footnote">Never share your PIN or personal QR code. Contact the owner if your access code is lost.</p></section></main>;
}
