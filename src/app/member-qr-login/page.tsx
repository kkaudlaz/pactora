"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import jsQR from "jsqr";
import { useRouter } from "next/navigation";

type DetectedCode = { rawValue?: string };
type BarcodeDetectorInstance = { detect: (source: ImageBitmapSource) => Promise<DetectedCode[]> };
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorInstance;

export default function MemberQrLoginPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraSupported, setCameraSupported] = useState(false);

  useEffect(() => {
    setCameraSupported(typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia));
    return () => streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  async function openQrValue(value: string) {
    setError("");
    let token = "";
    try {
      const url = new URL(value, window.location.origin);
      if (url.pathname.replace(/\/+$/, "") !== "/access") throw new Error("This is not a Pactora member QR code.");
      token = new URLSearchParams(url.hash.slice(1)).get("token") || "";
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This QR code is not valid.");
      return;
    }
    if (!token || token.length < 32) { setError("This QR code does not contain a valid member access link."); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/member-qr", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "This QR code is invalid or expired.");
      streamRef.current?.getTracks().forEach((track) => track.stop());
      router.replace("/member");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not open member profile."); }
    finally { setBusy(false); }
  }

  async function scanCamera() {
    setError("");
    try {
      const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access is not supported in this browser. Upload the QR image instead.");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      streamRef.current = stream;
      if (!videoRef.current) throw new Error("Camera preview is unavailable.");
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setCameraActive(true);
      const detector = Detector ? new Detector({ formats: ["qr_code"] }) : null;
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });
      const scan = async () => {
        if (!streamRef.current || !videoRef.current || busy) return;
        try {
          let value: string | undefined;
          if (detector) {
            const codes = await detector.detect(videoRef.current);
            value = codes.find((code) => code.rawValue)?.rawValue;
          } else if (context && videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0) {
            canvas.width = videoRef.current.videoWidth;
            canvas.height = videoRef.current.videoHeight;
            context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
            value = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: "attemptBoth" })?.data;
          }
          if (value) { streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; setCameraActive(false); await openQrValue(value); return; }
        } catch { /* Camera frames can fail transiently while autofocus adjusts. */ }
        if (streamRef.current) window.setTimeout(() => void scan(), 250);
      };
      void scan();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to open the camera."); }
  }

  async function uploadQr(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    try {
      const bitmap = await createImageBitmap(file);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Could not read that QR image. Try another PNG or JPG.");
        context.drawImage(bitmap, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: "attemptBoth" });
        if (!decoded?.data) throw new Error("No QR code was found in that image. Try a clearer PNG or JPG.");
        await openQrValue(decoded.data);
      } finally {
        bitmap.close();
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not read that QR image."); }
  }

  function stopCamera() { streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; setCameraActive(false); }

  return <main className="auth-page"><section className="auth-card member-qr-card">
    <Link className="brand auth-brand" href="/"><span className="brand-mark">P</span><span><strong>pactora</strong><small>PRIVATE LEDGER</small></span></Link>
    <div className="eyebrow">MEMBER ACCESS</div><h1>Open your profile.</h1>
    <p className="auth-copy">Scan the personal QR shared by your workspace owner, or upload the QR image they gave you.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="member-qr-actions">
      <button className="primary-button auth-submit" type="button" onClick={() => void scanCamera()} disabled={busy || cameraActive}>Scan with camera</button>
      <label className="secondary-button member-qr-upload">Upload QR image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadQr(event)} disabled={busy} /></label>
    </div>
    <div className="member-camera" hidden={!cameraActive}><video ref={videoRef} playsInline muted /><p>Point the camera at the personal Pactora QR code.</p><button className="secondary-button" type="button" onClick={stopCamera}>Stop camera</button></div>
    {busy && <div className="workspace-loading">Verifying QR and opening profile…</div>}
    {!cameraSupported && <p className="auth-footnote">If camera scanning is unavailable, upload the QR image instead. Camera access requires HTTPS or localhost.</p>}
    <p className="auth-footnote">Your QR is a private access key. Anyone who has it may open the associated member profile.</p>
    <Link href="/login" className="member-owner-link">Owner? Sign in securely →</Link>
  </section></main>;
}
