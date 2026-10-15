"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { formatPhp } from "@/lib/money";

type Member = { id: string; displayName: string; role: "OWNER" | "MEMBER" };
type Cutoff = {
  id: string; loanId: string; periodStart: string; periodEnd: string; dueAt: string;
  amountCentavos: string; loan: { id: string; publicCode: string; description: string; status: string; borrower: { id: string; displayName: string }; lender: { id: string; displayName: string } };
  payments: { id: string; amountCentavos: string; status: string; reversals?: { amountCentavos: string; status: string }[] }[];
};
type Allocation = { cutoff: Cutoff; remaining: bigint; amount: bigint };

export default function GroupedRepayments({ members, ownerId, onChanged }: { members: Member[]; ownerId?: string; onChanged: () => Promise<void> }) {
  const [items, setItems] = useState<Cutoff[]>([]);
  const [memberId, setMemberId] = useState("");
  const [period, setPeriod] = useState("");
  const [amountPhp, setAmountPhp] = useState("");
  const [method, setMethod] = useState("CASH");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/cutoffs", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load cutoff balances.");
      setItems(data.installments || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load cutoff balances.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const memberOptions = useMemo(() => members.filter((m) => m.role === "MEMBER" && items.some((i) => i.loan.borrower.id === m.id && i.loan.lender.id === ownerId)), [members, items, ownerId]);
  const periods = useMemo(() => [...new Map(items.filter((i) => i.loan.borrower.id === memberId && i.loan.lender.id === ownerId && i.loan.status === "ACTIVE")
    .map((i) => [i.periodStart + ":" + i.periodEnd, { key: i.periodStart + ":" + i.periodEnd, start: i.periodStart, end: i.periodEnd }])).values()]
    .sort((a, b) => b.start.localeCompare(a.start)), [items, memberId, ownerId]);
  useEffect(() => {
    if (!periods.some((p) => p.key === period)) setPeriod(periods[0]?.key || "");
  }, [periods, period]);

  const selected = useMemo(() => {
    const [start, end] = period.split(":");
    return items.filter((i) => i.loan.borrower.id === memberId && i.loan.lender.id === ownerId && i.loan.status === "ACTIVE" && i.periodStart === start && i.periodEnd === end)
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.loan.publicCode.localeCompare(b.loan.publicCode));
  }, [items, memberId, ownerId, period]);
  const balances = useMemo(() => selected.map((cutoff) => {
    const applied = cutoff.payments.reduce((sum, payment) => {
      if (payment.status !== "CONFIRMED" && payment.status !== "AWAITING_ACKNOWLEDGMENT") return sum;
      const reversed = (payment.reversals || []).filter((r) => r.status === "CONFIRMED").reduce((n, r) => n + BigInt(r.amountCentavos), 0n);
      return sum + BigInt(payment.amountCentavos) - reversed;
    }, 0n);
    const remaining = BigInt(cutoff.amountCentavos) > applied ? BigInt(cutoff.amountCentavos) - applied : 0n;
    return { cutoff, remaining, pending: cutoff.payments.some((p) => p.status === "AWAITING_ACKNOWLEDGMENT") };
  }), [selected]);
  const total = balances.reduce((sum, row) => sum + row.remaining, 0n);
  const parsedAmount = /^\d+(?:\.\d{1,2})?$/.test(amountPhp.trim()) ? (() => { const [whole, fraction = ""] = amountPhp.trim().split("."); return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2)); })() : 0n;
  let left = parsedAmount;
  const preview: Allocation[] = [];
  for (const row of balances) {
    if (left <= 0n) break;
    const allocated = row.remaining < left ? row.remaining : left;
    if (allocated > 0n) preview.push({ cutoff: row.cutoff, remaining: row.remaining, amount: allocated });
    left -= allocated;
  }
  const hasPending = balances.some((row) => row.pending);
  const canSubmit = Boolean(memberId && period && parsedAmount > 0n && parsedAmount <= total && left === 0n && !hasPending && !busy && balances.length);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/repayments/grouped", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ memberId, periodStart: periods.find((p) => p.key === period)?.start, periodEnd: periods.find((p) => p.key === period)?.end, amountPhp, method, reference: reference || undefined }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not record grouped repayment.");
      setNotice(`Repayment allocated across ${data.payments.length} loan(s). Each entry is awaiting acknowledgment by the other party.`);
      setAmountPhp(""); setReference("");
      await load(); await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record grouped repayment.");
    } finally { setBusy(false); }
  }

  return <section className="workspace-card">
    <div className="section-row"><div><h2>Record a cutoff repayment</h2><p className="workspace-muted">Choose one member and cutoff. The entered amount is allocated to the earliest due loans first; review the breakdown before recording.</p></div><button type="button" className="text-button" onClick={() => void load()}>Refresh balances</button></div>
    {error && <div className="workspace-alert error" role="alert">{error}</div>}
    {notice && <div className="workspace-alert success" role="status">{notice}</div>}
    <form className="workspace-form loan-form" onSubmit={submit}>
      <label>Member<select value={memberId} onChange={(e) => { setMemberId(e.target.value); setPeriod(""); }} required><option value="">Choose member</option>{memberOptions.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}</select></label>
      <label>Cutoff period<select value={period} onChange={(e) => setPeriod(e.target.value)} required disabled={!memberId}><option value="">Choose cutoff</option>{periods.map((p) => <option key={p.key} value={p.key}>{p.start} – {p.end}</option>)}</select></label>
      {selected.length > 0 && <div className="form-span"><div className="table-wrap"><table><thead><tr><th>LOAN</th><th>DUE</th><th>CUTOFF AMOUNT</th><th>REMAINING</th></tr></thead><tbody>{balances.map(({ cutoff, remaining, pending }) => <tr key={cutoff.id}><td><strong>{cutoff.loan.publicCode}</strong><small className="table-subline">{cutoff.loan.description}</small>{pending && <small className="table-subline">Payment awaiting acknowledgment</small>}</td><td>{cutoff.dueAt}</td><td>{formatPhp(BigInt(cutoff.amountCentavos))}</td><td>{formatPhp(remaining)}</td></tr>)}</tbody><tfoot><tr><th colSpan={3}>Cutoff remaining total</th><th>{formatPhp(total)}</th></tr></tfoot></table></div></div>}
      <label>Payment method<select value={method} onChange={(e) => setMethod(e.target.value)}><option value="CASH">Cash</option><option value="GCASH">GCash</option><option value="BANK_TRANSFER">Bank transfer</option><option value="OTHER">Other</option></select></label>
      <label>Amount (PHP)<input inputMode="decimal" value={amountPhp} onChange={(e) => setAmountPhp(e.target.value)} required placeholder="e.g. 500.00" /></label>
      <label className="form-span">Reference / note (optional)<input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} placeholder="Receipt or transaction reference" /></label>
      {amountPhp.trim() && <div className="form-span workspace-card"><strong>Allocation preview</strong>{parsedAmount <= 0n ? <p className="workspace-muted">Enter a valid positive PHP amount.</p> : parsedAmount > total ? <p className="workspace-alert error">Amount exceeds this cutoff’s remaining total of {formatPhp(total)}.</p> : preview.map((row) => <div className="section-row" key={row.cutoff.id}><span>{row.cutoff.loan.publicCode} · due {row.cutoff.dueAt}</span><strong>{formatPhp(row.amount)}</strong></div>)}</div>}
      {hasPending && <p className="workspace-alert error form-span">A loan in this cutoff has a repayment awaiting acknowledgment. Confirm or resolve it before recording another grouped repayment.</p>}
      <button className="primary-button form-span" type="submit" disabled={!canSubmit}>{busy ? "Recording repayment…" : "Confirm allocation and record"}</button>
    </form>
  </section>;
}
