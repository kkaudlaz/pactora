import Link from "next/link";

const principles = [
  { icon: "01", title: "Agree on the terms", description: "Keep the amount, purpose, repayment terms, and approvals together in one record." },
  { icon: "02", title: "Record each repayment", description: "Track submitted payments separately from payments that have been acknowledged." },
  { icon: "03", title: "Keep both sides informed", description: "Borrowers and lenders can review the agreements and records they are involved in." },
];

export default function HomePage() {
  return (
    <main className="public-site">
      <header className="public-header">
        <Link className="brand public-brand" href="/" aria-label="Pactora home">
          <span className="brand-mark">P</span>
          <span><strong>pactora</strong><small>PRIVATE LEDGER</small></span>
        </Link>
        <nav className="public-nav" aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#privacy">Privacy</a>
          <Link className="public-sign-in" href="/login">Owner sign in <span aria-hidden="true">↗</span></Link>
        </nav>
      </header>

      <section className="public-hero">
        <div className="public-hero-copy">
          <div className="public-eyebrow"><span /> A clearer way to keep shared records</div>
          <h1>Shared money.<br /><span>Clear records.</span><br />Better trust.</h1>
          <p className="public-lede">Keep personal loans, repayment history, and agreed terms organized in one private ledger — designed to help both sides know where things stand.</p>
          <div className="public-hero-actions">
            <Link className="public-primary" href="/login">Sign in to Pactora <span aria-hidden="true">→</span></Link>
            <a className="public-secondary" href="#how-it-works">See how it works <span aria-hidden="true">↓</span></a>
          </div>
          <div className="public-member-note"><span aria-hidden="true">⌑</span><span>A member? <Link href="/member-qr-login">Scan or upload your personal QR code</Link>, or open the QR link shared by the workspace owner.</span></div>
        </div>

        <div className="public-ledger-art" aria-label="Illustration of a loan agreement and repayment ledger">
          <div className="ledger-glow" />
          <div className="ledger-orbit ledger-orbit-one" />
          <div className="ledger-orbit ledger-orbit-two" />
          <div className="ledger-card ledger-main-card">
            <div className="ledger-card-top"><span className="ledger-document-icon">P</span><span className="ledger-state"><i /> AGREEMENT READY</span></div>
            <div className="ledger-caption">LOAN RECORD</div>
            <div className="ledger-title">Shared expense</div>
            <div className="ledger-amount">₱ 2,500.00</div>
            <div className="ledger-rule" />
            <div className="ledger-parties"><div><span className="ledger-avatar ledger-avatar-a">A</span><span><small>Borrower</small><strong>Alex R.</strong></span></div><span className="ledger-link">↔</span><div><span className="ledger-avatar ledger-avatar-b">J</span><span><small>Lender</small><strong>Jamie S.</strong></span></div></div>
            <div className="ledger-progress"><span /><span /><span /></div>
            <div className="ledger-foot"><span>Terms version 1</span><span>Record preview</span></div>
          </div>
          <div className="ledger-float ledger-float-payment"><span className="ledger-float-icon">✓</span><span><strong>Repayment recorded</strong><small>Awaiting acknowledgment</small></span></div>
          <div className="ledger-float ledger-float-privacy"><span className="ledger-lock">⌑</span><span><strong>Private access</strong><small>For the people involved</small></span></div>
          <p className="ledger-art-note">Illustrative preview · No real financial data</p>
        </div>
      </section>

      <section className="public-trust-strip" id="privacy">
        <div><span className="public-trust-icon">⌑</span><span><strong>Private by design</strong><small>Controlled member access</small></span></div>
        <div><span className="public-trust-icon">✓</span><span><strong>Clear approval status</strong><small>Drafts are not active loans</small></span></div>
        <div><span className="public-trust-icon">↻</span><span><strong>Traceable repayments</strong><small>Submitted and confirmed stay distinct</small></span></div>
      </section>

      <section className="public-how" id="how-it-works">
        <div className="public-section-heading"><div className="public-eyebrow">SIMPLE BY DESIGN</div><h2>Less uncertainty.<br /><span>More clarity for everyone.</span></h2><p>Pactora helps keep the record clear, while the people involved remain responsible for agreeing to terms and acknowledging payments.</p></div>
        <div className="public-principles">{principles.map((item) => <article className="public-principle" key={item.icon}><span className="principle-number">{item.icon}</span><h3>{item.title}</h3><p>{item.description}</p></article>)}</div>
      </section>

      <section className="public-access-panel">
        <div><div className="public-eyebrow">MADE FOR SHARED RESPONSIBILITY</div><h2>Everyone should know<br />what has been agreed.</h2><p>Pactora keeps the agreement and its repayment history connected, so both parties can refer to the same record.</p></div>
        <div className="public-access-actions"><Link className="public-primary" href="/login">Open owner workspace <span aria-hidden="true">→</span></Link><p>Members can open their profile by scanning or uploading their personal QR code.</p></div>
      </section>

      <footer className="public-footer"><Link className="brand public-footer-brand" href="/"><span className="brand-mark">P</span><span><strong>pactora</strong><small>PRIVATE LEDGER</small></span></Link><p>Personal records, handled with care.</p><Link href="/login">Owner sign in ↗</Link></footer>
    </main>
  );
}
