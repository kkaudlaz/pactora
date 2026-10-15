"use client";

import { useEffect, useState } from "react";
import { formatPhp } from "@/lib/money";

type StatementPayment = { id: string; amountCentavos: string; method: string; status: string; reference: string | null; note: string | null; createdAt: string; paidAt: string | null; createdByMemberId: string | null };
type StatementItem = { id: string; loanId: string; dueAt: string; amountCentavos: string; paidCentavos: string; pendingCentavos: string; remainingCentavos: string; note: string | null; loan: { id: string; publicCode: string; description: string; status: string; principalCentavos: bigint | string; borrower: { id: string; displayName: string }; lender: { id: string; displayName: string } }; payments: StatementPayment[] };
type Statement = { id: string; periodStart: string; periodEnd: string; dueAt: string; state: "PAST" | "CURRENT" | "UPCOMING"; totalCentavos: string; paidCentavos: string; pendingCentavos: string; remainingCentavos: string; items: StatementItem[] };

export default function MemberStatements({ memberId }: { memberId: string }) {
  const [statements, setStatements] = useState<Statement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch("/api/member/statements", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load your statements.");
        if (active) setStatements(data.statements || []);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Could not load your statements.");
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [memberId]);

  return <section className="workspace-stack">
    <div className="section-row"><div><h2>Your statements</h2><p className="workspace-muted">Each cutoff is a separate statement. Previous unpaid balances stay in their original statement and are not added to the current cutoff.</p></div></div>
    {loading && <div className="workspace-loading">Loading cutoff statements…</div>}
    {error && <div className="workspace-alert error" role="alert">{error}</div>}
    {!loading && !error && statements.length === 0 && <div className="workspace-card empty-state">No cutoff statements have been configured for your loans yet.</div>}
    {!loading && statements.map((statement) => {
      const isOpen = expanded === statement.id;
      const stateLabel = statement.state === "CURRENT" ? "Current statement" : statement.state === "UPCOMING" ? "Upcoming statement" : "Previous statement";
      return <article className="workspace-card" key={statement.id}>
        <div className="member-loan-head"><div><span className="loan-code">{stateLabel}</span><h2>{new Date(statement.periodStart + "T12:00:00").toLocaleDateString()} – {new Date(statement.periodEnd + "T12:00:00").toLocaleDateString()}</h2><p>{statement.items.length} loan / cutoff item(s) · earliest due {statement.dueAt}</p></div><span className={"status-pill " + (statement.state === "CURRENT" ? "active" : statement.state === "UPCOMING" ? "pending" : "settled")}>{statement.state}</span></div>
        <div className="member-loan-stats"><div><small>Statement total</small><strong>{formatPhp(BigInt(statement.totalCentavos))}</strong></div><div><small>Confirmed paid</small><strong>{formatPhp(BigInt(statement.paidCentavos))}</strong></div><div><small>Remaining in this statement</small><strong>{formatPhp(BigInt(statement.remainingCentavos))}</strong></div></div>
        {BigInt(statement.pendingCentavos) > 0n && <p className="workspace-muted">Awaiting acknowledgment: {formatPhp(BigInt(statement.pendingCentavos))}. Pending payments are shown separately and do not count as confirmed paid.</p>}
        <button className="secondary-button" type="button" aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : statement.id)}>{isOpen ? "Hide breakdown" : "View statement breakdown"}</button>
        {isOpen && <div className="workspace-stack" style={{ marginTop: "1rem" }}>
          {statement.items.map((item) => <section className="terms-summary" key={item.id}>
            <div className="member-loan-head"><div><strong>{item.loan.publicCode} · {item.loan.description}</strong><p>{item.loan.borrower.id === memberId ? "You are the borrower" : "You are the lender"} · with {item.loan.borrower.id === memberId ? item.loan.lender.displayName : item.loan.borrower.displayName}</p><small>Due {item.dueAt}{item.note ? " · " + item.note : ""}</small></div><span className="status-pill">{item.remainingCentavos === "0" ? "PAID" : "BALANCE DUE"}</span></div>
            <div className="member-loan-stats"><div><small>Cutoff amount</small><strong>{formatPhp(BigInt(item.amountCentavos))}</strong></div><div><small>Confirmed paid</small><strong>{formatPhp(BigInt(item.paidCentavos))}</strong></div><div><small>Remaining</small><strong>{formatPhp(BigInt(item.remainingCentavos))}</strong></div></div>
            {item.payments.length > 0 && <div className="payment-history"><strong>Payment history for this cutoff</strong>{item.payments.map((payment) => <div className="payment-row" key={payment.id}><div><b>{formatPhp(BigInt(payment.amountCentavos))}</b><small>{payment.method.replaceAll("_", " ")} · {new Date(payment.createdAt).toLocaleDateString()}{payment.reference ? " · Ref: " + payment.reference : ""}</small></div><span className={"status-pill " + payment.status.toLowerCase().replaceAll("_", "-")}>{payment.status.replaceAll("_", " ")}</span></div>)}</div>}
          </section>)}
        </div>}
      </article>;
    })}
  </section>;
}
