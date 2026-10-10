"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatPhp } from "@/lib/money";

type Payment = { id: string; amountCentavos: string; method: string; status: string; createdByMemberId: string | null; paidAt: string | null; createdAt: string };
type Loan = { id: string; publicCode: string; borrower: {id:string;displayName:string}; lender: {id:string;displayName:string}; category: string; description: string; principalCentavos: string; outstandingCentavos: string; repaymentTerms: string; dueAt: string|null; status: string; termsVersion: number; termsHash: string|null; createdAt: string; myTermsAccepted: boolean; otherPartyAccepted: boolean; payments: Payment[] };
type Member = {id:string;displayName:string;role:"OWNER"|"MEMBER"};

export default function MemberPage() {
  const router = useRouter();
  const [member,setMember]=useState<Member|null>(null);
  const [loans,setLoans]=useState<Loan[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [selectedLoanId,setSelectedLoanId]=useState("");
  const [amount,setAmount]=useState("");
  const [method,setMethod]=useState("GCASH");
  const [reference,setReference]=useState("");
  const [saving,setSaving]=useState(false);

  const load=useCallback(async()=>{
    setLoading(true);setError("");
    try{
      const meResponse=await fetch("/api/auth/me",{cache:"no-store"});
      if(!meResponse.ok){router.replace("/access");return;}
      const me=await meResponse.json();
      if(me.member?.role==="OWNER"){router.replace("/workspace");return;}
      setMember(me.member);
      const response=await fetch("/api/loans",{cache:"no-store"});const data=await response.json();
      if(!response.ok)throw new Error(data.error||"Could not load your records.");
      setLoans(data.loans);
      setSelectedLoanId((current)=>current||data.loans.find((l:Loan)=>l.status==="ACTIVE")?.id||"");
    }catch(cause){setError(cause instanceof Error?cause.message:"Could not load your records.");}
    finally{setLoading(false);}
  },[router]);
  useEffect(()=>{void load();},[load]);

  async function approve(loan:Loan){
    setError("");setNotice("");
    try{const response=await fetch(`/api/loans/${loan.id}/approve`,{method:"POST",headers:{"idempotency-key":crypto.randomUUID()}});const data=await response.json();if(!response.ok)throw new Error(data.error||"Could not approve these terms.");setNotice(data.loan.status==="ACTIVE"?"Both parties have approved. The loan is now active.":"Your approval is recorded. The other party must approve the same terms before the loan becomes active.");await load();}
    catch(cause){setError(cause instanceof Error?cause.message:"Could not approve these terms.");}
  }
  async function confirmPayment(payment:Payment){
    setError("");setNotice("");
    try{const response=await fetch(`/api/payments/${payment.id}/confirm`,{method:"POST",headers:{"idempotency-key":crypto.randomUUID()}});const data=await response.json();if(!response.ok)throw new Error(data.error||"Could not confirm payment.");setNotice(data.settled?"Payment confirmed and loan settled.":"Payment acknowledgment recorded.");await load();}
    catch(cause){setError(cause instanceof Error?cause.message:"Could not confirm payment.");}
  }
  async function proposePayment(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(saving)return;setError("");setNotice("");setSaving(true);
    try{const response=await fetch("/api/payments",{method:"POST",headers:{"content-type":"application/json","idempotency-key":crypto.randomUUID()},body:JSON.stringify({loanId:selectedLoanId,amountPhp:amount,method,reference:reference||undefined})});const data=await response.json();if(!response.ok)throw new Error(data.error||"Could not propose payment.");setNotice("Payment recorded as awaiting acknowledgment. It will affect the confirmed balance only after the other party confirms it.");setAmount("");setReference("");await load();}
    catch(cause){setError(cause instanceof Error?cause.message:"Could not propose payment.");}
    finally{setSaving(false);}
  }
  async function logout(){await fetch("/api/auth/logout",{method:"POST"});router.replace("/access");}
  const activeLoans=loans.filter((loan)=>loan.status==="ACTIVE");
  const selectedLoan=activeLoans.find((loan)=>loan.id===selectedLoanId);
  const selectedLoanHasPendingPayment=Boolean(selectedLoan?.payments.some((payment)=>payment.status==="AWAITING_ACKNOWLEDGMENT"));
  const owedToYou=activeLoans.filter((loan)=>loan.lender.id===member?.id).reduce((sum,loan)=>sum+BigInt(loan.outstandingCentavos),0n);
  const youOwe=activeLoans.filter((loan)=>loan.borrower.id===member?.id).reduce((sum,loan)=>sum+BigInt(loan.outstandingCentavos),0n);

  return <main className="workspace-shell"><header className="workspace-header"><a className="brand" href="/member"><span className="brand-mark">P</span><span><strong>pactora</strong><small>PRIVATE LEDGER</small></span></a><div className="workspace-head-right"><span className="secure-indicator"><i/> Personal records</span><span className="owner-name">{member?.displayName||"Loading…"}</span><button className="secondary-button" onClick={logout}>Sign out</button></div></header><div className="member-content"><div className="page-heading"><div><div className="eyebrow">YOUR PRIVATE LEDGER</div><h1>Hello{member?.displayName?`, ${member.displayName.split(" ")[0]}`:""}.</h1><p>Review your loan terms and repayment history. When you and the owner agree in person, the owner can record that activation in Pactora.</p></div><button className="secondary-button" onClick={()=>void load()}>↻ Refresh</button></div>
  {error&&<div className="workspace-alert error" role="alert">{error}</div>}{notice&&<div className="workspace-alert success" role="status">{notice}</div>}{loading&&<div className="workspace-loading">Loading your private records…</div>}
  {!loading&&<><div className="stats-grid"><div className="stat-card"><div className="stat-top">Owed to you <span className="stat-icon green">↗</span></div><strong className="stat-value">{formatPhp(owedToYou)}</strong><div className="stat-note">Confirmed active loans only</div></div><div className="stat-card"><div className="stat-top">You owe <span className="stat-icon blue">↙</span></div><strong className="stat-value">{formatPhp(youOwe)}</strong><div className="stat-note">Confirmed active loans only</div></div><div className="stat-card"><div className="stat-top">Your loan records <span className="stat-icon purple">⇄</span></div><strong className="stat-value">{loans.length}</strong><div className="stat-note">Loans involving your member ID</div></div><div className="stat-card"><div className="stat-top">Needs your attention <span className="stat-icon amber">◷</span></div><strong className="stat-value">{loans.filter((l)=>(l.status==="DRAFT"||l.status==="AWAITING_APPROVAL")&&!l.myTermsAccepted).length+loans.reduce((sum,l)=>sum+l.payments.filter((p)=>p.status==="AWAITING_ACKNOWLEDGMENT"&&p.createdByMemberId!==member?.id).length,0)}</strong><div className="stat-note">Pending terms or payment checks</div></div></div>
  <div className="section-row"><div><h2>Your loans and agreements</h2><p>Only records where you are the borrower or lender appear here.</p></div></div>
  <div className="member-loan-list">{loans.map((loan)=><article className="member-loan-card" key={loan.id}><div className="member-loan-head"><div><span className="loan-code">{loan.publicCode}</span><h2>{loan.description}</h2><p>{loan.borrower.id===member?.id?"You are the borrower":"You are the lender"} · with {loan.borrower.id===member?.id?loan.lender.displayName:loan.borrower.displayName}</p></div><span className={`status-pill ${loan.status.toLowerCase().replaceAll("_","-")}`}>{loan.status.replaceAll("_"," ")}</span></div><div className="member-loan-stats"><div><small>Original amount</small><strong>{formatPhp(BigInt(loan.principalCentavos))}</strong></div><div><small>Outstanding</small><strong>{formatPhp(BigInt(loan.outstandingCentavos))}</strong></div><div><small>Due date</small><strong>{loan.dueAt?new Date(loan.dueAt).toLocaleDateString():"Not set"}</strong></div></div><div className="terms-summary"><strong>Repayment terms</strong><p>{loan.repaymentTerms}</p></div>
  {(loan.status==="DRAFT"||loan.status==="AWAITING_APPROVAL")&&<div className="approval-panel"><p>Loan activation is temporarily handled by the owner when both parties agree in person. Review the terms together and ask the owner to record that agreement.</p></div>}
  {loan.payments.length>0&&<div className="payment-history"><strong>Payment history</strong>{loan.payments.map((payment)=><div className="payment-row" key={payment.id}><div><b>{formatPhp(BigInt(payment.amountCentavos))}</b><small>{payment.method.replaceAll("_"," ")} · {new Date(payment.createdAt).toLocaleDateString()}</small></div><span className={`status-pill ${payment.status.toLowerCase().replaceAll("_","-")}`}>{payment.status.replaceAll("_"," ")}</span>{payment.status==="AWAITING_ACKNOWLEDGMENT"&&payment.createdByMemberId!==member?.id&&<button className="secondary-button" onClick={()=>void confirmPayment(payment)}>Confirm payment</button>}</div>)}</div>}
  </article>)}{loans.length===0&&<div className="empty-state member-empty">No loan records are linked to your member profile yet. Your owner can create a draft agreement for you.</div>}</div>
  {activeLoans.length>0&&<section className="workspace-card payment-proposal-card"><h2>Record a repayment</h2><p className="workspace-muted">This proposes a payment for the other party to acknowledge. GCash screenshots and other evidence uploads are not connected yet, so keep the transaction reference for now.</p><form className="workspace-form loan-form" onSubmit={proposePayment}><label>Loan<select value={selectedLoanId} onChange={(e)=>setSelectedLoanId(e.target.value)} required>{activeLoans.map((loan)=><option key={loan.id} value={loan.id}>{loan.publicCode} · {loan.description} · {formatPhp(BigInt(loan.outstandingCentavos))} remaining</option>)}</select></label><label>Amount (PHP)<input inputMode="decimal" value={amount} onChange={(e)=>setAmount(e.target.value)} placeholder="e.g. 500.00" required/></label><label>Payment method<select value={method} onChange={(e)=>setMethod(e.target.value)}><option value="GCASH">GCash</option><option value="BANK_TRANSFER">Bank transfer</option><option value="CASH">Cash</option><option value="OTHER">Other</option></select></label><label>Reference {method==="GCASH"||method==="BANK_TRANSFER"?"(required)":"(optional)"}<input value={reference} onChange={(e)=>setReference(e.target.value)} maxLength={200} required={method==="GCASH"||method==="BANK_TRANSFER"} placeholder="Transaction reference"/></label>{selectedLoanHasPendingPayment&&<p className="form-note form-span">A repayment for this loan is already awaiting acknowledgment. You can submit the next repayment after the other party responds.</p>}<button className="primary-button form-span" type="submit" disabled={saving||!selectedLoanId||selectedLoanHasPendingPayment}>{saving?"Submitting…":selectedLoanHasPendingPayment?"Repayment awaiting acknowledgment":"Submit payment for acknowledgment"}</button></form></section>}
  </>}
  <p className="member-security-note">Your personal QR link grants access to these records. Keep it private. Confirm only payments you recognize; a screenshot or reference is supporting evidence, not automatic verification.</p></div></main>;
}
