"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function MemberAccessPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
    setToken(value);
    if (value) {
      window.history.replaceState(null, "", window.location.pathname);
      void openQr(value);
    }
  }, []);

  async function openQr(qrToken: string) {
    setError(""); setBusy(true);
    try {
      const response = await fetch("/api/auth/member-qr", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: qrToken }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to open this personal QR.");
      router.replace("/member");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to open this personal QR."); }
    finally { setBusy(false); }
  }

  return <main className="auth-page"><section className="auth-card"><Link className="brand auth-brand" href="/"><span className="brand-mark">P</span><span><strong>pactora</strong><small>PRIVATE LEDGER</small></span></Link><div className="eyebrow">MEMBER QR ACCESS</div><h1>{busy ? "Opening your records…" : "Open your records."}</h1><p className="auth-copy">Your personal QR link opens the loan records connected to this member profile. No member PIN is needed in this temporary access mode.</p>{!token && <div className="form-note">No QR token was found. Scan the personal QR link shared by the workspace owner.</div>}{error && <p className="form-error" role="alert">{error}</p>}{busy && <div className="workspace-loading">Verifying your personal QR link…</div>}{!busy && token && <button className="primary-button auth-submit" onClick={() => void openQr(token)}>Try opening my records again</button>}<p className="auth-footnote">Treat this QR link like a key. Anyone who has it may open this member profile. Contact the owner if it is lost or shared accidentally.</p></section></main>;
}
