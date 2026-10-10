"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { formatPhp } from "@/lib/money";

type Member = { id: string; memberUid: string; displayName: string; email: string | null; phone?: string | null; role: "OWNER" | "MEMBER"; createdAt?: string; hasActiveAccess?: boolean };
type Loan = { id: string; publicCode: string; borrower: Member; lender: Member; category: string; description: string; principalCentavos: string; outstandingCentavos: string; repaymentTerms: string; borrowedAt?: string; dueAt: string | null; status: string; createdAt: string; myTermsAccepted: boolean; otherPartyAccepted: boolean; payments: { id: string; amountCentavos: string; method: string; status: string; createdByMemberId: string | null; createdAt: string; reference: string | null }[] };
type NewAccess = { displayName: string; accessUrl: string; memberUid: string };
type AuditCheck = { ok: boolean; checked: number; firstInvalidSequence: string | null };
type AuditEntry = { sequence: string; entityType: string; entityId: string; eventType: string; actorMemberId: string | null; payloadSha256: string; previousHash: string | null; eventHash: string; createdAt: string };
const categories = [{ value: "FOOD_GROCERIES", label: "Food & groceries" }, { value: "DELIVERY", label: "Delivery" }, { value: "PERSONAL_CASH", label: "Personal cash" }, { value: "BILLS", label: "Bills" }, { value: "REIMBURSEMENT", label: "Reimbursement" }, { value: "OTHER", label: "Other" }];

export default function WorkspacePage() {
  const router = useRouter();
  const [owner, setOwner] = useState<Member | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditCheck, setAuditCheck] = useState<AuditCheck | null>(null);
  const [verifyingAudit, setVerifyingAudit] = useState(false);
  const [tab, setTab] = useState<"overview" | "members" | "loans" | "payments" | "activity">("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [memberName, setMemberName] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberPhone, setMemberPhone] = useState("");
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editMemberName, setEditMemberName] = useState("");
  const [editMemberEmail, setEditMemberEmail] = useState("");
  const [editMemberPhone, setEditMemberPhone] = useState("");
  const [savingMemberEdit, setSavingMemberEdit] = useState(false);
  const [savingMember, setSavingMember] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [newAccess, setNewAccess] = useState<NewAccess | null>(null);
  const [borrowerId, setBorrowerId] = useState("");
  const [lenderId, setLenderId] = useState("");
  const [category, setCategory] = useState("FOOD_GROCERIES");
  const [description, setDescription] = useState("");
  const [amountPhp, setAmountPhp] = useState("");
  const [repaymentTerms, setRepaymentTerms] = useState("Repayment timing to be agreed by both parties.");
  const [borrowedDate, setBorrowedDate] = useState(new Date().toISOString().slice(0,10));
  const [dueDate, setDueDate] = useState("");
  const [savingLoan, setSavingLoan] = useState(false);
  const [showLoanForm, setShowLoanForm] = useState(false);
  const [selectedLoanIds, setSelectedLoanIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const meResponse = await fetch("/api/auth/me", { cache: "no-store" });
      if (!meResponse.ok) { router.replace("/"); return; }
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
      const response = await fetch("/api/admin/members", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ displayName: memberName, email: memberEmail || undefined, phone: memberPhone || undefined }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create member.");
      setNewAccess({ displayName: data.member.displayName, memberUid: data.member.memberUid, accessUrl: data.accessUrl });
      setMemberName(""); setMemberEmail(""); setMemberPhone(""); setNotice("Member created. Share the personal QR link privately.");
      await load(); setTab("members");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create member."); }
    finally { setSavingMember(false); }
  }

  function beginEditMember(member: Member) {
    setEditingMemberId(member.id); setEditMemberName(member.displayName); setEditMemberEmail(member.email || ""); setEditMemberPhone(member.phone || ""); setError(""); setNotice("");
  }

  async function saveMemberProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingMemberId || savingMemberEdit) return;
    setError(""); setNotice(""); setSavingMemberEdit(true);
    try {
      const response = await fetch("/api/admin/members/" + encodeURIComponent(editingMemberId) + "/profile", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: editMemberName, email: editMemberEmail, phone: editMemberPhone }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update member profile.");
      setEditingMemberId(null);
      setNotice("Member profile updated.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update member profile."); }
    finally { setSavingMemberEdit(false); }
  }

  async function downloadMemberQr(memberAccess: NewAccess) {
    try {
      const source = document.querySelector(".qr-frame svg");
      if (!(source instanceof SVGSVGElement)) throw new Error("QR image is not ready yet.");
      const svg = source.cloneNode(true) as SVGSVGElement;
      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      // Preserve the QR generator's original viewBox: changing it stretches or crops the code.
      svg.setAttribute("width", "600");
      svg.setAttribute("height", "600");
      const serialized = new XMLSerializer().serializeToString(svg);
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 1000;
        canvas.height = 1250;
        const ctx = canvas.getContext("2d");
        if (!ctx) { setError("Could not prepare the QR download."); return; }

        // Clean, print-ready card with generous spacing and a high-resolution QR.
        ctx.fillStyle = "#f2f5f1";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.roundRect(55, 55, 890, 1140, 34);
        ctx.fill();
        ctx.strokeStyle = "#dce5de";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(55, 55, 890, 1140, 34);
        ctx.stroke();

        ctx.fillStyle = "#163d32";
        ctx.beginPath();
        ctx.roundRect(100, 100, 64, 64, 16);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 42px Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("P", 132, 133);
        ctx.textAlign = "left";
        ctx.fillStyle = "#163d32";
        ctx.font = "bold 39px Arial, sans-serif";
        ctx.fillText("pactora", 185, 130);
        ctx.fillStyle = "#718079";
        ctx.font = "17px Arial, sans-serif";
        ctx.fillText("PRIVATE MEMBER RECORD", 185, 158);

        ctx.fillStyle = "#eaf2ed";
        ctx.beginPath();
        ctx.roundRect(120, 220, 760, 710, 24);
        ctx.fill();

        // Draw QR on a pure white quiet-zone background to maximize scanner reliability.
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.roundRect(230, 270, 540, 540, 18);
        ctx.fill();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(image, 250, 290, 500, 500);
        ctx.imageSmoothingEnabled = true;

        ctx.textAlign = "center";
        ctx.fillStyle = "#17201e";
        ctx.font = "bold 43px Arial, sans-serif";
        const name = memberAccess.displayName.trim();
        ctx.fillText(name, 500, 865, 700);
        ctx.fillStyle = "#718079";
        ctx.font = "20px Arial, sans-serif";
        ctx.fillText("PERSONAL MEMBER QR", 500, 905);

        ctx.strokeStyle = "#e4eae5";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(130, 990);
        ctx.lineTo(870, 990);
        ctx.stroke();
        ctx.fillStyle = "#53635b";
        ctx.font = "20px Arial, sans-serif";
        ctx.fillText("Scan to open this member's Pactora profile", 500, 1040);
        ctx.fillStyle = "#8a9690";
        ctx.font = "16px Arial, sans-serif";
        ctx.fillText("Keep this QR private. Anyone with the link may access the profile.", 500, 1080, 760);
        ctx.fillText("PACTORA  •  PRIVATE LEDGER", 500, 1140);

        const link = document.createElement("a");
        const safeName = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "member";
        link.download = "pactora-member-qr-" + safeName + ".png";
        link.href = canvas.toDataURL("image/png");
        link.click();
      };
      image.onerror = () => setError("Could not render the QR download. Try again.");
      image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(serialized);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not download the QR image.");
    }
  }

  async function createLoan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice(""); setSavingLoan(true);
    try {
      const response = await fetch("/api/loans", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ borrowerId, lenderId: owner?.id || lenderId, category, description, amountPhp, repaymentTerms, borrowedAt: new Date(`${borrowedDate}T12:00:00`).toISOString(), dueAt: dueDate ? new Date(`${dueDate}T23:59:00`).toISOString() : undefined }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create loan draft.");
      setNotice(`Draft ${data.loan.publicCode} saved. It is not active until the required parties approve the exact terms.`);
      setDescription(""); setAmountPhp(""); setBorrowedDate(new Date().toISOString().slice(0,10)); setDueDate(""); setShowLoanForm(false); await load(); setTab("loans");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create loan draft."); }
    finally { setSavingLoan(false); }
  }

  async function rotateQr(member: Member) {
    setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/members/${member.id}/access`, { method: "POST", headers: { "idempotency-key": crypto.randomUUID() } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not issue a new QR.");
      setNewAccess({ displayName: data.member.displayName, memberUid: data.member.memberUid, accessUrl: data.accessUrl });
      setNotice("New QR created. Any previous QR for this member has been revoked.");
      await load(); setTab("members");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not issue a new QR."); }
  }

  async function revokeQr(member: Member) {
    if (!window.confirm(`Revoke all QR access for ${member.displayName}? They will no longer be able to sign in until a new QR is issued.`)) return;
    setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/members/${member.id}/access`, { method: "DELETE", headers: { "idempotency-key": crypto.randomUUID() } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not revoke QR access.");
      setNotice(`Revoked ${data.revoked} active QR grant(s).`); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not revoke QR access."); }
  }

  async function verifyAudit() {
    setVerifyingAudit(true); setError("");
    try {
      const response = await fetch("/api/admin/audit/verify", { cache: "no-store" });
      const result = await response.json(); setAuditCheck(result);
      if (!result.ok) setError(`Audit verification failed at sequence ${result.firstInvalidSequence}. Preserve the database and investigate before making further changes.`);
      else setNotice(`Audit chain verified: ${result.checked} events checked.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not verify audit chain."); }
    finally { setVerifyingAudit(false); }
  }

  async function activateLoanInPerson(loan: Loan) {
    if (!window.confirm("Confirm that both parties have agreed to the current terms in person and activate " + loan.publicCode + "? This will be recorded as an owner declaration, not as either party's individual approval.")) return;
    setError(""); setNotice("");
    try {
      const response = await fetch(`/api/loans/${loan.id}/activate-in-person`, { method: "POST", headers: { "idempotency-key": crypto.randomUUID() } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not activate loan.");
      setNotice(`${data.loan.publicCode} activated with an owner-recorded in-person agreement.`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not activate loan."); }
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

  async function bulkLoanAction(action: "approve" | "activate-in-person") {
    const selected = loans.filter((loan) => selectedLoanIds.includes(loan.id) && (loan.status === "DRAFT" || loan.status === "AWAITING_APPROVAL"));
    if (!selected.length) { setNotice("Select draft loans eligible for bulk action first."); return; }
    const label = action === "approve" ? "approve terms online for" : "activate in person";
    if (!window.confirm(`Apply “${label}” to ${selected.length} selected loan(s)? Each loan will be processed individually and audited.`)) return;
    setBulkBusy(true); setError(""); setNotice("");
    const failures: string[] = []; let succeeded = 0;
    for (const loan of selected) {
      try {
        const response = await fetch(`/api/loans/${loan.id}/${action}`, { method: "POST", headers: { "idempotency-key": crypto.randomUUID() } });
        const data = await response.json();
        if (!response.ok) failures.push(`${loan.publicCode}: ${data.error || "failed"}`); else succeeded++;
      } catch { failures.push(`${loan.publicCode}: request failed`); }
    }
    setSelectedLoanIds([]); setNotice(`${succeeded} loan(s) processed.${failures.length ? ` ${failures.length} failed: ${failures.join("; ")}` : ""}`);
    await load(); setBulkBusy(false);
  }

  async function confirmPayment(paymentId: string) {
    setError(""); setNotice("");
    try {
      const response = await fetch("/api/payments/" + paymentId + "/confirm", { method: "POST", headers: { "idempotency-key": crypto.randomUUID() } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not acknowledge this payment.");
      setNotice(data.settled ? "Payment acknowledged. The loan is now settled." : "Payment acknowledged and recorded.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not acknowledge this payment."); }
  }

  async function logout() {
    try { await fetch("/api/auth/logout", { method: "POST" }); } finally { router.replace("/"); router.refresh(); }
  }

  const active = loans.filter((loan) => loan.status === "ACTIVE");
  const receivable = active.filter((loan) => loan.lender.id === owner?.id).reduce((sum, loan) => sum + BigInt(loan.outstandingCentavos), 0n);
  const payable = active.filter((loan) => loan.borrower.id === owner?.id).reduce((sum, loan) => sum + BigInt(loan.outstandingCentavos), 0n);

  return <main className="workspace-shell"><header className="workspace-header"><a className="brand" href="/workspace"><span className="brand-mark">P</span><span><strong>pactora</strong><small>PRIVATE LEDGER</small></span></a><div className="workspace-head-right"><span className="secure-indicator"><i /> Owner workspace</span><span className="owner-name">{owner?.displayName || "Loading…"}</span><button className="secondary-button" onClick={logout}>Sign out</button></div></header>
    <div className="workspace-body"><aside className="workspace-nav"><div className="workspace-nav-label">WORKSPACE</div>{([{id:"overview",label:"Overview",icon:"◫"},{id:"loans",label:"Loans & drafts",icon:"⇄"},{id:"payments",label:"Repayments",icon:"↗"},{id:"members",label:"Members & access",icon:"♙"},{id:"activity",label:"Audit history",icon:"◷"}] as const).map((item) => <button key={item.id} className={`nav-item ${tab===item.id?"selected":""}`} onClick={() => setTab(item.id)}><span className="nav-icon">{item.icon}</span>{item.label}</button>)}<button className="nav-item" onClick={() => router.push("/workspace/my-purchases")}><span className="nav-icon">▤</span>My card & installments</button><div className="workspace-nav-note"><strong>Secure by default</strong><p>Drafts stay drafts until both parties approve the exact terms.</p></div></aside>
      <section className="workspace-content"><div className="page-heading"><div><div className="eyebrow">PACTORA · OWNER CONSOLE</div><h1>{tab==="overview"?"Your ledger, in one place.":tab==="members"?"Members & access":tab==="payments"?"Repayments & acknowledgments":tab==="activity"?"Audit history":"Loans & agreements"}</h1><p>{tab==="overview"?"Manage family loans with a clear record of every decision.":tab==="members"?"Create member profiles and issue private QR access.":tab==="payments"?"Review every repayment, filter statuses, and acknowledge payments.":tab==="activity"?"Review the append-only audit chain and record hashes.":"Create drafts, review status, and track outstanding balances."}</p></div><button className="secondary-button" onClick={() => void load()}>↻ Refresh</button></div>
      {error && <div className="workspace-alert error" role="alert">{error}</div>}{notice && <div className="workspace-alert success" role="status">{notice}</div>}{loading && <div className="workspace-loading">Loading your private workspace…</div>}
      {!loading && tab==="overview" && <><div className="stats-grid"><div className="stat-card"><div className="stat-top">Active receivables <span className="stat-icon green">↗</span></div><strong className="stat-value">{formatPhp(receivable)}</strong><div className="stat-note">Confirmed active loans only</div></div><div className="stat-card"><div className="stat-top">Active payables <span className="stat-icon blue">↙</span></div><strong className="stat-value">{formatPhp(payable)}</strong><div className="stat-note">Confirmed active loans only</div></div><div className="stat-card"><div className="stat-top">Members <span className="stat-icon purple">♙</span></div><strong className="stat-value">{members.filter((m)=>m.role==="MEMBER").length}</strong><div className="stat-note">Active member profiles</div></div><div className="stat-card"><div className="stat-top">Pending drafts <span className="stat-icon amber">◷</span></div><strong className="stat-value">{loans.filter((l)=>l.status==="DRAFT"||l.status==="AWAITING_APPROVAL").length}</strong><div className="stat-note">Not counted as confirmed debt</div></div></div><div className="section-row"><div><h2>Recent loan records</h2><p>All amounts are persisted in PostgreSQL.</p></div><button className="text-button" onClick={()=>setTab("loans")}>View loans →</button></div><LoanTable loans={loans.slice(0,6)} ownerId={owner?.id} onApprove={approveLoan} onActivateInPerson={activateLoanInPerson} /><PaymentReview loans={loans} ownerId={owner?.id} onConfirm={confirmPayment} limit={5} onViewAll={()=>setTab("payments")} /></>}
      {!loading && tab==="members" && <div className="workspace-columns"><section className="workspace-card"><h2>Add a member</h2><p className="workspace-muted">Create a member profile and private QR link. Scanning the QR opens their records directly in temporary PIN-free mode.</p><form className="workspace-form" onSubmit={createMember}><label>Full name<input value={memberName} onChange={(e)=>setMemberName(e.target.value)} required minLength={2} maxLength={100} placeholder="e.g. Alex Rivera" /></label><label>Email (optional)<input type="email" value={memberEmail} onChange={(e)=>setMemberEmail(e.target.value)} maxLength={254} placeholder="member@example.com" /></label><label>Phone number (optional)<input type="tel" value={memberPhone} onChange={(e)=>setMemberPhone(e.target.value)} maxLength={40} placeholder="+63 9XX XXX XXXX" /></label><button className="primary-button" type="submit" disabled={savingMember}>{savingMember?"Creating…":"＋ Create member"}</button></form></section><section className="workspace-card"><h2>Current members</h2><p className="workspace-muted">Member IDs are identifiers, not secrets.</p><label className="member-search-label">Search members<input value={memberSearch} onChange={(e)=>setMemberSearch(e.target.value)} placeholder="Search name, member ID, or email" /></label><div className="member-list">{members.filter((member)=>`${member.displayName} ${member.memberUid} ${member.email||""} ${member.phone||""}`.toLowerCase().includes(memberSearch.trim().toLowerCase())).map((member)=>{const related=loans.filter((loan)=>loan.borrower.id===member.id||loan.lender.id===member.id);const activeRelated=related.filter((loan)=>loan.status==="ACTIVE");const outstanding=activeRelated.reduce((sum,loan)=>sum+BigInt(loan.outstandingCentavos),0n);const pending=related.reduce((sum,loan)=>sum+loan.payments.filter((payment)=>payment.status==="AWAITING_ACKNOWLEDGMENT").length,0);return <div className="member-row" key={member.id}><span className="person-avatar">{member.displayName.split(" ").map((p)=>p[0]).join("").slice(0,2).toUpperCase()}</span><div className="member-row-main"><button className="text-button member-profile-link" onClick={()=>router.push(`/workspace/members/${member.id}`)}>{member.displayName} →</button><small>{member.memberUid} · {member.role==="OWNER"?"Owner":"Member"}{member.email?` · ${member.email}`:""}{member.phone?` · ${member.phone}`:""}</small><small>{related.length} loan record(s) · {formatPhp(outstanding)} active outstanding · {pending} pending repayment(s)</small></div>{member.role==="MEMBER"&&<><span className={`member-status ${member.hasActiveAccess?"":"inactive"}`}>{member.hasActiveAccess?"QR active":"QR revoked"}</span><button className="secondary-button member-action" onClick={()=>void rotateQr(member)}>{member.hasActiveAccess?"Rotate QR":"Issue QR"}</button>{member.hasActiveAccess&&<button className="secondary-button member-action revoke-action" onClick={()=>void revokeQr(member)}>Revoke</button>}</>}<button className="secondary-button member-action" onClick={()=>beginEditMember(member)}>Edit</button><button className="secondary-button member-action" onClick={()=>router.push(`/workspace/members/${member.id}`)}>History</button>{editingMemberId===member.id&&<form className="workspace-form member-edit-form" onSubmit={saveMemberProfile}><label>Full name<input value={editMemberName} onChange={(e)=>setEditMemberName(e.target.value)} required minLength={2} maxLength={100}/></label><label>Email (optional)<input type="email" value={editMemberEmail} onChange={(e)=>setEditMemberEmail(e.target.value)} maxLength={254} placeholder="member@example.com"/></label><label>Phone number (optional)<input type="tel" value={editMemberPhone} onChange={(e)=>setEditMemberPhone(e.target.value)} maxLength={40} placeholder="+63 9XX XXX XXXX"/></label><div className="member-edit-actions"><button className="primary-button" type="submit" disabled={savingMemberEdit}>{savingMemberEdit?"Saving…":"Save changes"}</button><button className="secondary-button" type="button" onClick={()=>setEditingMemberId(null)}>Cancel</button></div></form>}</div>})}{members.filter((member)=>`${member.displayName} ${member.memberUid} ${member.email||""}`.toLowerCase().includes(memberSearch.trim().toLowerCase())).length===0&&<div className="empty-state">No members match that search.</div>}</div></section></div>}
      {!loading && tab==="loans" && <><div className="section-row loan-list-heading"><div><h2>All loan records</h2><p>{loans.length} record(s) · Only confirmed payments affect outstanding balances.</p></div><button className="primary-button" onClick={()=>setShowLoanForm((current)=>!current)} aria-expanded={showLoanForm}><span>{showLoanForm?"−":"＋"}</span>{showLoanForm?"Close form":"Create loan"}</button></div>{showLoanForm && <section className="workspace-card loan-create-card"><div className="loan-form-heading"><div><h2>Create a loan draft</h2><p className="workspace-muted">This creates a versioned draft only. It will not count as an active obligation until approval workflow is completed.</p></div><button className="modal-close loan-form-close" aria-label="Close create loan form" onClick={()=>setShowLoanForm(false)}>×</button></div>{members.filter((m)=>m.role==="MEMBER").length===0?<div className="form-note">Create at least one member before adding a loan.</div>:<form className="workspace-form loan-form" onSubmit={createLoan}><label>Borrower<select value={borrowerId} onChange={(e)=>setBorrowerId(e.target.value)} required><option value="">Select borrower</option>{members.filter((m)=>m.role==="MEMBER").map((m)=><option key={m.id} value={m.id}>{m.displayName}</option>)}</select></label><label>Category<select value={category} onChange={(e)=>setCategory(e.target.value)}>{categories.map((c)=><option key={c.value} value={c.value}>{c.label}</option>)}</select></label><label>Amount (PHP)<input inputMode="decimal" value={amountPhp} onChange={(e)=>setAmountPhp(e.target.value)} placeholder="e.g. 1250.00" required /></label><label className="form-span">Purpose / description<input value={description} onChange={(e)=>setDescription(e.target.value)} required maxLength={500} placeholder="What is this loan for?" /></label><label>Date borrowed<input type="date" value={borrowedDate} onChange={(e)=>setBorrowedDate(e.target.value)} required /></label><label>Due date (optional)<input type="date" value={dueDate} onChange={(e)=>setDueDate(e.target.value)} /></label><label className="form-span">Repayment terms<textarea value={repaymentTerms} onChange={(e)=>setRepaymentTerms(e.target.value)} required minLength={1} maxLength={2000} rows={3} /></label><button className="primary-button form-span" type="submit" disabled={savingLoan||!borrowerId||!lenderId}>{savingLoan?"Saving draft…":"Save loan draft"}</button></form>}</section>}<section className="workspace-card" style={{marginBottom:"1rem"}}><div className="section-row"><div><h2>Bulk actions</h2><p className="workspace-muted">Select draft loans below, then apply one action. Each loan is still checked by the existing server-side rules.</p></div><span className="status-pill">{selectedLoanIds.length} selected</span></div><div className="table-actions"><button className="secondary-button" onClick={()=>setSelectedLoanIds(loans.filter((loan)=>loan.status==="DRAFT"||loan.status==="AWAITING_APPROVAL").map((loan)=>loan.id))}>Select eligible drafts</button><button className="secondary-button" onClick={()=>setSelectedLoanIds([])}>Clear selection</button><button className="primary-button" disabled={bulkBusy||!selectedLoanIds.length} onClick={()=>void bulkLoanAction("approve")}>{bulkBusy?"Processing…":"Approve selected"}</button><button className="primary-button" disabled={bulkBusy||!selectedLoanIds.length} onClick={()=>void bulkLoanAction("activate-in-person")}>Activate selected in person</button></div><div className="table-wrap"><table><thead><tr><th>Select</th><th>Loan</th><th>Borrower</th><th>Amount</th><th>Status</th></tr></thead><tbody>{loans.filter((loan)=>loan.status==="DRAFT"||loan.status==="AWAITING_APPROVAL").map((loan)=><tr key={loan.id}><td><input type="checkbox" aria-label={`Select ${loan.publicCode}`} checked={selectedLoanIds.includes(loan.id)} onChange={(e)=>setSelectedLoanIds((current)=>e.target.checked?[...current.filter((id)=>id!==loan.id),loan.id]:current.filter((id)=>id!==loan.id))}/></td><td><strong>{loan.publicCode}</strong><small className="table-subline">{loan.description}</small></td><td>{loan.borrower.displayName}</td><td>{formatPhp(BigInt(loan.principalCentavos))}</td><td>{loan.status.replaceAll("_"," ")}</td></tr>)}</tbody></table>{loans.every((loan)=>loan.status!=="DRAFT"&&loan.status!=="AWAITING_APPROVAL")&&<div className="empty-state">No draft loans are eligible for bulk actions.</div>}</div></section><LoanTable loans={loans} ownerId={owner?.id} onApprove={approveLoan} onActivateInPerson={activateLoanInPerson} /></>}
      {!loading && tab==="payments" && <><OwnerPaymentEntry loans={loans} ownerId={owner?.id} onSaved={async()=>{setNotice("Payment saved and awaiting the other party’s acknowledgment.");await load();}} /><PaymentReview loans={loans} ownerId={owner?.id} onConfirm={confirmPayment} /></>}
      {!loading && tab==="activity" && <section className="workspace-card"><div className="audit-heading"><div><h2>Audit history</h2><p className="workspace-muted">Latest 100 entries, newest first. Hashes can reveal changes to recorded events but do not prove the original claim was true.</p></div><button className="secondary-button" onClick={()=>void verifyAudit()} disabled={verifyingAudit}>{verifyingAudit?"Verifying…":"Verify full chain"}</button></div>{auditCheck&&<div className={`audit-result ${auditCheck.ok?"good":"bad"}`}>{auditCheck.ok?`Verified ${auditCheck.checked} audit events; no hash-chain mismatch found.`:`Mismatch at event sequence ${auditCheck.firstInvalidSequence}. Stop using the ledger and investigate.`}</div>}<div className="audit-list">{auditEntries.map((entry)=><article className="audit-entry" key={entry.sequence}><div className="audit-entry-top"><span className="audit-sequence">#{entry.sequence}</span><span className="status-pill">{entry.entityType}</span><time>{new Date(entry.createdAt).toLocaleString()}</time></div><strong>{entry.eventType.replaceAll("_"," ")}</strong><p>{entry.entityId}</p><div className="audit-hash"><small>EVENT HASH</small><code>{entry.eventHash}</code></div><div className="audit-hash"><small>PREVIOUS HASH</small><code>{entry.previousHash||"GENESIS"}</code></div></article>)}{auditEntries.length===0&&<div className="empty-state">No audit events have been recorded yet.</div>}</div></section>}
      </section></div>
      {newAccess && <div className="modal-backdrop" role="presentation"><section className="access-modal" role="dialog" aria-modal="true" aria-labelledby="qr-title"><button className="modal-close" aria-label="Close" onClick={()=>setNewAccess(null)}>×</button><div className="eyebrow">MEMBER ACCESS CREATED</div><h2 id="qr-title">Personal QR for {newAccess.displayName}</h2><p className="workspace-muted">Scanning this personal QR opens the member profile directly. Keep the link private because it grants access to the profile.</p><div className="qr-frame"><QRCodeSVG value={newAccess.accessUrl} size={190} level="M" includeMargin /></div><div className="member-uid-label">MEMBER ID</div><code>{newAccess.memberUid}</code><button className="primary-button auth-submit" onClick={()=>void downloadMemberQr(newAccess)}>Download QR with name (PNG)</button><button className="secondary-button auth-submit" onClick={async()=>{await navigator.clipboard.writeText(newAccess.accessUrl);setNotice("Private QR access link copied.");}}>Copy private access link</button><button className="secondary-button auth-submit" onClick={()=>setNewAccess(null)}>Done — hide token</button><p className="auth-footnote">Anyone with this QR can open this member profile. Share it privately and revoke it if it is lost.</p></section></div>}
    </main>;
}

function PaymentReview({loans,ownerId,onConfirm,limit,onViewAll}:{loans:Loan[];ownerId?:string;onConfirm:(paymentId:string)=>void;limit?:number;onViewAll?:()=>void}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [loanFilterIds, setLoanFilterIds] = useState<string[]>([]);
  const payments = loans.flatMap((loan) => loan.payments.map((payment) => ({ ...payment, loan }))).sort((a,b) => new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());
  const pending = payments.filter((p) => p.status === "AWAITING_ACKNOWLEDGMENT").length;
  const filtered = payments.filter((payment) => {
    const haystack = [payment.loan.publicCode,payment.loan.description,payment.reference||"",payment.method,payment.status,payment.createdByMemberId===ownerId?"you":"other party"].join(" ").toLowerCase();
    return haystack.includes(search.trim().toLowerCase()) && (statusFilter==="ALL" || payment.status===statusFilter) && (!loanFilterIds.length || loanFilterIds.includes(payment.loan.id));
  });
  const visible = limit ? filtered.slice(0,limit) : filtered;
  return <section className="workspace-card payment-review-card">
    <div className="section-row"><div><h2>Repayments & acknowledgments</h2><p>Pending repayments do not reduce the balance until the other party acknowledges them.</p></div><span className="status-pill">{pending} pending</span></div>
    {payments.length===0 ? <div className="empty-state">No repayment records have been submitted yet.</div> : <>
      <div className="payment-toolbar"><label className="payment-search"><span aria-hidden="true">⌕</span><input aria-label="Search repayments" value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search loan, reference, method…" /></label><select aria-label="Filter repayment status" value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value)}><option value="ALL">All statuses</option><option value="AWAITING_ACKNOWLEDGMENT">Awaiting acknowledgment</option><option value="CONFIRMED">Confirmed</option></select><label className="payment-loan-filter"><span className="sr-only">Filter by one or more loans</span><select aria-label="Filter repayments by multiple loans" multiple value={loanFilterIds} onChange={(e)=>setLoanFilterIds(Array.from(e.target.selectedOptions,(option)=>option.value))}>{loans.map((loan)=><option key={loan.id} value={loan.id}>{loan.publicCode} · {loan.description}</option>)}</select></label></div><p className="workspace-muted payment-filter-hint">Tip: hold Ctrl (Windows) or Command (Mac) to filter by multiple loans.</p>
      {visible.length===0 ? <div className="empty-state">No repayments match those filters.</div> : <div className="table-wrap"><table><thead><tr><th>LOAN</th><th>REPAYMENT</th><th>SUBMITTED</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>{visible.map((payment)=><tr key={payment.id}>
        <td><strong>{payment.loan.publicCode}</strong><small className="table-subline">{payment.loan.description}</small></td>
        <td><strong>{formatPhp(BigInt(payment.amountCentavos))}</strong><small className="table-subline">{payment.method.replaceAll("_"," ")}{payment.reference ? " · Ref: " + payment.reference : ""}</small></td>
        <td>{new Date(payment.createdAt).toLocaleString()}<small className="table-subline">{payment.createdByMemberId===ownerId ? "Submitted by you" : "Submitted by other party"}</small></td>
        <td><span className={"status-pill " + payment.status.toLowerCase().replaceAll("_","-")}>{payment.status.replaceAll("_"," ")}</span></td>
        <td>{ownerId&&(payment.loan.borrower.id===ownerId||payment.loan.lender.id===ownerId)&&payment.createdByMemberId!==ownerId&&payment.status==="AWAITING_ACKNOWLEDGMENT" ? <button className="primary-button" onClick={()=>onConfirm(payment.id)}>Confirm payment</button> : <span className="table-subline">—</span>}</td>
      </tr>)}</tbody></table></div>}
      {limit && filtered.length>limit && <div className="payment-view-all"><span>Showing {visible.length} of {filtered.length} matching repayment(s).</span>{onViewAll&&<button className="text-button" onClick={onViewAll}>View all repayments →</button>}</div>}
    </>}
  </section>;
}
function OwnerPaymentEntry({loans,ownerId,onSaved}:{loans:Loan[];ownerId?:string;onSaved:()=>Promise<void>}) {
  const [memberId,setMemberId]=useState(""); const [selectedLoanIds,setSelectedLoanIds]=useState<string[]>([]); const [amounts,setAmounts]=useState<Record<string,string>>({});
  const [method,setMethod]=useState("CASH"); const [reference,setReference]=useState(""); const [note,setNote]=useState(""); const [saving,setSaving]=useState(false); const [error,setError]=useState(""); const [notice,setNotice]=useState(""); const [showForm,setShowForm]=useState(false);
  const eligible=loans.filter((loan)=>loan.status==="ACTIVE"&&(loan.borrower.id===ownerId||loan.lender.id===ownerId));
  const memberOptions=Array.from(new Map<string, Member>(eligible.map((loan)=>{const member=loan.borrower.id===ownerId?loan.lender:loan.borrower;return [member.id,member] as const})).values());
  const memberLoans=eligible.filter((loan)=>memberId&&(loan.borrower.id===memberId||loan.lender.id===memberId));
  const selectedLoans=memberLoans.filter((loan)=>selectedLoanIds.includes(loan.id));
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(saving||!selectedLoans.length)return;setSaving(true);setError("");setNotice("");const failures:string[]=[];let succeeded=0;const successfulIds:string[]=[];
    for(const loan of selectedLoans){try{const response=await fetch("/api/payments",{method:"POST",headers:{"content-type":"application/json","idempotency-key":crypto.randomUUID()},body:JSON.stringify({loanId:loan.id,amountPhp:amounts[loan.id],method,reference:reference||undefined,note:note||undefined})});const data=await response.json();if(!response.ok)failures.push(loan.publicCode+": "+(data.error||"could not record"));else{succeeded++;successfulIds.push(loan.id);}}catch{failures.push(loan.publicCode+": request failed");}}
    setSelectedLoanIds((current)=>current.filter((id)=>!successfulIds.includes(id)));setAmounts((current)=>Object.fromEntries(Object.entries(current).filter(([id])=>!successfulIds.includes(id))));
    setNotice(`${succeeded} payment(s) recorded and awaiting acknowledgment.${failures.length?" Failed: "+failures.join("; "):""}`);
    if(succeeded)await onSaved();setSaving(false);}
  return <section className="workspace-card payment-proposal-card"><div className="section-row repayment-entry-heading"><div><h2>Record repayments</h2><p className="workspace-muted">Choose a member, select multiple active loans, and enter a separate amount for each. Every payment still requires acknowledgment.</p></div><button type="button" className="secondary-button" aria-expanded={showForm} onClick={()=>setShowForm((shown)=>!shown)}>{showForm?"Hide form":"Record repayment"}</button></div>
    {error&&<div className="workspace-alert error" role="alert">{error}</div>}{notice&&<div className="workspace-alert success" role="status">{notice}</div>}
    {eligible.length===0?<div className="empty-state">No active loans involving the owner are available for payment entry.</div>:showForm?<form className="workspace-form loan-form" onSubmit={submit}>
      <label className="form-span payment-member-picker">Member first<select value={memberId} onChange={(e)=>{setMemberId(e.target.value);setSelectedLoanIds([]);}} required><option value="">Choose a member…</option>{memberOptions.map((member)=><option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label>
      {memberId&&<div className="form-span"><div className="section-row"><strong>Select loans and payment amounts</strong><div className="table-actions"><button type="button" className="text-button" onClick={()=>setSelectedLoanIds(memberLoans.filter((loan)=>!loan.payments.some((p)=>p.status==="AWAITING_ACKNOWLEDGMENT")).map((loan)=>loan.id))}>Select available</button><button type="button" className="text-button" onClick={()=>setSelectedLoanIds([])}>Clear</button></div></div>
      {memberLoans.length===0?<div className="empty-state">This member has no active loans involving the owner.</div>:<div className="payment-selection-list">{memberLoans.map((loan)=>{const pending=loan.payments.some((p)=>p.status==="AWAITING_ACKNOWLEDGMENT");return <div className="payment-selection-row" key={loan.id}><label className="payment-selection-check"><input type="checkbox" checked={selectedLoanIds.includes(loan.id)} disabled={pending} onChange={(e)=>setSelectedLoanIds((current)=>e.target.checked?[...current,loan.id]:current.filter((id)=>id!==loan.id))}/><span><strong>{loan.publicCode} · {loan.description}</strong><small>{loan.borrower.displayName} ↔ {loan.lender.displayName}</small><small>Outstanding: {formatPhp(BigInt(loan.outstandingCentavos))} · Due {loan.dueAt?new Date(loan.dueAt).toLocaleDateString():"not set"}{pending?" · Payment awaiting acknowledgment":""}</small></span></label>{selectedLoanIds.includes(loan.id)&&<label className="payment-selection-amount">Payment amount (PHP)<input inputMode="decimal" value={amounts[loan.id]||""} onChange={(e)=>setAmounts((current)=>({...current,[loan.id]:e.target.value}))} required placeholder="e.g. 500.00"/></label>}</div>})}</div>}</div>}
      <label>Payment method<select value={method} onChange={(e)=>setMethod(e.target.value)}><option value="CASH">Cash</option><option value="GCASH">GCash</option><option value="BANK_TRANSFER">Bank transfer</option><option value="OTHER">Other</option></select></label>
      <label>Reference {method==="GCASH"||method==="BANK_TRANSFER"?"(required)":"(optional)"}<input value={reference} onChange={(e)=>setReference(e.target.value)} maxLength={200} required={method==="GCASH"||method==="BANK_TRANSFER"} placeholder="Transaction reference"/></label>
      <label className="form-span">Notes (optional)<textarea value={note} onChange={(e)=>setNote(e.target.value)} maxLength={1000} rows={2} placeholder="Optional context for these repayments"/></label>
      <button className="primary-button form-span" type="submit" disabled={saving||!selectedLoans.length||selectedLoans.some((loan)=>!amounts[loan.id]?.trim())}>{saving?"Recording payments…":`Record ${selectedLoans.length} selected payment(s)`}</button>
    </form>:null}
  </section>;
}
function LoanTable({loans,ownerId,onApprove,onActivateInPerson}:{loans:Loan[];ownerId?:string;onApprove:(loan:Loan)=>void;onActivateInPerson:(loan:Loan)=>void}) { return <div className="table-wrap"><table><thead><tr><th>REFERENCE</th><th>BORROWER / LENDER</th><th>PURPOSE</th><th>PRINCIPAL</th><th>OUTSTANDING</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>{loans.map((loan)=><tr key={loan.id}><td><strong>{loan.publicCode}</strong><small className="table-subline">Borrowed {new Date(loan.borrowedAt || loan.createdAt).toLocaleDateString()}</small></td><td><strong>{loan.borrower.displayName}</strong><small className="table-subline">Lender: {loan.lender.displayName}</small></td><td>{loan.description}<small className="table-subline">{categories.find((c)=>c.value===loan.category)?.label||loan.category}</small></td><td>{formatPhp(BigInt(loan.principalCentavos))}</td><td>{formatPhp(BigInt(loan.outstandingCentavos))}</td><td><span className={`status-pill ${loan.status.toLowerCase().replaceAll("_","-")}`}>{loan.status.replaceAll("_"," ")}</span></td><td>{(loan.status==="DRAFT"||loan.status==="AWAITING_APPROVAL") ? <div className="table-actions"><button className="secondary-button" onClick={()=>onActivateInPerson(loan)}>Activate — agreed in person</button>{ownerId && (loan.borrower.id===ownerId||loan.lender.id===ownerId) && !loan.myTermsAccepted && <button className="text-button" onClick={()=>onApprove(loan)}>Approve terms online</button>}</div> : <span className="table-subline">{loan.myTermsAccepted?"Approved":"—"}</span>}</td></tr>)}</tbody></table>{loans.length===0&&<div className="empty-state">No loan records yet. Create a draft to get started.</div>}</div>; }
