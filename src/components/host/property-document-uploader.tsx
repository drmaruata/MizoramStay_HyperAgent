"use client";

import { FormEvent, useId, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

const DOCUMENT_BUCKET = "verification-documents";
const DOCUMENT_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

type SavedDocument = {
  id: string;
  property_id: string;
  document_type: string;
  storage_path: string;
  status: string;
  expires_on: string | null;
};

type PropertyDocumentUploaderProps = {
  propertyId: string;
  onComplete?: (document: SavedDocument) => void;
};

type UploadUrlResponse = {
  bucket?: unknown;
  path?: unknown;
  token?: unknown;
};

function getErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") return payload.error;
  return fallback;
}

function isExpectedPath(path: string, propertyId: string) {
  const parts = path.split("/");
  return parts.length === 3 && parts[0].length > 0 && parts[1] === propertyId && parts[2].length > 0 && !parts.includes("..") && !path.includes("\\");
}

export function PropertyDocumentUploader({ propertyId, onComplete }: PropertyDocumentUploaderProps) {
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState("ownership_proof");
  const [expiresOn, setExpiresOn] = useState("");
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("Choose a verification document to upload.");
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError(null);
    if (!propertyId) return setError("Choose a property before uploading a document.");
    if (!file) return setError("Choose a verification document to upload.");
    if (!DOCUMENT_TYPES.has(file.type)) return setError("Choose a PDF, JPEG, or PNG document.");
    if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) return setError("Document must be larger than 0 bytes and no more than 10 MiB.");
    if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(documentType)) return setError("Choose a valid document type.");

    setIsUploading(true);
    setProgress(10);
    setStatus("Preparing a secure upload…");
    try {
      const signingResponse = await fetch("/api/v1/host/documents/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, fileName: file.name, contentType: file.type, fileSize: file.size }),
      });
      const signingPayload: unknown = await signingResponse.json().catch(() => null);
      if (!signingResponse.ok) throw new Error(getErrorMessage(signingPayload, "Unable to prepare the document upload."));

      const signed = signingPayload as UploadUrlResponse;
      if (signed.bucket !== DOCUMENT_BUCKET || typeof signed.path !== "string" || typeof signed.token !== "string" || !isExpectedPath(signed.path, propertyId)) {
        throw new Error("The upload service returned an invalid document destination.");
      }

      setProgress(35);
      setStatus("Uploading document…");
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(DOCUMENT_BUCKET)
        .uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type, upsert: false });
      if (uploadError) throw new Error("The document upload failed. Please try again.");

      setProgress(85);
      setStatus("Saving document details…");
      const completionResponse = await fetch("/api/v1/host/documents/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId,
          path: signed.path,
          contentType: file.type,
          fileSize: file.size,
          documentType,
          expiresOn: expiresOn || null,
        }),
      });
      const completionPayload: unknown = await completionResponse.json().catch(() => null);
      if (!completionResponse.ok) throw new Error(getErrorMessage(completionPayload, "The document uploaded, but its details could not be saved."));

      const document = completionPayload && typeof completionPayload === "object" && "document" in completionPayload
        ? completionPayload.document as SavedDocument
        : null;
      if (!document?.id) throw new Error("The document uploaded, but the saved record was missing.");

      setProgress(100);
      setStatus("Document uploaded and submitted for verification.");
      setFile(null);
      setExpiresOn("");
      onComplete?.(document);
      form.reset();
      setDocumentType("ownership_proof");
    } catch (caught) {
      setProgress(0);
      setStatus("Upload did not complete.");
      setError(caught instanceof Error ? caught.message : "Unable to upload the document.");
    } finally {
      setIsUploading(false);
    }
  }

  const fieldClassName = "mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 text-[var(--ink)] outline-none focus:border-[var(--forest)] focus:ring-2 focus:ring-[var(--sky)]";

  return <section className="rounded-2xl border border-[var(--line)] bg-white p-5 sm:p-7" aria-labelledby={`${id}-heading`}>
    <h2 className="serif text-3xl" id={`${id}-heading`}>Upload verification document</h2>
    <p className="mt-2 text-sm leading-6 text-[var(--muted)]">PDF, JPEG, or PNG, up to 10 MiB. Documents are private and linked only to this property.</p>
    <form className="mt-6 space-y-5" onSubmit={handleSubmit} noValidate>
      <div>
        <label className="text-sm font-semibold" htmlFor={`${id}-document-type`}>Document type</label>
        <select className={fieldClassName} id={`${id}-document-type`} value={documentType} disabled={isUploading} onChange={(event) => setDocumentType(event.target.value)}>
          <option value="ownership_proof">Ownership proof</option>
          <option value="lease_agreement">Lease agreement</option>
          <option value="identity_proof">Identity proof</option>
          <option value="registration_certificate">Registration certificate</option>
          <option value="safety_certificate">Safety certificate</option>
        </select>
      </div>
      <div>
        <label className="text-sm font-semibold" htmlFor={`${id}-file`}>Document file</label>
        <input className={fieldClassName} id={`${id}-file`} type="file" accept="application/pdf,image/jpeg,image/png" disabled={isUploading} onChange={(event) => setFile(event.target.files?.[0] ?? null)} aria-describedby={`${id}-file-help`} />
        <p className="mt-1 text-sm text-[var(--muted)]" id={`${id}-file-help`}>{file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MiB` : "No document selected."}</p>
      </div>
      <div>
        <label className="text-sm font-semibold" htmlFor={`${id}-expires`}>Expiry date <span className="font-normal text-[var(--muted)]">(optional)</span></label>
        <input className={`${fieldClassName} max-w-sm`} id={`${id}-expires`} type="date" value={expiresOn} disabled={isUploading} onChange={(event) => setExpiresOn(event.target.value)} />
      </div>
      {(isUploading || progress > 0) && <div>
        <progress className="h-2 w-full" max={100} value={progress} aria-label="Document upload progress">{progress}%</progress>
        <p className="mt-1 text-sm text-[var(--muted)]" role="status" aria-live="polite">{status} {progress}%</p>
      </div>}
      {error && <p className="rounded-xl bg-[var(--sand)] p-3 text-sm text-[var(--terracotta)]" role="alert">{error}</p>}
      <button className="rounded-full bg-[var(--terracotta)] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isUploading}>{isUploading ? "Uploading…" : "Upload document"}</button>
    </form>
  </section>;
}

export default PropertyDocumentUploader;
