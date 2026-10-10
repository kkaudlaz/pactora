"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatPhp } from "@/lib/money";

type PurchasePayment = { id: string; amountCentavos: string; paidAt: string; note: string | null };
type Purchase = { id: string; purchaseType: "CREDIT_CARD" | "INSTALLMENT"; category: string; description: string; merchant: string | null; totalAmountCentavos: string; downPaymentCentavos: string; installmentCount: number | null; statementDate: string | null; dueAt: string | null; createdAt: string; payments: PurchasePayment[] };

export default function MyPurchasesPage() {
  const router = useRouter();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [purchaseType, setPurchaseType] = useState<"CREDIT_CARD" | "INSTALLMENT">("CREDIT_CARD");
  const [category, setCategory] = useState("Food & groceries");
  const [description, setDescription] = useState("");
  const [merchant, setMerchant] = useState("");
  const [totalAmountPhp, setTotalAmountPhp] = useState("");
  const [downPaymentPhp, setDownPaymentPhp] = useState("0");
  const [installmentCount, setInstallmentCount] = useState("3");
  const [statementDate, setStatementDate] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [paymentAmounts, setPaymentAmounts] = useState<Record<string,string>>({});
  const [paymentNotes, setPaymentNotes] = useState<Record<string,string>>({});
  const [payingId, setPayingId] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/my-purchases", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) { if (response.status === 401) { router.replace("/"); return; } if (response.status === 403) { router.replace("/member"); return; } throw new Error(data.error || "Could not load your personal purchase tracker."); }
      setPurchases(data.purchases);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load purchases."); }
    finally { setLoading(false); }
  }, [router]);
  useEffect(() => { void load(); }, [load]);

  async function createPurchase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/my-purchases", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ purchaseType, category, description, merchant, totalAmountPhp, downPaymentPhp, installmentCount: purchaseType === "INSTALLMENT" ? installmentCount : null, statementDate: statementDate || null, dueAt: dueAt || null }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save purchase.");
      setNotice("Personal purchase added to your private amount-owed tracker.");
      setDescription(""); setMerchant(""); setTotalAmountPhp(""); setDownPaymentPhp("0"); setStatementDate(""); setDueAt(""); setShowForm(false);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save purchase."); }
    finally { setSaving(false); }
  }

  async function recordPayment(purchase: Purchase) {
    setPayingId(purchase.id); setError(""); setNotice("");
    try {
      const response = await fetch("/api/my-purchases/" + encodeURIComponent(purchase.id) + "/payments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amountPhp: paymentAmounts[purchase.id], note: paymentNotes[purchase.id] || undefined }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not record payment.");
      setNotice("Payment recorded in your personal tracker.");
      setPaymentAmounts((current) => ({ ...current, [purchase.id]: "" }));
      setPaymentNotes((current) => ({ ...current, [purchase.id]: "" }));
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not record payment."); }
    finally { setPayingId(""); }
  }

  const balance = (purchase: Purchase) => BigInt(purchase.totalAmountCentavos) - BigInt(purchase.downPaymentCentavos) - purchase.payments.reduce((sum,payment)=>sum+BigInt(payment.amountCentavos),0n);
  const totalOwed = purchases.reduce((sum,purchase)=>sum+balance(purchase),0n);
  const remaining = purchases.filter((purchase)=>balance(purchase)>0n);

  return <main className="workspace-shell">
    <header className="workspace-header"><a className="brand" href="/workspace"><span className="brand-mark">P</span><span><strong>pactora</strong><small>PRIVATE LEDGER</small></span></a><div className="workspace-head-right"><span className="secure-indicator"><i/> Owner-only tracker</span><button className="secondary-button" onClick={()=>router.push("/workspace")}>Back to workspace</button></div></header>
    <div className="member-content">
      <div className="page-heading"><div><div className="eyebrow">PERSONAL FINANCE · PRIVATE TO OWNER</div><h1>My credit card & installments</h1><p>Track credit-card purchases and installment balances separately from loans between members. Includes groceries, food delivery, parcels, shopping, and other purchases charged to your card.</p></div><div className="table-actions"><button className="secondary-button" onClick={()=>void load()}>↻ Refresh</button><button className="primary-button" onClick={()=>setShowForm((value)=>!value)}>{showForm?"Close":"＋ Add purchase"}</button></div></div>
      {error&&<div className="workspace-alert error" role="alert">{error}</div>}{notice&&<div className="workspace-alert success" role="status">{notice}</div>}
      <div className="stats-grid"><div className="stat-card"><div className="stat-top">Outstanding amount</div><strong className="stat-value">{formatPhp(totalOwed)}</strong><div className="stat-note">Unpaid balance across your personal purchases</div></div><div className="stat-card"><div className="stat-top">Open purchases</div><strong className="stat-value">{remaining.length}</strong><div className="stat-note">Credit-card and installment records</div></div><div className="stat-card"><div className="stat-top">Credit-card purchases</div><strong className="stat-value">{purchases.filter((p)=>p.purchaseType==="CREDIT_CARD").length}</strong><div className="stat-note">Includes everyday card transactions</div></div><div className="stat-card"><div className="stat-top">Installment purchases</div><strong className="stat-value">{purchases.filter((p)=>p.purchaseType==="INSTALLMENT").length}</strong><div className="stat-note">Tracked against scheduled terms</div></div></div>
      {showForm&&<section className="workspace-card"><h2>Add a personal amount owed</h2><p className="workspace-muted">These records are visible only to the owner account and do not appear in member loans.</p><form className="workspace-form loan-form" onSubmit={createPurchase}>
        <label>Tracking type<select value={purchaseType} onChange={(e)=>setPurchaseType(e.target.value as "CREDIT_CARD"|"INSTALLMENT")}><option value="CREDIT_CARD">Credit card purchase</option><option value="INSTALLMENT">Installment purchase</option></select></label>
        <label>Category<select value={category} onChange={(e)=>setCategory(e.target.value)}>{["Food & groceries","Food delivery","Parcel / COD","Online shopping","Gadgets / appliances","Bills & utilities","Transport","Other"].map((item)=><option key={item}>{item}</option>)}</select></label>
        <label className="form-span">Purchase / order description<input value={description} onChange={(e)=>setDescription(e.target.value)} maxLength={300} required placeholder="e.g. grocery delivery, parcel, phone" /></label>
        <label>Merchant / store (optional)<input value={merchant} onChange={(e)=>setMerchant(e.target.value)} maxLength={160} placeholder="Store or seller" /></label>
        <label>Total amount (PHP)<input inputMode="decimal" value={totalAmountPhp} onChange={(e)=>setTotalAmountPhp(e.target.value)} required placeholder="e.g. 2500.00" /></label>
        <label>Down payment (PHP)<input inputMode="decimal" value={downPaymentPhp} onChange={(e)=>setDownPaymentPhp(e.target.value)} required placeholder="0.00" /></label>
        {purchaseType==="INSTALLMENT"&&<label>Number of installments<input type="number" min="1" max="120" value={installmentCount} onChange={(e)=>setInstallmentCount(e.target.value)} required /></label>}
        {purchaseType==="CREDIT_CARD"&&<label>Statement date (optional)<input type="date" value={statementDate} onChange={(e)=>setStatementDate(e.target.value)} /></label>}
        <label>Payment due date (optional)<input type="date" value={dueAt} onChange={(e)=>setDueAt(e.target.value)} /></label>
        <button className="primary-button form-span" type="submit" disabled={saving}>{saving?"Saving…":"Save personal purchase"}</button>
      </form></section>}
      {loading?<div className="workspace-loading">Loading your private purchases…</div>:purchases.length===0?<div className="empty-state">No personal purchases yet. Add a credit-card transaction or installment purchase to begin.</div>:<div className="member-loan-list">{purchases.map((purchase)=>{const owed=balance(purchase);return <article className="member-loan-card" key={purchase.id}>
        <div className="member-loan-head"><div><span className="loan-code">{purchase.purchaseType==="CREDIT_CARD"?"CREDIT CARD":"INSTALLMENT"} · {purchase.category}</span><h2>{purchase.description}</h2><p>{purchase.merchant||"Merchant not specified"} · Added {new Date(purchase.createdAt).toLocaleDateString()}</p></div><span className={"status-pill "+(owed===0n?"settled":purchase.dueAt&&new Date(purchase.dueAt)<new Date()?"disputed":"active")}>{owed===0n?"PAID":purchase.dueAt&&new Date(purchase.dueAt)<new Date()?"DUE / OVERDUE":"AMOUNT OWED"}</span></div>
        <div className="member-loan-stats"><div><small>Total purchase</small><strong>{formatPhp(BigInt(purchase.totalAmountCentavos))}</strong></div><div><small>Down payment</small><strong>{formatPhp(BigInt(purchase.downPaymentCentavos))}</strong></div><div><small>Outstanding</small><strong>{formatPhp(owed)}</strong></div><div><small>Payment due</small><strong>{purchase.dueAt?new Date(purchase.dueAt).toLocaleDateString():"Not set"}</strong></div>{purchase.purchaseType==="INSTALLMENT"&&<div><small>Installments</small><strong>{purchase.installmentCount}</strong></div>}{purchase.statementDate&&<div><small>Statement date</small><strong>{new Date(purchase.statementDate).toLocaleDateString()}</strong></div>}</div>
        <div className="payment-history"><strong>Payment history ({purchase.payments.length})</strong>{purchase.payments.length===0?<p className="workspace-muted">No payments recorded.</p>:purchase.payments.map((payment)=><div className="payment-row" key={payment.id}><div><b>{formatPhp(BigInt(payment.amountCentavos))}</b><small>{new Date(payment.paidAt).toLocaleString()}</small>{payment.note&&<small>{payment.note}</small>}</div></div>)}</div>
        {owed>0n&&<form className="workspace-form loan-form" onSubmit={(event)=>{event.preventDefault();void recordPayment(purchase);}}><label>Record payment (PHP)<input inputMode="decimal" value={paymentAmounts[purchase.id]||""} onChange={(e)=>setPaymentAmounts((current)=>({...current,[purchase.id]:e.target.value}))} required placeholder="Amount paid" /></label><label>Note (optional)<input value={paymentNotes[purchase.id]||""} onChange={(e)=>setPaymentNotes((current)=>({...current,[purchase.id]:e.target.value}))} maxLength={500} placeholder="e.g. credit card bill payment" /></label><button className="primary-button" type="submit" disabled={payingId===purchase.id}>{payingId===purchase.id?"Saving…":"Record payment"}</button></form>}
      </article>})}</div>}
    </div>
  </main>;
}
