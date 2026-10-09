"use client";

import { useMemo, useState } from "react";
import { formatPhp, parsePhpToCentavos } from "@/lib/money";

type LoanStatus = "Active" | "Awaiting approval" | "Disputed" | "Settled";
type Loan = { id: string; person: string; initials: string; purpose: string; category: string; principal: bigint; paid: bigint; status: LoanStatus; due: string; direction: "They owe you" | "You owe them" };
const initialLoans: Loan[] = [
  { id: "PT-1042", person: "Alex Rivera", initials: "AR", purpose: "Chicken and groceries", category: "Food & groceries", principal: 250000n, paid: 100000n, status: "Active", due: "Oct 20, 2026", direction: "They owe you" },
  { id: "PT-1041", person: "Jamie Santos", initials: "JS", purpose: "Food delivery", category: "Delivery", principal: 84500n, paid: 0n, status: "Awaiting approval", due: "Not set", direction: "They owe you" },
  { id: "PT-1039", person: "Morgan Cruz", initials: "MC", purpose: "Electricity bill share", category: "Bills", principal: 180000n, paid: 60000n, status: "Disputed", due: "Oct 15, 2026", direction: "You owe them" },
  { id: "PT-1034", person: "Alex Rivera", initials: "AR", purpose: "Market groceries", category: "Reimbursement", principal: 120000n, paid: 120000n, status: "Settled", due: "Settled Sep 28", direction: "They owe you" },
];
const nav = [{ id: "overview", label: "Overview", icon: "◫" }, { id: "loans", label: "Loans", icon: "⇄" }, { id: "payments", label: "Payments", icon: "↗" }, { id: "members", label: "Members & access", icon: "♙" }, { id: "activity", label: "Audit activity", icon: "◷" }];
const statusClass: Record<LoanStatus, string> = { Active: "active", "Awaiting approval": "pending", Disputed: "disputed", Settled: "settled" };

export default function Home() {
  const [section, setSection] = useState("overview");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All statuses");
  const [showNew, setShowNew] = useState(false);
  const [toast, setToast] = useState("");
  const [loans, setLoans] = useState(initialLoans);
  const [person, setPerson] = useState("");
  const [purpose, setPurpose] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Food & groceries");
  const [direction, setDirection] = useState<Loan["direction"]>("They owe you");

  const filtered = useMemo(() => loans.filter((loan) => {
    const query = `${loan.id} ${loan.person} ${loan.purpose} ${loan.category}`.toLowerCase();
    return query.includes(search.toLowerCase()) && (filter === "All statuses" || loan.status === filter);
  }), [loans, search, filter]);
  const activeCount = loans.filter((loan) => loan.status === "Active").length;
  const receivable = loans.filter((loan) => loan.direction === "They owe you" && loan.status === "Active").reduce((sum, loan) => sum + loan.principal - loan.paid, 0n);
  const payable = loans.filter((loan) => loan.direction === "You owe them" && loan.status === "Active").reduce((sum, loan) => sum + loan.principal - loan.paid, 0n);
  const totalPayments = loans.reduce((sum, loan) => sum + loan.paid, 0n);

  function createDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let cents: bigint;
    try { cents = parsePhpToCentavos(amount); } catch { setToast("Enter a member, purpose, and valid amount."); return; }
    if (!person.trim() || !purpose.trim() || cents <= 0n) {
      setToast("Enter a member, purpose, and valid amount.");
      return;
    }
    const newLoan: Loan = { id: `PT-${1050 + loans.length}`, person: person.trim(), initials: person.trim().split(" ").filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase(), purpose: purpose.trim(), category, principal: cents, paid: 0n, status: "Awaiting approval", due: "Not set", direction };
    setLoans((current) => [newLoan, ...current]);
    setShowNew(false); setPerson(""); setPurpose(""); setAmount("");
    setToast("Demo draft created locally. It is not saved to a server or blockchain.");
    setSection("loans");
  }

  return <main className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setSection("overview"); }}><span className="brand-mark">P</span><span><strong>pactora</strong><small>PRIVATE LEDGER</small></span></a>
      <div className="workspace-label">WORKSPACE</div>
      <div className="workspace"><span className="workspace-avatar">F</span><span><strong>Family ledger</strong><small>Private workspace</small></span><span className="chevron">⌄</span></div>
      <div className="nav-label">MANAGE</div>
      <nav>{nav.map((item) => <button key={item.id} className={`nav-item ${section === item.id ? "selected" : ""}`} onClick={() => setSection(item.id)}><span className="nav-icon">{item.icon}</span>{item.label}{item.id === "activity" && <span className="nav-soon">LOG</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="security-card"><span className="security-icon">⌑</span><strong>Private by design</strong><p>Financial details belong only to the people involved.</p><span className="demo-pill">DEMO MODE</span></div><button className="profile-button"><span className="profile-avatar">O</span><span><strong>Workspace owner</strong><small>Local preview</small></span><span className="chevron">···</span></button></div>
    </aside>

    <section className="main-panel">
      <header className="topbar"><div className="breadcrumb">Family ledger <span>/</span> <strong>{nav.find((item) => item.id === section)?.label ?? "Overview"}</strong></div><div className="top-actions"><span className="demo-top"><span /> Sample data</span><button className="icon-button" aria-label="Notifications" onClick={() => setToast("Notifications will be added with the server-backed workflow.")}>♧</button><span className="top-avatar">O</span></div></header>
      <div className="content-wrap">
        <div className="demo-banner"><span className="banner-symbol">i</span><div><strong>Prototype — sample data only</strong><p>This preview stores changes only in your browser memory. Do not enter real family financial information yet.</p></div><a className="demo-open-link" href="/login">Open secure workspace →</a><button onClick={() => setToast("This demo preview is separate from the authenticated database-backed workspace.")} aria-label="More information">↗</button></div>

        {section === "overview" && <>
          <div className="page-heading"><div><div className="eyebrow">FRIDAY, OCTOBER 9, 2026</div><h1>Your money, clearly accounted for.</h1><p>A clear view of shared loans, repayments, and what still needs attention.</p></div><button className="primary-button" onClick={() => setShowNew(true)}><span>＋</span> Record a loan</button></div>
          <div className="stats-grid"><Stat label="Owed to you" value={formatPhp(receivable)} note="Confirmed active loans" icon="↗" tone="green" /><Stat label="You owe" value={formatPhp(payable)} note="Confirmed active loans" icon="↙" tone="blue" /><Stat label="Payments recorded" value={formatPhp(totalPayments)} note="Across sample loan records" icon="⇄" tone="purple" /><Stat label="Active loans" value={String(activeCount).padStart(2, "0")} note={`${loans.filter((loan) => loan.status === "Awaiting approval").length} awaiting approval`} icon="◷" tone="amber" /></div>
          <div className="section-row"><div><h2>Recent loans</h2><p>Track balances and the next action for each agreement.</p></div><button className="text-button" onClick={() => setSection("loans")}>View all loans <span>→</span></button></div>
          <LoanTable loans={filtered.slice(0, 4)} onSelect={(loan) => setToast(`${loan.id}: ${loan.purpose}. Outstanding (including only sample confirmed totals): ${formatPhp(loan.principal - loan.paid)}. Detailed record view comes in a later phase.`)} />
          <div className="bottom-grid"><div className="panel-card"><div className="card-heading"><div><h3>Needs your attention</h3><p>Items waiting for review</p></div><span className="attention-count">{loans.filter((loan) => loan.status === "Awaiting approval" || loan.status === "Disputed").length}</span></div>{loans.filter((loan) => loan.status === "Awaiting approval" || loan.status === "Disputed").map((loan) => <div className="attention-item" key={loan.id}><span className={`attention-dot ${loan.status === "Disputed" ? "red" : ""}`} /><div><strong>{loan.purpose}</strong><small>{loan.person} · {loan.id}</small></div><span className={`status ${statusClass[loan.status]}`}>{loan.status}</span></div>)}</div><div className="panel-card trust-card"><div className="trust-art"><span>✓</span><i /><i /><i /></div><div><h3>Clarity for both sides.</h3><p>Each loan and payment should have a clear record, a visible status, and the right people’s acknowledgment.</p><button className="text-button" onClick={() => setSection("activity")}>Explore audit history <span>→</span></button></div></div></div>
        </>}

        {section === "loans" && <><div className="page-heading"><div><div className="eyebrow">LEDGER</div><h1>Loans</h1><p>Review each loan, its status, and outstanding amount.</p></div><button className="primary-button" onClick={() => setShowNew(true)}>＋ Record a loan</button></div><div className="toolbar"><div className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search people, purpose, or ID" /></div><select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter loan status"><option>All statuses</option><option>Active</option><option>Awaiting approval</option><option>Disputed</option><option>Settled</option></select></div><LoanTable loans={filtered} onSelect={(loan) => setToast(`${loan.id} selected. Record detail and approval flow are planned for the next milestone.`)} /></>}

        {section === "payments" && <><div className="page-heading"><div><div className="eyebrow">MONEY MOVEMENT</div><h1>Payments</h1><p>Keep proposed, confirmed, and disputed payments distinct.</p></div></div><div className="empty-feature"><span className="feature-icon">⇄</span><h2>Payment review is being prepared</h2><p>In the next milestone, the owner can record cash payments or attach GCash/bank-transfer evidence. A receipt image alone will not automatically confirm that a transfer succeeded.</p><ul><li>Private receipt storage (not GitHub)</li><li>Explicit acknowledgment by the required party</li><li>Idempotent submission and append-only corrections</li></ul></div></>}

        {section === "members" && <><div className="page-heading"><div><div className="eyebrow">PEOPLE & PERMISSIONS</div><h1>Members & access</h1><p>Member identity and access credentials are separate.</p></div></div><div className="empty-feature"><span className="feature-icon">♙</span><h2>QR + PIN access comes after server authentication</h2><p>Each member will receive a random, revocable QR access link and a member UID. The UID itself will not grant access. The server will verify a PIN, enforce rate limits, and only return records associated with that member.</p><div className="callout-note">No real QR credentials or PINs are generated in this prototype.</div></div></>}

        {section === "activity" && <><div className="page-heading"><div><div className="eyebrow">ACCOUNTABILITY</div><h1>Audit activity</h1><p>Financial history should be corrected with new events, not silently rewritten.</p></div></div><div className="empty-feature"><span className="feature-icon">◷</span><h2>Append-only event history is planned</h2><p>The database foundation includes ledger event and idempotency fields. Server-side event creation, hash chaining, durable audit views, and optional blockchain anchoring will be implemented and tested before this is used for real records.</p></div></>}
      </div>
      <footer><span>© 2026 Pactora</span><span><i /> Private ledger prototype <span className="footer-divider">·</span> No blockchain connected</span></footer>
    </section>

    {showNew && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowNew(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-header"><div><div className="eyebrow">NEW RECORD</div><h2 id="modal-title">Record a loan</h2><p>This creates a local demo draft, not a real agreement.</p></div><button className="close-button" onClick={() => setShowNew(false)} aria-label="Close">×</button></div><form onSubmit={createDraft}><label>Person / member<input required value={person} onChange={(event) => setPerson(event.target.value)} placeholder="e.g. Alex Rivera" /></label><label>Purpose<input required value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="e.g. Chicken and groceries" /></label><div className="form-row"><label>Amount (PHP)<input required inputMode="decimal" type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></label><label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option>Food & groceries</option><option>Delivery</option><option>Personal cash loan</option><option>Bills</option><option>Reimbursement</option><option>Other</option></select></label></div><label>Direction<select value={direction} onChange={(event) => setDirection(event.target.value as Loan["direction"])}><option>They owe you</option><option>You owe them</option></select></label><div className="callout-note">New records start as <strong>Awaiting approval</strong>. A draft does not become an active debt until the relevant people approve the exact terms.</div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowNew(false)}>Cancel</button><button type="submit" className="primary-button">Create demo draft <span>→</span></button></div></form></section></div>}
    {toast && <div className="toast" role="status"><span>i</span>{toast}<button onClick={() => setToast("")} aria-label="Dismiss">×</button></div>}
  </main>;
}

function Stat({ label, value, note, icon, tone }: { label: string; value: string; note: string; icon: string; tone: string }) {
  return <article className="stat-card"><div className="stat-top"><span>{label}</span><span className={`stat-icon ${tone}`}>{icon}</span></div><strong className="stat-value">{value}</strong><div className="stat-note">{note}</div></article>;
}

function LoanTable({ loans, onSelect }: { loans: Loan[]; onSelect: (loan: Loan) => void }) {
  if (!loans.length) return <div className="table-empty">No matching loans. Try another search or status filter.</div>;
  return <div className="table-wrap"><table><thead><tr><th>PERSON / PURPOSE</th><th>PRINCIPAL</th><th>PAID</th><th>OUTSTANDING</th><th>STATUS</th><th>DUE DATE</th><th /></tr></thead><tbody>{loans.map((loan) => <tr key={loan.id} onClick={() => onSelect(loan)}><td><div className="person-cell"><span className="person-avatar">{loan.initials}</span><span><strong>{loan.person}</strong><small>{loan.purpose}</small></span></div></td><td className="money-cell">{formatPhp(loan.principal)}</td><td className="money-cell muted-money">{formatPhp(loan.paid)}</td><td className="money-cell outstanding">{formatPhp(loan.principal - loan.paid)}</td><td><span className={`status ${statusClass[loan.status]}`}><i />{loan.status}</span></td><td className="due-cell">{loan.due}</td><td><button className="row-menu" onClick={(event) => { event.stopPropagation(); onSelect(loan); }} aria-label={`Open ${loan.id}`}>···</button></td></tr>)}</tbody></table></div>;
}
