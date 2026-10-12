"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from "react";

type PaymentDestination = {
  id: string;
  lenderId: string;
  method: "GCASH" | "BANK_TRANSFER";
  provider: string;
  recipientName: string | null;
  accountLabel: string | null;
  qrImageData: string;
  updatedAt: string;
};

const BANKS = ["BDO", "BPI", "Metrobank", "UnionBank", "LandBank", "Other"];

export default function PaymentQrSettings() {
  const [destinations, setDestinations] = useState<PaymentDestination[]>([]);
  const [method, setMethod] = useState<"GCASH" | "BANK_TRANSFER">("GCASH");
  const [provider, setProvider] = useState("BDO");
  const [recipientName, setRecipientName] = useState("");
  const [accountLabel, setAccountLabel] = useState("");
  const [qrImageData, setQrImageData] = useState("");
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/payment-destinations?mine=1", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load payment QR settings.");
      setDestinations(data.myDestinations || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load payment QR settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function selectImage(event: ChangeEvent<HTMLInputElement>) {
    setError("");
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Choose a PNG, JPG, or WebP image.");
      event.target.value = "";
      return;
    }
    if (file.size > 1_000_000) {
      setError("Keep the QR image under 1 MB so it loads reliably on mobile.");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        setError("Could not read that image. Please try another file.");
        return;
      }
      setQrImageData(reader.result);
      setFileName(file.name);
    };
    reader.onerror = () => setError("Could not read that image. Please try another file.");
    reader.readAsDataURL(file);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError("");
    setNotice("");
    if (!qrImageData) {
      setError("Upload the QR image you want members to scan.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/payment-destinations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          method,
          provider: method === "GCASH" ? "GCash" : provider,
          recipientName,
          accountLabel,
          qrImageData,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save payment QR.");
      setNotice(data.destination.provider + " QR saved. Members will see it only when they choose the matching payment method.");
      setQrImageData("");
      setFileName("");
      setRecipientName("");
      setAccountLabel("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save payment QR.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(destination: PaymentDestination) {
    if (!window.confirm("Remove the " + destination.provider + " payment QR? Members will no longer see it.")) return;
    setError("");
    setNotice("");
    setRemovingId(destination.id);
    try {
      const response = await fetch("/api/payment-destinations", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: destination.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not remove payment QR.");
      setDestinations((current) => current.filter((item) => item.id !== destination.id));
      setNotice(destination.provider + " QR removed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove payment QR.");
    } finally {
      setRemovingId("");
    }
  }

  return <section className="workspace-card payment-qr-settings">
    <div className="section-row repayment-entry-heading">
      <div><h2>Payment QR settings</h2><p className="workspace-muted">Upload the QR codes you receive payments through. Members only see the QR that matches their selected method and bank.</p></div>
      <button type="button" className="secondary-button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "Hide settings" : "Manage payment QRs"}</button>
    </div>
    {error && <div className="workspace-alert error" role="alert">{error}</div>}
    {notice && <div className="workspace-alert success" role="status">{notice}</div>}
    {loading && <p className="workspace-muted">Loading saved payment destinations…</p>}
    {!loading && <div className="payment-destination-list">
      {destinations.map((destination) => <article className="payment-destination-row" key={destination.id}>
        <img src={destination.qrImageData} alt={destination.provider + " payment QR"} />
        <div className="payment-destination-info"><strong>{destination.provider}</strong><small>{destination.method === "GCASH" ? "GCash" : "Bank transfer"}{destination.recipientName ? " · " + destination.recipientName : ""}</small><small>{destination.accountLabel || "No account label added"}</small><small>Updated {new Date(destination.updatedAt).toLocaleDateString()}</small></div>
        <button className="secondary-button revoke-action" type="button" disabled={removingId === destination.id} onClick={() => void remove(destination)}>{removingId === destination.id ? "Removing…" : "Remove"}</button>
      </article>)}
      {destinations.length === 0 && <p className="workspace-muted">No payment QRs saved yet.</p>}
    </div>}
    {expanded && <form className="workspace-form payment-qr-form" onSubmit={save}>
      <label>Payment method<select value={method} onChange={(event) => { setMethod(event.target.value as "GCASH" | "BANK_TRANSFER"); setQrImageData(""); setFileName(""); }}><option value="GCASH">GCash</option><option value="BANK_TRANSFER">Bank transfer</option></select></label>
      {method === "BANK_TRANSFER" && <label>Bank<select value={provider} onChange={(event) => setProvider(event.target.value)}>{BANKS.map((bank) => <option key={bank} value={bank}>{bank === "Other" ? "Other bank" : bank}</option>)}</select></label>}
      <label>Recipient name (optional)<input value={recipientName} onChange={(event) => setRecipientName(event.target.value)} maxLength={100} placeholder="Name shown by the payment app" /></label>
      <label>Account label / last digits (optional)<input value={accountLabel} onChange={(event) => setAccountLabel(event.target.value)} maxLength={100} placeholder="e.g. Personal account · •••• 1234" /></label>
      <label className="form-span">QR image (PNG, JPG, WebP; max 1 MB)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={selectImage} required={!qrImageData} /></label>
      {fileName && <p className="workspace-muted form-span">Selected: {fileName}</p>}
      {qrImageData && <div className="payment-qr-preview form-span"><img src={qrImageData} alt="Preview of the payment QR image" /><span>Preview — confirm this is the correct payment destination before saving.</span></div>}
      <button className="primary-button form-span" type="submit" disabled={saving || !qrImageData}>{saving ? "Saving QR…" : "Save payment QR"}</button>
    </form>}
  </section>;
}
