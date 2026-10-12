"use client";
import { useState } from "react";
export default function PaymentQrImage({ src, alt }: { src: string; alt: string }) {
 const [open, setOpen] = useState(false);
 return <><button type="button" className="payment-qr-image-trigger" onClick={() => setOpen(true)} aria-label="View full-size QR"><img src={src} alt={alt} /><span>Tap to enlarge</span></button>{open && <div className="payment-qr-lightbox" onClick={() => setOpen(false)}><div className="payment-qr-lightbox-panel" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}><button type="button" className="secondary-button" onClick={() => setOpen(false)}>Close</button><img className="payment-qr-full-image" src={src} alt={alt} /></div></div>}</>;
}
