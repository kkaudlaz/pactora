"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { formatPhp } from "@/lib/money";

type Member = { id: string; memberUid: string; displayName: string; email: string | null; role: "OWNER" | "MEMBER"; createdAt?: string };
type Loan = { id: string; publicCode: string; borrower: Member; lender: Member; category: string; description: string; principalCentavos: string; outstandingCentavos: string; repaymentTerms: string; dueAt: string | null; status: string; createdAt: string; myTermsAccepted: boolean; otherPartyAccepted: boolean; payments: { id: string; amountCentavos: string; method: string; status: string }[] };
type NewAccess = { displayName: string; accessUrl: string; memberUid: string };
type AuditEntry = { sequence: string; entityType: string; entityId: string; eventType: string; actorMemberId: string | null; payloadSha256: string; previousHash: string | null; eventHash: string; createdAt: string };
const categories = [{ value: "FOOD_GROCERIES", label: "Food & groceries" }, { value: "DELIVERY", label: "Delivery" }, { value: "PERSONAL_CASH", label: "Personal cash" }, { value: "BILLS", label: "Bills" }, { value: "REIMBURSEMENT", label: "Reimbursement" }, { value: "OTHER", label: "Other" }];

export default function WorkspacePage() {
  const router = useRouter();
  const [owner, setOwner] = useState<Member | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [tab, setTab] = useState<"overview" | "members" | "loans" | "activity">("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [memberName, setMemberName] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberPin, setMemberPin] = useState("");
  const [savingMember, setSavingMember] = useState(false);
  const [newAccess, setNewAccess] = useState<NewAccess | null>(null);
  const [borrowerId, setBorrowerId] = useState("");
  const [lenderId, setLenderId] = useState("");
  const [category, setCategory] = useState("FOOD_GROCERIES");
  const [description, setDescription] = useState("");
  const [amountPhp, setAmountPhp] = useState("");
  const [repaymentTerms, setRepaymentTerms] = useState("Repayment timing to be agreed by both parties.");
  const [dueDate, setDueDate] = useState("");
  const [savingLoan, setSavingLoan] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const meResponse = await fetch("/api/auth/me", { cache: "no-store" });
      if (!meResponse.ok) { router.replace("/login"); return; }
      const me = await meResponse.json();
      if (me.member?.role !== "OWNER") { router.replace("/member"); return; }
      setOwner(me.member);
      const [memberResponse, loanResponse, auditResponse] = await Promise.all([fetch("/api/admin/members", { cache: "no-store" }), fetch("/api/loans", { cache: "no-store" }), fetch("/api/admin/audit", { cache: "no-store" })]);
      const memberData = await memberResponse.json(); const loanData = await loanResponse.json(); const auditData = await auditResponse.json();
      if (!memberResponse.ok) throw new Error(memberData.error || "Could not load members.");
      if (!loanResponse.ok) throw new Error(loanData.error || "Could not load loans.");
      if (!auditResponse.ok) throw new Error(auditData.error || "Could not load audit history.");
      setMembers(memberData.members); setLoans(loanData.loans); setAuditEntries(auditData.entries);
      setBorrowerId((current) => current || memberData.members.find((m: Member) => m.role === "MEMBER")?.id || "");
      setLenderId((current) => current || me.member.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load Pactora."); }
    finally { setLoading(false); }
  }, [router]);
  useEffect(() => { void load(); }, [load]);

  async function createMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice(""); setSavingMember(true);
    try {
      const response = await fetch("/api/admin/members", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ displayName: memberName, email: memberEmail || undefined, pin: memberPin }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create member.");
      setNewAccess({ displayName: data.member.displayName, memberUid: data.member.memberUid, accessUrl: data.accessUrl });
      setMemberName(""); setMemberEmail(""); setMemberPin(""); setNotice("Member created. Share the personal QR link privately.");
      await load(); setTab("members");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create member."); }
    finally { setSavingMember(false); }
  }

  async function createLoan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice(""); setSavingLoan(true);
    try {
      const response = await fetch("/api/loans", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ borrowerId, lenderId, category, description, amountPhp, repaymentTerms, dueAt: dueDate ? new Date(`${dueDate}T23:59:00`).toISOString() : undefined }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create loan draft.");
      setNotice(`Draft ${data.loan.publicCode} saved. It is not active until the required parties approve the exact terms.`);
      setDescription(""); setAmountPhp(""); setDueDate(""); await load(); setTab("loans");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create loan draft."); }
    finally { setSavingLoan(false); }
  }

  async function approveLoan(loan: Loan) {
    setError(""); setNotice("");
    try {
      const response = await fetch(`/api/loans/${loan.id}/approve`, { method: "POST", headers: { "idempotency-key": crypto.randomUUID() } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not approve these terms.");
      setNotice(data.loan.status === "ACTIVE" ? "Both parties approved. This loan is now active." : "Your approval is recorded; the other party must approve the same terms.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not approve these terms."); }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }); router.replace("/login");
  }

  const active = loans.filter((loan) => loan.status === "ACTIVE");
  const receivable = active.filter((loan) => loan.lender.id === owner?.id).reduce((sum, loan) => sum + BigInt(loan.outstandingCentavos), 0n);
  const payable = active.filter((loan) => loan.borrower.id === owner?.id).reduce((sum, loan) => sum + BigInt(loan.outstandingCentavos), 0n);

  return <main className="workspace-shell"><header className="workspace-header"><a className="brand" href="/workspace"><span className="brand-mark">P</span><span><strong>pactora</strong><small>PRIVATE LEDGER</small></span></a><div className="workspace-head-right"><span className="secure-indicator"><i /> Owner workspace</span><span className="owner-name">{owner?.displayName || "Loading…"}</span><button className="secondary-button" onClick={logout}>Sign out</button></div></header>
    <div className="workspace-body"><aside className="workspace-nav"><div className="workspace-nav-label">WORKSPACE</div>{([{id:"overview",label:"Overview",icon:"◫"},{id:"loans",label:"Loans & drafts",icon:"⇄"},{id:"members",label:"Members & access",icon:"♙"},{id:"activity",label:"Audit history",icon:"◷"}] as const).map((item) => <button key={item.id} className={`nav-item ${tab===item.id?"selected":""}`} onClick={() => setTab(item.id)}><span className="nav-icon">{item.icon}</span>{item.label}</button>)}<div className="workspace-nav-note"><strong>Secure by default</strong><p>Drafts stay drafts until both parties approve the exact terms.</p></div></aside>
      <section className="workspace-content"><div className="page-heading"><div><div className="eyebrow">PACTORA · OWNER CONSOLE</div><h1>{tab==="overview"?"Your ledger, in one place.":tab==="members"?"Members & access":tab==="activity"?"Audit history":"Loans & agreements"}</h1><p>{tab==="overview"?"Manage family loans with a clear record of every decision.":tab==="members"?"Create member profiles and issue private QR access.":tab==="activity"?"Review the append-only audit chain and record hashes.":"Create drafts, review status, and track outstanding balances."}</p></div><button className="secondary-button" onClick={() => void load()}>↻ Refresh</button></div>
      {error && <div className="workspace-alert error" role="alert">{error}</div>}{notice && <div className="workspace-alert success" role="status">{notice}</div>}{loading && <div className="workspace-loading">Loading your private workspace…</div>}
      {!loading && tab==="overview" && <><div className="stats-grid"><div className="stat-card"><div className="stat-top">Active receivables <span className="stat-icon green">↗</span></div><strong className="stat-value">{formatPhp(receivable)}</strong><div className="stat-note">Confirmed active loans only</div></div><div className="stat-card"><div className="stat-top">Active payables <span className="stat-icon blue">↙</span></div><strong className="stat-value">{formatPhp(payable)}</strong><div className="stat-note">Confirmed active loans only</div></div><div className="stat-card"><div className="stat-top">Members <span className="stat-icon purple">♙</span></div><strong className="stat-value">{members.filter((m)=>m.role==="MEMBER").length}</strong><div className="stat-note">Active member profiles</div></div><div className="stat-card"><div className="stat-top">Pending drafts <span className="stat-icon amber">◷</span></div><strong className="stat-value">{loans.filter((l)=>l.status==="DRAFT"||l.status==="AWAITING_APPROVAL").length}</strong><div className="stat-note">Not counted as confirmed debt</div></div></div><div className="section-row"><div><h2>Recent loan records</h2><p>All amounts are persisted in PostgreSQL.</p></div><button className="text-button" onClick={()=>setTab("loans")}>View loans →</button></div><LoanTable loans={loans.slice(0,6)} ownerId={owner?.id} onApprove={approveLoan} /></>}
      {!loading && tab==="members" && <div className="workspace-columns"><section className="workspace-card"><h2>Add a member</h2><p className="workspace-muted">Set a personal PIN and create a revocable QR access grant. Give the QR privately to that member.</p><form className="workspace-form" onSubmit={createMember}><label>Full name<input value={memberName} onChange={(e)=>setMemberName(e.target.value)} required minLength={2} maxLength={100} placeholder="e.g. Alex Rivera" /></label><label>Email (optional)<input type="email" value={memberEmail} onChange={(e)=>setMemberEmail(e.target.value)} maxLength={254} placeholder="member@example.com" /></label><label>Initial PIN<input inputMode="numeric" type="password" pattern="[0-9]{6,12}" minLength={6} maxLength={12} value={memberPin} onChange={(e)=>setMemberPin(e.target.value.replace(/[^0-9]/g,""))} required placeholder="6–12 digits" /></label><button className="primary-button" type="submit" disabled={savingMember}>{savingMember?"Creating…":"＋ Create member"}</button></form></section><section className="workspace-card"><h2>Current members</h2><p className="workspace-muted">Member IDs are identifiers, not secrets.</p><div className="member-list">{members.map((member)=><div className="member-row" key={member.id}><span className="person-avatar">{member.displayName.split(" ").map((p)=>p[0]).join("").slice(0,2).toUpperCase()}</span><div className="member-row-main"><strong>{member.displayName}</strong><small>{member.memberUid} · {member.role==="OWNER"?"Owner":"Member"}</small></div><span className="member-status">Active</span></div>)}</div></section></div>}
      {!loading && tab==="loans" && <><section className="workspace-card loan-create-card"><h2>Create a loan draft</h2><p className="workspace-muted">This creates a versioned draft only. It will not count as an active obligation until approval workflow is completed.</p>{members.filter((m)=>m.role==="MEMBER").length===0?<div className="form-note">Create at least one member before adding a loan.</div>:<form className="workspace-form loan-form" onSubmit={createLoan}><label>Borrower<select value={borrowerId} onChange={(e)=>setBorrowerId(e.target.value)} required><option value="">Select borrower</option>{members.filter((m)=>m.role==="MEMBER").map((m)=><option key={m.id} value={m.id}>{m.displayName}</option>)}</select></label><label>Lender<select value={lenderId} onChange={(e)=>setLenderId(e.target.value)} required><option value="">Select lender</option>{members.map((m)=><option key={m.id} value={m.id}>{m.displayName}{m.role==="OWNER"?" (owner)":""}</option>)}</select></label><label>Category<select value={category} onChange={(e)=>setCategory(e.target.value)}>{categories.map((c)=><option key={c.value} value={c.value}>{c.label}</option>)}</select></label><label>Amount (PHP)<input inputMode="decimal" value={amountPhp} onChange={(e)=>setAmountPhp(e.target.value)} placeholder="e.g. 1250.00" required /></label><label className="form-span">Purpose / description<input value={description} onChange={(e)=>setDescription(e.target.value)} required maxLength={500} placeholder="What is this loan for?" /></label><label>Due date (optional)<input type="date" value={dueDate} onChange={(e)=>setDueDate(e.target.value)} /></label><label className="form-span">Repayment terms<textarea value={repaymentTerms} onChange={(e)=>setRepaymentTerms(e.target.value)} required minLength={1} maxLength={2000} rows={3} /></label><button className="primary-button form-span" type="submit" disabled={savingLoan||!borrowerId||!lenderId}>{savingLoan?"Saving draft…":"Save loan draft"}</button></form>}</section><div className="section-row workspace-loans-heading"><div><h2>All loan records</h2><p>Only confirmed payments affect the outstanding balance.</p></div></div><LoanTable loans={loans} ownerId={owner?.id} onApprove={approveLoan} /></>}
      {!loading && tab==="activity" && <section className="workspace-card"><h2>Audit history</h2><p className="workspace-muted">Latest 100 entries, newest first. Each event hash links to the previous event hash; hashes help detect edits but do not prove the original claim was true.</p><div className="audit-list">{auditEntries.map((entry)=><article className="audit-entry" key={entry.sequence}><div className="audit-entry-top"><span className="audit-sequence">#{entry.sequence}</span><span className="status-pill">{entry.entityType}</span><time>{new Date(entry.createdAt).toLocaleString()}</time></div><strong>{entry.eventType.replaceAll("_"," ")}</strong><p>{entry.entityId}</p><div className="audit-hash"><small>EVENT HASH</small><code>{entry.eventHash}</code></div><div className="audit-hash"><small>PREVIOUS HASH</small><code>{entry.previousHash||"GENESIS"}</code></div></article>)}{auditEntries.length===0&&<div className="empty-state">No audit events have been recorded yet.</div>}</div></section>}
      </section></div>
      {newAccess && <div className="modal-backdrop" role="presentation"><section className="access-modal" role="dialog" aria-modal="true" aria-labelledby="qr-title"><button className="modal-close" aria-label="Close" onClick={()=>setNewAccess(null)}>×</button><div className="eyebrow">MEMBER ACCESS CREATED</div><h2 id="qr-title">Personal QR for {newAccess.displayName}</h2><p className="workspace-muted">This token is shown once. Share the QR or link privately. The member must still enter their PIN.</p><div className="qr-frame"><QRCodeSVG value={newAccess.accessUrl} size={190} level="M" includeMargin /></div><div className="member-uid-label">MEMBER ID</div><code>{newAccess.memberUid}</code><button className="primary-button auth-submit" onClick={async()=>{await navigator.clipboard.writeText(newAccess.accessUrl);setNotice("Private QR access link copied.");}}>Copy private access link</button><button className="secondary-button auth-submit" onClick={()=>setNewAccess(null)}>Done — hide token</button><p className="auth-footnote">If you lose this link, revoke the grant and issue a new QR in the access-management phase.</p></section></div>}
    </main>;
}

function LoanTable({loans,ownerId,onApprove}:{loans:Loan[];ownerId?:string;onApprove:(loan:Loan)=>void}) { return <div className="table-wrap"><table><thead><tr><th>REFERENCE</th><th>BORROWER / LENDER</th><th>PURPOSE</th><th>PRINCIPAL</th><th>OUTSTANDING</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>{loans.map((loan)=><tr key={loan.id}><td><strong>{loan.publicCode}</strong><small className="table-subline">{new Date(loan.createdAt).toLocaleDateString()}</small></td><td><strong>{loan.borrower.displayName}</strong><small className="table-subline">Lender: {loan.lender.displayName}</small></td><td>{loan.description}<small className="table-subline">{categories.find((c)=>c.value===loan.category)?.label||loan.category}</small></td><td>{formatPhp(BigInt(loan.principalCentavos))}</td><td>{formatPhp(BigInt(loan.outstandingCentavos))}</td><td><span className={`status-pill ${loan.status.toLowerCase().replaceAll("_","-")}`}>{loan.status.replaceAll("_"," ")}</span></td><td>{ownerId && (loan.borrower.id===ownerId||loan.lender.id===ownerId) && (loan.status==="DRAFT"||loan.status==="AWAITING_APPROVAL") && !loan.myTermsAccepted ? <button className="secondary-button" onClick={()=>onApprove(loan)}>Approve terms</button> : <span className="table-subline">{loan.myTermsAccepted?"Approved":"—"}</span>}</td></tr>)}</tbody></table>{loans.length===0&&<div className="empty-state">No loan records yet. Create a draft to get started.</div>}</div>; }
