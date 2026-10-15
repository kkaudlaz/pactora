"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { formatPhp } from "@/lib/money";
import PaymentQrImage from "@/components/payment-qr-image";

type StatementPayment = { id: string; amountCentavos: string; method: string; status: string; reference: string | null; note: string | null; createdAt: string; paidAt: string | null; createdByMemberId: string | null };
type StatementItem = { id: string; loanId: string; dueAt: string; amountCentavos: string; paidCentavos: string; pendingCentavos: string; remainingCentavos: string; note: string | null; loan: { id: string; publicCode: string; description: string; status: string; borrower: { id: string; displayName: string }; lender: { id: string; displayName: string } }; payments: StatementPayment[] };
type Statement = { id: string; periodStart: string; periodEnd: string; dueAt: string; state: "PAST" | "CURRENT" | "UPCOMING"; totalCentavos: string; paidCentavos: string; pendingCentavos: string; remainingCentavos: string; items: StatementItem[] };
type Destination = { id: string; lenderId: string; method: "GCASH" | "BANK_TRANSFER"; provider: string; recipientName: string | null; accountLabel: string | null; qrImageData: string; updatedAt: string };

const manilaDate = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

export default function MemberStatements({ memberId }: { memberId: string }) {
  const [statements, setStatements] = useState<Statement[]>([]);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [statementTab, setStatementTab] = useState<"CURRENT" | "PREVIOUS" | "UPCOMING">("CURRENT");
  const [repayStatementId, setRepayStatementId] = useState<string | null>(null);
  const [method, setMethod] = useState("GCASH");
  const [bankProvider, setBankProvider] = useState("BDO");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [statementResponse, destinationResponse] = await Promise.all([
        fetch("/api/member/statements", { cache: "no-store" }),
        fetch("/api/payment-destinations", { cache: "no-store" }),
      ]);
      const data = await statementResponse.json();
      if (!statementResponse.ok) throw new Error(data.error || "Could not load your statements.");
      setStatements(data.statements || []);
      if (destinationResponse.ok) {
        const destinationData = await destinationResponse.json();
        setDestinations(destinationData.destinations || []);
      } else setDestinations([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load your statements.");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load, memberId]);

  const visibleStatements = useMemo(() => statements.filter((statement) => statementTab === "CURRENT" ? statement.state === "CURRENT" : statementTab === "PREVIOUS" ? statement.state === "PAST" : statement.state === "UPCOMING"), [statements, statementTab]);
  const selectedStatement = useMemo(() => statements.find((statement) => statement.id === repayStatementId) || null, [statements, repayStatementId]);
  const qrProvider = method === "GCASH" ? "GCash" : bankProvider;
  const today = manilaDate(new Date());
  const repayableItems = selectedStatement ? selectedStatement.items.filter((item) =>
    item.loan.borrower.id === memberId && item.loan.status === "ACTIVE" && BigInt(item.remainingCentavos) > 0n
  ) : [];
  const statementQrDue = repayableItems.length > 0 && repayableItems.every((item) => today >= item.dueAt);
  const statementQrDestinations = selectedStatement && statementQrDue && (method === "GCASH" || method === "BANK_TRANSFER")
    ? [...new Map(repayableItems.map((item) => {
      const destination = destinations.find((d) => d.lenderId === item.loan.lender.id && d.method === method && d.provider === qrProvider);
      return destination ? [destination.lenderId, destination] as const : null;
    }).filter((entry): entry is readonly [string, Destination] => entry !== null)).values()]
    : [];

  async function submitRepayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedStatement || saving) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/member/statements/repay", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          periodStart: selectedStatement.periodStart, periodEnd: selectedStatement.periodEnd,
          method, reference: reference || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not submit this statement repayment.");
      setNotice("Statement repayment submitted across " + data.paymentCount + " loan item(s), awaiting acknowledgment from the other party or parties.");
      setRepayStatementId(null); setReference("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not submit this statement repayment.");
    } finally { setSaving(false); }
  }

  return <section className="workspace-stack">
    <div className="section-row"><div><h2>Your statements</h2><p className="workspace-muted">Each cutoff is a separate statement. Previous unpaid balances stay in their original statement and are not added to the current cutoff.</p></div><button className="text-button" type="button" onClick={() => void load()}>Refresh statements</button></div>
    {error && <div className="workspace-alert error" role="alert">{error}</div>}
    {notice && <div className="workspace-alert success" role="status">{notice}</div>}
    {loading && <div className="workspace-loading">Loading cutoff statements…</div>}
    {!loading && statements.length === 0 && <div className="workspace-card empty-state">No cutoff statements have been configured for your loans yet.</div>}
    {!loading && statements.length > 0 && <div className="statement-tabs" role="tablist" aria-label="Cutoff statement periods">
      {([{ key: "CURRENT", label: "Current" }, { key: "PREVIOUS", label: "Previous" }, { key: "UPCOMING", label: "Upcoming" }] as const).map((tab) => <button key={tab.key} type="button" role="tab" aria-selected={statementTab === tab.key} className={"statement-tab" + (statementTab === tab.key ? " active" : "")} onClick={() => setStatementTab(tab.key)}>{tab.label}<span>{statements.filter((statement) => tab.key === "CURRENT" ? statement.state === "CURRENT" : tab.key === "PREVIOUS" ? statement.state === "PAST" : statement.state === "UPCOMING").length}</span></button>)}
    </div>}
    {!loading && statements.length > 0 && visibleStatements.length === 0 && <div className="workspace-card empty-state">No {statementTab.toLowerCase()} cutoff statements.</div>}
    {!loading && visibleStatements.map((statement) => {
      const isOpen = expanded === statement.id;
      const stateLabel = statement.state === "CURRENT" ? "Current statement" : statement.state === "UPCOMING" ? "Upcoming statement" : "Previous statement";
      return <article className="workspace-card" key={statement.id}>
        <div className="member-loan-head"><div><span className="loan-code">{stateLabel}</span><h2>{new Date(statement.periodStart + "T12:00:00").toLocaleDateString()} – {new Date(statement.periodEnd + "T12:00:00").toLocaleDateString()}</h2><p>{statement.items.length} loan / cutoff item(s) · earliest due {statement.dueAt}</p></div><span className={"status-pill " + (statement.state === "CURRENT" ? "active" : statement.state === "UPCOMING" ? "pending" : "settled")}>{statement.state}</span></div>
        <div className="member-loan-stats"><div><small>Statement total</small><strong>{formatPhp(BigInt(statement.totalCentavos))}</strong></div><div><small>Confirmed paid</small><strong>{formatPhp(BigInt(statement.paidCentavos))}</strong></div><div><small>Remaining in this statement</small><strong>{formatPhp(BigInt(statement.remainingCentavos))}</strong></div></div>
        {BigInt(statement.pendingCentavos) > 0n && <p className="workspace-muted">Awaiting acknowledgment: {formatPhp(BigInt(statement.pendingCentavos))}. Pending payments are shown separately and do not count as confirmed paid.</p>}
        {(() => {
          const repayable = statement.items.filter((item) => item.loan.borrower.id === memberId && item.loan.status === "ACTIVE" && BigInt(item.remainingCentavos) > 0n);
          const repayableTotal = repayable.reduce((sum, item) => sum + BigInt(item.remainingCentavos), 0n);
          const hasPending = repayable.some((item) => item.payments.some((payment) => payment.status === "AWAITING_ACKNOWLEDGMENT"));
          const formOpen = repayStatementId === statement.id;
          return <>
            {repayableTotal > 0n && <div className="statement-repay-bar"><div><small>Unpaid amount you can repay for this statement</small><strong>{formatPhp(repayableTotal)}</strong>{hasPending && <span>One or more repayments are awaiting acknowledgment.</span>}</div><button className="primary-button" type="button" disabled={hasPending} onClick={() => { setRepayStatementId(formOpen ? null : statement.id); setReference(""); setError(""); }}>{formOpen ? "Cancel repayment" : "Repay this statement"}</button></div>}
            {formOpen && repayableTotal > 0n && <form className="workspace-form loan-form statement-repay-form" onSubmit={submitRepayment}>
              <div className="form-span"><strong>Statement repayment total: {formatPhp(repayableTotal)}</strong><p className="workspace-muted">Pactora will allocate this full unpaid statement amount across its eligible loan items. The individual breakdown and payment history remain available below.</p></div>
              <label>Payment method<select value={method} onChange={(e) => setMethod(e.target.value)}><option value="GCASH">GCash</option><option value="BANK_TRANSFER">Bank transfer</option><option value="CASH">Cash</option><option value="OTHER">Other</option></select></label>
              {method === "BANK_TRANSFER" && <label>Bank<select value={bankProvider} onChange={(e) => setBankProvider(e.target.value)}>{["BDO","BPI","Metrobank","UnionBank","LandBank","Other"].map((bank) => <option key={bank} value={bank}>{bank}</option>)}</select></label>}
              {(method === "GCASH" || method === "BANK_TRANSFER") && <div className="form-span payment-qr-member-list">
                {!repayable.every((item) => today >= item.dueAt) ? <><strong>Payment QR available when the statement items reach their cutoff due dates</strong><p className="workspace-muted">Bank and GCash QR payments unlock at 12:00 AM Philippine time once all unpaid items in this statement are due. Cash and other methods remain available earlier.</p></> : statementQrDestinations.length > 0 ? statementQrDestinations.map((destination) => <article className="payment-qr-member-card" key={destination.id}><PaymentQrImage src={destination.qrImageData} alt={destination.provider + " payment QR"} /><div><strong>{destination.provider}</strong>{destination.recipientName && <span>Recipient: {destination.recipientName}</span>}{destination.accountLabel && <span>{destination.accountLabel}</span>}<small>Verify the recipient and amount in your payment app before sending money.</small></div></article>) : <p className="payment-qr-missing">No matching {qrProvider} QR is configured for the lender or lenders in this statement. Contact them for payment instructions.</p>}
              </div>}
              <label className="form-span">Transaction reference {(method === "GCASH" || method === "BANK_TRANSFER") ? "(required)" : "(optional)"}<input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} required={method === "GCASH" || method === "BANK_TRANSFER"} placeholder="Transaction reference" /></label>
              <button className="primary-button form-span" type="submit" disabled={saving || hasPending || ((method === "GCASH" || method === "BANK_TRANSFER") && !repayable.every((item) => today >= item.dueAt))}>{saving ? "Submitting…" : "Submit full statement repayment"}</button>
            </form>}
          </>;
        })()}
        <button className="secondary-button" type="button" aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : statement.id)}>{isOpen ? "Hide breakdown" : "View statement breakdown"}</button>
        {isOpen && <div className="workspace-stack" style={{ marginTop: "1rem" }}>
          {statement.items.map((item) => {
            const pending = item.payments.some((payment) => payment.status === "AWAITING_ACKNOWLEDGMENT");
            return <section className="terms-summary" key={item.id}>
              <div className="member-loan-head"><div><strong>{item.loan.publicCode} · {item.loan.description}</strong><p>{item.loan.borrower.id === memberId ? "You are the borrower" : "You are the lender"} · with {item.loan.borrower.id === memberId ? item.loan.lender.displayName : item.loan.borrower.displayName}</p><small>Due {item.dueAt}{item.note ? " · " + item.note : ""}</small></div><span className="status-pill">{item.remainingCentavos === "0" ? "PAID" : pending ? "AWAITING ACK" : "BALANCE DUE"}</span></div>
              <div className="member-loan-stats"><div><small>Cutoff amount</small><strong>{formatPhp(BigInt(item.amountCentavos))}</strong></div><div><small>Confirmed paid</small><strong>{formatPhp(BigInt(item.paidCentavos))}</strong></div><div><small>Remaining</small><strong>{formatPhp(BigInt(item.remainingCentavos))}</strong></div></div>

              {item.payments.length > 0 && <div className="payment-history"><strong>Payment history for this cutoff</strong>{item.payments.map((payment) => <div className="payment-row" key={payment.id}><div><b>{formatPhp(BigInt(payment.amountCentavos))}</b><small>{payment.method.replaceAll("_", " ")} · {new Date(payment.createdAt).toLocaleDateString()}{payment.reference ? " · Ref: " + payment.reference : ""}</small></div><span className={"status-pill " + payment.status.toLowerCase().replaceAll("_", "-")}>{payment.status.replaceAll("_", " ")}</span></div>)}</div>}
            </section>;
          })}
        </div>}
      </article>;
    })}
  </section>;
}
