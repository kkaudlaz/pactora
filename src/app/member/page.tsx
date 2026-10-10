"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatPhp } from "@/lib/money";

type Payment = { id: string; amountCentavos: string; method: string; status: string; createdByMemberId: string | null; paidAt: string | null; createdAt: string };
type Loan = { id: string; publicCode: string; borrower: {id:string;displayName:string}; lender: {id:string;displayName:string}; category: string; description: string; principalCentavos: string; outstandingCentavos: string; repaymentTerms: string; borrowedAt?: string; dueAt: string|null; status: string; termsVersion: number; termsHash: string|null; createdAt: string; myTermsAccepted: boolean; otherPartyAccepted: boolean; payments: Payment[] };
type Member = {id:string;displayName:string;role:"OWNER"|"MEMBER"};

export default function MemberPage() {
  const router = useRouter();
  const [member,setMember]=useState<Member|null>(null);
  const [loans,setLoans]=useState<Loan[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [selectedLoanIds,setSelectedLoanIds]=useState<string[]>([]);
  const [paymentAmounts,setPaymentAmounts]=useState<Record<string,string>>({});
  const [method,setMethod]=useState("GCASH");
  const [reference,setReference]=useState("");
  const [saving,setSaving]=useState(false);

  const load=useCallback(async()=>{
    setLoading(true);setError("");
    try{
      const meResponse=await fetch("/api/auth/me",{cache:"no-store"});
      if(!meResponse.ok){router.replace("/");return;}
      const me=await meResponse.json();
      if(me.member?.role==="OWNER"){router.replace("/workspace");return;}
      setMember(me.member);
      const response=await fetch("/api/loans",{cache:"no-store"});const data=await response.json();
      if(!response.ok)throw new Error(data.error||"Could not load your records.");
      setLoans(data.loans);
      setSelectedLoanIds((current)=>current.filter((id)=>data.loans.some((loan:Loan)=>loan.id===id&&loan.status==="ACTIVE")));
    }catch(cause){setError(cause instanceof Error?cause.message:"Could not load your records.");}
    finally{setLoading(false);}
  },[router]);
  useEffect(()=>{void load();},[load]);

  async function confirmPayment(payment:Payment){
    setError("");setNotice("");
    try{const response=await fetch(`/api/payments/${payment.id}/confirm`,{method:"POST",headers:{"idempotency-key":crypto.randomUUID()}});const data=await response.json();if(!response.ok)throw new Error(data.error||"Could not confirm payment.");setNotice(data.settled?"Payment confirmed and loan settled.":"Payment acknowledgment recorded.");await load();}
    catch(cause){setError(cause instanceof Error?cause.message:"Could not confirm payment.");}
  }
  async function proposePayments(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(saving||!selectedLoanIds.length)return;setError("");setNotice("");setSaving(true);const failed:string[]=[];let succeeded=0;const successfulIds:string[]=[];
    for(const loanId of selectedLoanIds){try{const response=await fetch("/api/payments",{method:"POST",headers:{"content-type":"application/json","idempotency-key":crypto.randomUUID()},body:JSON.stringify({loanId,amountPhp:paymentAmounts[loanId],method,reference:reference||undefined})});const data=await response.json();if(!response.ok)failed.push((loans.find((loan)=>loan.id===loanId)?.publicCode||loanId)+": "+(data.error||"could not record"));else{succeeded++;successfulIds.push(loanId);}}catch{failed.push((loans.find((loan)=>loan.id===loanId)?.publicCode||loanId)+": request failed");}}
    setNotice(succeeded+" repayment(s) submitted for acknowledgment."+ (failed.length?" Failed: "+failed.join("; "):""));setSelectedLoanIds((current)=>current.filter((id)=>!successfulIds.includes(id)));setPaymentAmounts((current)=>Object.fromEntries(Object.entries(current).filter(([id])=>!successfulIds.includes(id))));await load();setSaving(false);
  }
  async function logout(){try{await fetch("/api/auth/logout",{method:"POST"});}finally{router.replace("/");router.refresh();}}
  const activeLoans=loans.filter((loan)=>loan.status==="ACTIVE");

  const owedToYou=activeLoans.filter((loan)=>loan.lender.id===member?.id).reduce((sum,loan)=>sum+BigInt(loan.outstandingCentavos),0n);
  const youOwe=activeLoans.filter((loan)=>loan.borrower.id===member?.id).reduce((sum,loan)=>sum+BigInt(loan.outstandingCentavos),0n);

  return <main className="workspace-shell"><header className="workspace-header"><a className="brand" href="/member"><span className="brand-mark">P</span><span><strong>pactora</strong><small>PRIVATE LEDGER</small></span></a><div className="workspace-head-right"><span className="secure-indicator"><i/> Personal records</span><span className="owner-name">{member?.displayName||"Loading…"}</span><button className="secondary-button" onClick={logout}>Sign out</button></div></header><div className="member-content"><div className="page-heading"><div><div className="eyebrow">YOUR PRIVATE LEDGER</div><h1>Hello{member?.displayName?`, ${member.displayName.split(" ")[0]}`:""}.</h1><p>Review your loan terms and repayment history. When you and the owner agree in person, the owner can record that activation in Pactora.</p></div><button className="secondary-button" onClick={()=>void load()}>↻ Refresh</button></div>
  {error&&<div className="workspace-alert error" role="alert">{error}</div>}{notice&&<div className="workspace-alert success" role="status">{notice}</div>}{loading&&<div className="workspace-loading">Loading your private records…</div>}
  {!loading&&<><div className="stats-grid"><div className="stat-card"><div className="stat-top">Owed to you <span className="stat-icon green">↗</span></div><strong className="stat-value">{formatPhp(owedToYou)}</strong><div className="stat-note">Confirmed active loans only</div></div><div className="stat-card"><div className="stat-top">You owe <span className="stat-icon blue">↙</span></div><strong className="stat-value">{formatPhp(youOwe)}</strong><div className="stat-note">Confirmed active loans only</div></div><div className="stat-card"><div className="stat-top">Your loan records <span className="stat-icon purple">⇄</span></div><strong className="stat-value">{loans.length}</strong><div className="stat-note">Loans involving your member ID</div></div><div className="stat-card"><div className="stat-top">Needs your attention <span className="stat-icon amber">◷</span></div><strong className="stat-value">{loans.filter((l)=>(l.status==="DRAFT"||l.status==="AWAITING_APPROVAL")&&!l.myTermsAccepted).length+loans.reduce((sum,l)=>sum+l.payments.filter((p)=>p.status==="AWAITING_ACKNOWLEDGMENT"&&p.createdByMemberId!==member?.id).length,0)}</strong><div className="stat-note">Pending terms or payment checks</div></div></div>
  {activeLoans.length>0&&<section className="workspace-card payment-proposal-card"><div className="section-row"><div><h2>Record repayments</h2><p className="workspace-muted">Choose multiple loans and enter a separate payment amount for each. Every repayment is sent for the other party to acknowledge.</p></div></div><form className="workspace-form loan-form" onSubmit={proposePayments}>
    <div className="form-span"><div className="section-row"><strong>Select active loans</strong><div className="table-actions"><button type="button" className="text-button" onClick={()=>setSelectedLoanIds(activeLoans.filter((loan)=>!loan.payments.some((payment)=>payment.status==="AWAITING_ACKNOWLEDGMENT")).map((loan)=>loan.id))}>Select available</button><button type="button" className="text-button" onClick={()=>setSelectedLoanIds([])}>Clear</button></div></div>
    <div className="payment-selection-list">{activeLoans.map((loan)=>{const pending=loan.payments.some((payment)=>payment.status==="AWAITING_ACKNOWLEDGMENT");return <div className="payment-selection-row" key={loan.id}><label className="payment-selection-check"><input type="checkbox" checked={selectedLoanIds.includes(loan.id)} disabled={pending} onChange={(e)=>setSelectedLoanIds((current)=>e.target.checked?[...current,loan.id]:current.filter((id)=>id!==loan.id))}/><span><strong>{loan.publicCode} · {loan.description}</strong><small>{loan.borrower.id===member?.id?"You are the borrower":"You are the lender"} · with {loan.borrower.id===member?.id?loan.lender.displayName:loan.borrower.displayName}</small><small>Outstanding: {formatPhp(BigInt(loan.outstandingCentavos))} · Due {loan.dueAt?new Date(loan.dueAt).toLocaleDateString():"not set"}{pending?" · Payment awaiting acknowledgment":""}</small></span></label>{selectedLoanIds.includes(loan.id)&&<label className="payment-selection-amount">Payment amount (PHP)<input inputMode="decimal" value={paymentAmounts[loan.id]||""} onChange={(e)=>setPaymentAmounts((current)=>({...current,[loan.id]:e.target.value}))} required placeholder="e.g. 500.00"/></label>}</div>})}</div></div>
    <label>Payment method<select value={method} onChange={(e)=>setMethod(e.target.value)}><option value="GCASH">GCash</option><option value="BANK_TRANSFER">Bank transfer</option><option value="CASH">Cash</option><option value="OTHER">Other</option></select></label>
    <label>Reference {method==="GCASH"||method==="BANK_TRANSFER"?"(required)":"(optional)"}<input value={reference} onChange={(e)=>setReference(e.target.value)} maxLength={200} required={method==="GCASH"||method==="BANK_TRANSFER"} placeholder="Transaction reference"/></label>
    <button className="primary-button form-span" type="submit" disabled={saving||!selectedLoanIds.length||selectedLoanIds.some((id)=>!paymentAmounts[id]?.trim())}>{saving?"Submitting repayments…":`Submit ${selectedLoanIds.length} selected repayment(s)`}</button>
  </form></section>}
  <div className="section-row"><div><h2>Your loans and agreements</h2><p>Only records where you are the borrower or lender appear here.</p></div></div>
  <div className="member-loan-list">{loans.map((loan)=><article className="member-loan-card" key={loan.id}><div className="member-loan-head"><div><span className="loan-code">{loan.publicCode}</span><h2>{loan.description}</h2><p>{loan.borrower.id===member?.id?"You are the borrower":"You are the lender"} · with {loan.borrower.id===member?.id?loan.lender.displayName:loan.borrower.displayName}</p></div><span className={`status-pill ${loan.status.toLowerCase().replaceAll("_","-")}`}>{loan.status.replaceAll("_"," ")}</span></div><div className="member-loan-stats"><div><small>Original amount</small><strong>{formatPhp(BigInt(loan.principalCentavos))}</strong></div><div><small>Outstanding</small><strong>{formatPhp(BigInt(loan.outstandingCentavos))}</strong></div><div><small>Due date</small><strong>{loan.dueAt?new Date(loan.dueAt).toLocaleDateString():"Not set"}</strong></div></div><div className="terms-summary"><strong>Repayment terms</strong><p>{loan.repaymentTerms}</p></div>
  {(loan.status==="DRAFT"||loan.status==="AWAITING_APPROVAL")&&<div className="approval-panel"><p>Loan activation is temporarily handled by the owner when both parties agree in person. Review the terms together and ask the owner to record that agreement.</p></div>}
  {loan.payments.length>0&&<div className="payment-history"><strong>Payment history</strong>{loan.payments.map((payment)=><div className="payment-row" key={payment.id}><div><b>{formatPhp(BigInt(payment.amountCentavos))}</b><small>{payment.method.replaceAll("_"," ")} · {new Date(payment.createdAt).toLocaleDateString()}</small></div><span className={`status-pill ${payment.status.toLowerCase().replaceAll("_","-")}`}>{payment.status.replaceAll("_"," ")}</span>{payment.status==="AWAITING_ACKNOWLEDGMENT"&&payment.createdByMemberId!==member?.id&&<button className="secondary-button" onClick={()=>void confirmPayment(payment)}>Confirm payment</button>}</div>)}</div>}
  </article>)}{loans.length===0&&<div className="empty-state member-empty">No loan records are linked to your member profile yet. Your owner can create a draft agreement for you.</div>}</div>

  </>}
  <p className="member-security-note">Your personal QR link grants access to these records. Keep it private. Confirm only payments you recognize; a screenshot or reference is supporting evidence, not automatic verification.</p></div></main>;
}
