"use client";

import { useEffect, useState } from "react";

export default function PaymentQrImage({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="payment-qr-image-trigger"
        onClick={() => setOpen(true)}
        aria-label="Open payment QR in full-screen view"
      >
        <img src={src} alt={alt} />
        <span>Tap to enlarge for scanning</span>
      </button>
      {open && (
        <div
          className="payment-qr-lightbox"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <section
            className="payment-qr-lightbox-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Full-size payment QR code"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="payment-qr-lightbox-header">
              <div>
                <strong>Scan to pay</strong>
                <span>Open your phone camera or payment app and scan this code.</span>
              </div>
              <button
                type="button"
                className="secondary-button payment-qr-close"
                onClick={() => setOpen(false)}
                autoFocus
              >
                Close ✕
              </button>
            </header>
            <div className="payment-qr-full-image-wrap">
              <img className="payment-qr-full-image" src={src} alt={alt} />
            </div>
            <p>Check the recipient and account details in your payment app before sending money.</p>
          </section>
        </div>
      )}
    </>
  );
}
