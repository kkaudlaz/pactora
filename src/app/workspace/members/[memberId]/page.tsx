"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { formatPhp } from "@/lib/money";

type Approval = { id: string; kind: string; decision: string; termsVersion: number | null; decidedAt: string; member: { id: string; displayName: string } };
type Reversal = { id: string; amountCentavos: string; reason: string; status: string; createdAt: string; confirmedAt: string | null };
type Payment = { id: string; amountCentavos: string; method: string; status: string; paidAt: string | null; reference: string | null; note: string | null; createdByMemberId: string | null; createdAt: string; confirmedAt: string | null; approvals: { id: string; decision: string; decidedAt: string; member: { id: string; displayName: string } }[]; reversals: Reversal[] };
type Loan = { id: string; publicCode: string; category: string; description: string; principalCentavos: string; currency: string; repaymentTerms: string; dueAt: string | null; status: string; termsVersion: number; createdAt: string; borrower: { id: string; displayName: string; memberUid: string }; lender: { id: string; displayName: string; memberUid: string }; outstandingCentavos: string; approvals: Approval[]; payments: Payment[] };
type Member = { id: string; memberUid: string; displayName: string; email: string | null; phone?: string | null; role: string; createdAt: string; hasActiveAccess: boolean };
type Audit = { sequence: string; entityType: string; entityId: string; eventType: string; actorMemberId: string | null; createdAt: string; eventHash: string; previousHash: string | null };
type Details = { member: Member; loans: Loan[]; audit: Audit[] };

export default function MemberHistoryPage() {
  const params = useParams<{ memberId: string }>();
  const router = useRouter();
  const [data, setData] = useState<Details | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [selectedLoanIds, setSelectedLoanIds] = useState<string[]>([]);
  const [paymentAmounts, setPaymentAmounts] = useState<Record<string, string>>({});
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [savingPayments, setSavingPayments] = useState(false);
  const [paymentNotice, setPaymentNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [meResponse, response] = await Promise.all([fetch("/api/auth/me", { cache: "no-store" }), fetch("/api/admin/members/" + encodeURIComponent(params.memberId), { cache: "no-store" })]);
      const me = meResponse.ok ? await meResponse.json() : null;
      if (!me?.member?.id) { router.replace("/"); return; }
      setOwnerId(me.member.id);
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401) { router.replace("/"); return; }
        if (response.status === 403) { router.replace("/member"); return; }
        throw new Error(result.error || "Could not load member history.");
      }
      setData(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load member history."); }
    finally { setLoading(false); }
  }, [params.memberId, router]);
  useEffect(() => { void load(); }, [load]);

  const loans = data?.loans ?? [];
  const active = loans.filter((loan) => loan.status === "ACTIVE");
  const outstanding = active.reduce((sum, loan) => sum + BigInt(loan.outstandingCentavos), 0n);
  const pendingPayments = loans.flatMap((loan) => loan.payments).filter((payment) => payment.status === "AWAITING_ACKNOWLEDGMENT");
  const confirmedPayments = loans.flatMap((loan) => loan.payments).filter((payment) => payment.status === "CONFIRMED");
  const payableLoans = loans.filter((loan) => loan.status === "ACTIVE" && (loan.borrower.id === ownerId || loan.lender.id === ownerId) && (loan.borrower.id === data?.member.id || loan.lender.id === data?.member.id));
  async function recordSelectedPayments(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (savingPayments || !selectedLoanIds.length) return;
    setSavingPayments(true); setError(""); setPaymentNotice("");
    const successfulIds: string[] = []; const failures: string[] = [];
    for (const loanId of selectedLoanIds) {
      const loan = payableLoans.find((item) => item.id === loanId);
      try {
        const response = await fetch("/api/payments", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ loanId, amountPhp: paymentAmounts[loanId], method: paymentMethod, reference: paymentReference || undefined, note: paymentNote || undefined }) });
        const result = await response.json();
        if (!response.ok) failures.push((loan?.publicCode || loanId) + ": " + (result.error || "could not record payment")); else successfulIds.push(loanId);
      } catch { failures.push((loan?.publicCode || loanId) + ": request failed"); }
    }
    setSelectedLoanIds((current) => current.filter((id) => !successfulIds.includes(id)));
    setPaymentAmounts((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !successfulIds.includes(id))));
    setPaymentNotice(successfulIds.length + " payment(s) recorded and awaiting acknowledgment." + (failures.length ? " Failed: " + failures.join("; ") : ""));
    setSavingPayments(false); if (successfulIds.length) await load();
  }


  function downloadStatementImage() {
    if (!data) return;
    const canvas = document.createElement("canvas");
    const width = 1200;
    const lineHeight = 38;
    const height = Math.max(620, 360 + loans.length * 150);
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) { setError("Could not prepare the statement image."); return; }
    ctx.fillStyle = "#f2f5f1"; ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.roundRect(36, 36, width - 72, height - 72, 28); ctx.fill();
    ctx.fillStyle = "#163d32"; ctx.font = "bold 42px Arial"; ctx.fillText("pactora", 76, 104);
    ctx.fillStyle = "#718079"; ctx.font = "18px Arial"; ctx.fillText("LOAN STATEMENT · GENERATED " + new Date().toLocaleString(), 76, 140);
    ctx.fillStyle = "#17201e"; ctx.font = "bold 32px Arial"; ctx.fillText(data.member.displayName, 76, 202);
    ctx.fillStyle = "#53635b"; ctx.font = "20px Arial"; ctx.fillText("Member ID: " + data.member.memberUid, 76, 238);
    ctx.font = "bold 23px Arial"; ctx.fillStyle = "#163d32"; ctx.fillText("All records: " + loans.length + " · Active outstanding: " + formatPhp(outstanding), 76, 290);
    let y = 350;
    for (const loan of loans) {
      ctx.fillStyle = "#eaf2ed"; ctx.beginPath(); ctx.roundRect(68, y - 28, width - 136, 122, 16); ctx.fill();
      ctx.fillStyle = "#163d32"; ctx.font = "bold 22px Arial"; ctx.fillText(loan.publicCode + " · " + loan.status.replaceAll("_", " "), 90, y + 2);
      ctx.fillStyle = "#17201e"; ctx.font = "20px Arial"; ctx.fillText(loan.description.slice(0, 78), 90, y + 34);
      ctx.fillStyle = "#53635b"; ctx.font = "18px Arial"; ctx.fillText("Principal " + formatPhp(BigInt(loan.principalCentavos)) + " · Outstanding " + formatPhp(BigInt(loan.outstandingCentavos)), 90, y + 64);
      const confirmedAmount = loan.payments.filter((p) => p.status === "CONFIRMED").reduce((sum, p) => sum + BigInt(p.amountCentavos), 0n);
      ctx.fillText("Confirmed paid: " + formatPhp(confirmedAmount) + " · Payments: " + loan.payments.length + " · Due: " + (loan.dueAt ? new Date(loan.dueAt).toLocaleDateString() : "Not set"), 90, y + 88);
      y += 150;
    }
    ctx.fillStyle = "#718079"; ctx.font = "16px Arial"; ctx.fillText("Based on Pactora records at generation time. Pending repayments are not treated as confirmed.", 76, height - 70);
    const link = document.createElement("a");
    const safeName = data.member.displayName.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "member";
    link.download = "pactora-loan-statement-" + safeName + ".png"; link.href = canvas.toDataURL("image/png"); link.click();
  }

  return <main className="workspace-shell">
    <header className="workspace-header"><a className="brand" href="/workspace"><span className="brand-mark">P</span><span><strong>pactora</strong><small>PRIVATE LEDGER</small></span></a><div className="workspace-head-right"><span className="secure-indicator"><i/> Owner workspace</span><button className="secondary-button" onClick={() => router.push("/workspace")}>Back to workspace</button></div></header>
    <div className="member-content">
      <div className="page-heading"><div><div className="eyebrow">MEMBER DIRECTORY · HISTORY</div><h1>{data?.member.displayName || (loading ? "Loading member…" : "Member history")}</h1><p>Loans, repayment activity, approvals, and audit events for this member.</p></div><div className="table-actions"><button className="secondary-button" onClick={downloadStatementImage} disabled={!data}>Download statement PNG</button><button className="secondary-button" onClick={() => void load()}>↻ Refresh</button></div></div>
      {error && <div className="workspace-alert error" role="alert">{error}</div>}
      {loading && <div className="workspace-loading">Loading member history…</div>}
      {!loading && data && <>
        <section className="workspace-card"><div className="section-row"><div><h2>Member profile</h2><p className="workspace-muted">Internal identifiers are shown for administration. PIN hashes and QR tokens are never returned.</p></div><span className={"member-status " + (data.member.role === "OWNER" || data.member.hasActiveAccess ? "" : "inactive")}>{data.member.role === "OWNER" ? "Owner account" : data.member.hasActiveAccess ? "QR active" : "QR inactive"}</span></div>
          <div className="member-loan-stats"><div><small>Member ID</small><strong>{data.member.memberUid}</strong></div><div><small>Email</small><strong>{data.member.email || "Not provided"}</strong></div><div><small>Joined</small><strong>{new Date(data.member.createdAt).toLocaleDateString()}</strong></div></div>
        </section>
        <div className="stats-grid"><div className="stat-card"><div className="stat-top">All loan records</div><strong className="stat-value">{loans.length}</strong><div className="stat-note">Borrower and lender roles</div></div><div className="stat-card"><div className="stat-top">Active outstanding</div><strong className="stat-value">{formatPhp(outstanding)}</strong><div className="stat-note">Active loans only; pending payments excluded</div></div><div className="stat-card"><div className="stat-top">Pending repayments</div><strong className="stat-value">{pendingPayments.length}</strong><div className="stat-note">Awaiting the other party&apos;s acknowledgment</div></div><div className="stat-card"><div className="stat-top">Confirmed repayments</div><strong className="stat-value">{confirmedPayments.length}</strong><div className="stat-note">Confirmed records across all loans</div></div></div>
        {payableLoans.length > 0 && <section className="workspace-card payment-proposal-card"><div className="section-row"><div><h2>Record repayment for this member</h2><p className="workspace-muted">Select one or more active loans and enter a separate amount for each. Each payment remains pending until the other party acknowledges it.</p></div></div>
          {paymentNotice && <div className="workspace-alert success" role="status">{paymentNotice}</div>}
          <form className="workspace-form loan-form" onSubmit={recordSelectedPayments}>
            <div className="form-span"><div className="section-row"><strong>Choose loans</strong><div className="table-actions"><button type="button" className="text-button" onClick={() => setSelectedLoanIds(payableLoans.filter((loan) => !loan.payments.some((p) => p.status === "AWAITING_ACKNOWLEDGMENT")).map((loan) => loan.id))}>Select available</button><button type="button" className="text-button" onClick={() => setSelectedLoanIds([])}>Clear</button></div></div>
              <div className="payment-selection-list">{payableLoans.map((loan) => { const pending = loan.payments.some((p) => p.status === "AWAITING_ACKNOWLEDGMENT"); return <div className="payment-selection-row" key={loan.id}><label className="payment-selection-check"><input type="checkbox" checked={selectedLoanIds.includes(loan.id)} disabled={pending} onChange={(e) => setSelectedLoanIds((current) => e.target.checked ? [...current, loan.id] : current.filter((id) => id !== loan.id))}/><span><strong>{loan.publicCode} · {loan.description}</strong><small>{loan.borrower.displayName} ↔ {loan.lender.displayName}</small><small>Outstanding: {formatPhp(BigInt(loan.outstandingCentavos))} · Due {loan.dueAt ? new Date(loan.dueAt).toLocaleDateString() : "not set"}{pending ? " · Payment awaiting acknowledgment" : ""}</small></span></label>{selectedLoanIds.includes(loan.id) && <label className="payment-selection-amount">Payment amount (PHP)<input inputMode="decimal" value={paymentAmounts[loan.id] || ""} onChange={(e) => setPaymentAmounts((current) => ({ ...current, [loan.id]: e.target.value }))} required placeholder="e.g. 500.00"/></label>}</div>; })}</div>
            </div>
            <label>Payment method<select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}><option value="CASH">Cash</option><option value="GCASH">GCash</option><option value="BANK_TRANSFER">Bank transfer</option><option value="OTHER">Other</option></select></label>
            <label>Reference {paymentMethod === "GCASH" || paymentMethod === "BANK_TRANSFER" ? "(required)" : "(optional)"}<input value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} maxLength={200} required={paymentMethod === "GCASH" || paymentMethod === "BANK_TRANSFER"} placeholder="Transaction reference"/></label>
            <label className="form-span">Notes (optional)<textarea value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} maxLength={1000} rows={2} placeholder="Optional repayment context"/></label>
            <button className="primary-button form-span" type="submit" disabled={savingPayments || !selectedLoanIds.length || selectedLoanIds.some((id) => !paymentAmounts[id]?.trim())}>{savingPayments ? "Recording payments…" : "Record " + selectedLoanIds.length + " selected payment(s)"}</button>
          </form>
        </section>}
        <div className="section-row"><div><h2>Loans and agreements</h2><p>Each loan includes its complete repayment history and available approvals.</p></div></div>
        {loans.map((loan) => <article className="member-loan-card" key={loan.id}>
          <div className="member-loan-head"><div><span className="loan-code">{loan.publicCode}</span><h2>{loan.description}</h2><p>{loan.borrower.displayName} → {loan.lender.displayName}</p></div><span className={"status-pill " + loan.status.toLowerCase().replaceAll("_","-")}>{loan.status.replaceAll("_"," ")}</span></div>
          <div className="member-loan-stats"><div><small>Original principal</small><strong>{formatPhp(BigInt(loan.principalCentavos))}</strong></div><div><small>Current outstanding</small><strong>{formatPhp(BigInt(loan.outstandingCentavos))}</strong></div><div><small>Due date</small><strong>{loan.dueAt ? new Date(loan.dueAt).toLocaleDateString() : "Not set"}</strong></div></div>
          <div className="terms-summary"><strong>Repayment terms</strong><p>{loan.repaymentTerms}</p><small>Created {new Date(loan.createdAt).toLocaleString()} · Terms version {loan.termsVersion}</small></div>
          <div className="payment-history"><strong>Repayments ({loan.payments.length})</strong>
            {loan.payments.length === 0 ? <p className="workspace-muted">No repayment records for this loan.</p> : loan.payments.map((payment) => <div className="payment-row" key={payment.id}>
              <div><b>{formatPhp(BigInt(payment.amountCentavos))}</b><small>{payment.method.replaceAll("_"," ")} · Submitted {new Date(payment.createdAt).toLocaleString()}</small><small>Submitted by {payment.createdByMemberId === data.member.id ? data.member.displayName : (payment.createdByMemberId ? (loan.borrower.id === payment.createdByMemberId ? loan.borrower.displayName : loan.lender.displayName) : "Unknown")}</small>{payment.paidAt && <small>Reported paid: {new Date(payment.paidAt).toLocaleString()}</small>}{payment.reference && <small>Reference: {payment.reference}</small>}{payment.note && <small>Note: {payment.note}</small>}{payment.confirmedAt && <small>Confirmed: {new Date(payment.confirmedAt).toLocaleString()}</small>}</div>
              <span className={"status-pill " + payment.status.toLowerCase().replaceAll("_","-")}>{payment.status.replaceAll("_"," ")}</span>
              {payment.reversals.length > 0 && <div className="terms-summary"><strong>Reversals</strong>{payment.reversals.map((reversal) => <p key={reversal.id}>{formatPhp(BigInt(reversal.amountCentavos))} · {reversal.status} · {reversal.reason}</p>)}</div>}
              {payment.approvals.map((approval) => <small key={approval.id}>Acknowledgment: {approval.member.displayName} · {approval.decision} · {new Date(approval.decidedAt).toLocaleString()}</small>)}
            </div>)}
          </div>
          {loan.approvals.length > 0 && <div className="payment-history"><strong>Approvals and decisions</strong>{loan.approvals.map((approval) => <div className="payment-row" key={approval.id}><div><b>{approval.kind.replaceAll("_"," ")}</b><small>{approval.member.displayName} · {approval.termsVersion ? "Terms version " + approval.termsVersion + " · " : ""}{new Date(approval.decidedAt).toLocaleString()}</small></div><span className="status-pill">{approval.decision}</span></div>)}</div>}
        </article>)}
        {loans.length === 0 && <div className="empty-state">No loans are linked to this member yet.</div>}
        <section className="workspace-card" style={{marginTop:"1.25rem"}}><h2>Audit timeline</h2><p className="workspace-muted">Latest 200 matching append-only audit records for this member, their loans, repayments, and reversals. Event payloads are intentionally omitted here.</p>
          <div className="audit-list">{data.audit.map((entry) => <article className="audit-entry" key={entry.sequence}><div className="audit-entry-top"><span className="audit-sequence">#{entry.sequence}</span><span className="status-pill">{entry.entityType}</span><time>{new Date(entry.createdAt).toLocaleString()}</time></div><strong>{entry.eventType.replaceAll("_"," ")}</strong><p>{entry.entityId}</p><div className="audit-hash"><small>EVENT HASH</small><code>{entry.eventHash}</code></div><div className="audit-hash"><small>PREVIOUS HASH</small><code>{entry.previousHash || "GENESIS"}</code></div></article>)}{data.audit.length === 0 && <div className="empty-state">No matching audit events found.</div>}</div>
        </section>
      </>}
    </div>
  </main>;
}
