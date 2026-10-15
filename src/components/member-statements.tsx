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
  const [repayItemId, setRepayItemId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
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

  const selectedItem = useMemo(() => statements.flatMap((s) => s.items).find((item) => item.id === repayItemId) || null, [statements, repayItemId]);
  const due = selectedItem ? manilaDate(new Date()) >= selectedItem.dueAt : false;
  const qrProvider = method === "GCASH" ? "GCash" : bankProvider;
  const availableQr = selectedItem && due && (method === "GCASH" || method === "BANK_TRANSFER")
    ? destinations.find((d) => d.lenderId === selectedItem.loan.lender.id && d.method === method && d.provider === qrProvider)
    : undefined;

  async function submitRepayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedItem || saving) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/payments", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          loanId: selectedItem.loanId, cutoffInstallmentId: selectedItem.id, amountPhp: amount,
          method, reference: reference || undefined,
          note: "Statement repayment " + selectedItem.dueAt,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not submit this repayment.");
      setNotice("Repayment submitted for the selected cutoff and is awaiting the other party’s acknowledgment.");
      setRepayItemId(null); setAmount(""); setReference("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not submit this repayment.");
    } finally { setSaving(false); }
  }

  return <section className="workspace-stack">
    <div className="section-row"><div><h2>Your statements</h2><p className="workspace-muted">Each cutoff is a separate statement. Previous unpaid balances stay in their original statement and are not added to the current cutoff.</p></div><button className="text-button" type="button" onClick={() => void load()}>Refresh statements</button></div>
    {error && <div className="workspace-alert error" role="alert">{error}</div>}
    {notice && <div className="workspace-alert success" role="status">{notice}</div>}
    {loading && <div className="workspace-loading">Loading cutoff statements…</div>}
    {!loading && statements.length === 0 && <div className="workspace-card empty-state">No cutoff statements have been configured for your loans yet.</div>}
    {!loading && statements.map((statement) => {
      const isOpen = expanded === statement.id;
      const stateLabel = statement.state === "CURRENT" ? "Current statement" : statement.state === "UPCOMING" ? "Upcoming statement" : "Previous statement";
      return <article className="workspace-card" key={statement.id}>
        <div className="member-loan-head"><div><span className="loan-code">{stateLabel}</span><h2>{new Date(statement.periodStart + "T12:00:00").toLocaleDateString()} – {new Date(statement.periodEnd + "T12:00:00").toLocaleDateString()}</h2><p>{statement.items.length} loan / cutoff item(s) · earliest due {statement.dueAt}</p></div><span className={"status-pill " + (statement.state === "CURRENT" ? "active" : statement.state === "UPCOMING" ? "pending" : "settled")}>{statement.state}</span></div>
        <div className="member-loan-stats"><div><small>Statement total</small><strong>{formatPhp(BigInt(statement.totalCentavos))}</strong></div><div><small>Confirmed paid</small><strong>{formatPhp(BigInt(statement.paidCentavos))}</strong></div><div><small>Remaining in this statement</small><strong>{formatPhp(BigInt(statement.remainingCentavos))}</strong></div></div>
        {BigInt(statement.pendingCentavos) > 0n && <p className="workspace-muted">Awaiting acknowledgment: {formatPhp(BigInt(statement.pendingCentavos))}. Pending payments are shown separately and do not count as confirmed paid.</p>}
        <button className="secondary-button" type="button" aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : statement.id)}>{isOpen ? "Hide breakdown" : "View statement breakdown"}</button>
        {isOpen && <div className="workspace-stack" style={{ marginTop: "1rem" }}>
          {statement.items.map((item) => {
            const pending = item.payments.some((payment) => payment.status === "AWAITING_ACKNOWLEDGMENT");
            const canRepay = item.loan.borrower.id === memberId && item.loan.status === "ACTIVE" && BigInt(item.remainingCentavos) > 0n && !pending;
            const formOpen = repayItemId === item.id;
            return <section className="terms-summary" key={item.id}>
              <div className="member-loan-head"><div><strong>{item.loan.publicCode} · {item.loan.description}</strong><p>{item.loan.borrower.id === memberId ? "You are the borrower" : "You are the lender"} · with {item.loan.borrower.id === memberId ? item.loan.lender.displayName : item.loan.borrower.displayName}</p><small>Due {item.dueAt}{item.note ? " · " + item.note : ""}</small></div><span className="status-pill">{item.remainingCentavos === "0" ? "PAID" : pending ? "AWAITING ACK" : "BALANCE DUE"}</span></div>
              <div className="member-loan-stats"><div><small>Cutoff amount</small><strong>{formatPhp(BigInt(item.amountCentavos))}</strong></div><div><small>Confirmed paid</small><strong>{formatPhp(BigInt(item.paidCentavos))}</strong></div><div><small>Remaining</small><strong>{formatPhp(BigInt(item.remainingCentavos))}</strong></div></div>
              {canRepay && <button className="secondary-button" type="button" onClick={() => { setRepayItemId(formOpen ? null : item.id); setAmount(""); setReference(""); setError(""); }}>{formOpen ? "Cancel repayment" : "Repay this cutoff"}</button>}
              {formOpen && canRepay && <form className="workspace-form loan-form" onSubmit={submitRepayment}>
                <label>Amount (PHP)<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required placeholder="e.g. 500.00" /></label>
                <label>Payment method<select value={method} onChange={(e) => setMethod(e.target.value)}><option value="GCASH">GCash</option><option value="BANK_TRANSFER">Bank transfer</option><option value="CASH">Cash</option><option value="OTHER">Other</option></select></label>
                {method === "BANK_TRANSFER" && <label>Bank<select value={bankProvider} onChange={(e) => setBankProvider(e.target.value)}>{["BDO","BPI","Metrobank","UnionBank","LandBank","Other"].map((bank) => <option key={bank} value={bank}>{bank}</option>)}</select></label>}
                {(method === "GCASH" || method === "BANK_TRANSFER") && <div className="form-span payment-qr-member-list">
                  {!due ? <><strong>Payment QR available on the cutoff due date</strong><p className="workspace-muted">Bank and GCash QR payments unlock at 12:00 AM Philippine time on {item.dueAt}. Cash and other methods remain available before then.</p></> : availableQr ? <article className="payment-qr-member-card"><PaymentQrImage src={availableQr.qrImageData} alt={availableQr.provider + " payment QR"} /><div><strong>{availableQr.provider}</strong>{availableQr.recipientName && <span>Recipient: {availableQr.recipientName}</span>}{availableQr.accountLabel && <span>{availableQr.accountLabel}</span>}<small>Verify the recipient and amount in your payment app before sending money.</small></div></article> : <p className="payment-qr-missing">No {qrProvider} QR is configured for {item.loan.lender.displayName}. Contact the lender for payment instructions.</p>}
                </div>}
                <label className="form-span">Reference {(method === "GCASH" || method === "BANK_TRANSFER") ? "(required)" : "(optional)"}<input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} required={method === "GCASH" || method === "BANK_TRANSFER"} placeholder="Transaction reference" /></label>
                <button className="primary-button form-span" type="submit" disabled={saving}>{saving ? "Submitting…" : "Submit repayment for acknowledgment"}</button>
              </form>}
              {item.payments.length > 0 && <div className="payment-history"><strong>Payment history for this cutoff</strong>{item.payments.map((payment) => <div className="payment-row" key={payment.id}><div><b>{formatPhp(BigInt(payment.amountCentavos))}</b><small>{payment.method.replaceAll("_", " ")} · {new Date(payment.createdAt).toLocaleDateString()}{payment.reference ? " · Ref: " + payment.reference : ""}</small></div><span className={"status-pill " + payment.status.toLowerCase().replaceAll("_", "-")}>{payment.status.replaceAll("_", " ")}</span></div>)}</div>}
            </section>;
          })}
        </div>}
      </article>;
    })}
  </section>;
}
