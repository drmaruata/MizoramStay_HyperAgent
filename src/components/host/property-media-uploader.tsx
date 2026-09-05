"use client";

import { FormEvent, useId, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

const MEDIA_BUCKET = "property-media";
const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

type SavedMedia = {
  id: string;
  property_id: string;
  storage_path: string;
  alt_text: string | null;
  sort_order: number;
  is_cover: boolean;
};

type PropertyMediaUploaderProps = {
  propertyId: string;
  onComplete?: (media: SavedMedia) => void;
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

export function PropertyMediaUploader({ propertyId, onComplete }: PropertyMediaUploaderProps) {
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [altText, setAltText] = useState("");
  const [isCover, setIsCover] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("Choose an image to upload.");
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError(null);
    if (!propertyId) return setError("Choose a property before uploading an image.");
    if (!file) return setError("Choose an image to upload.");
    if (!MEDIA_TYPES.has(file.type)) return setError("Choose a JPEG, PNG, or WebP image.");
    if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) return setError("Image must be larger than 0 bytes and no more than 10 MiB.");

    setIsUploading(true);
    setProgress(10);
    setStatus("Preparing a secure upload…");
    try {
      const signingResponse = await fetch("/api/v1/host/media/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, fileName: file.name, contentType: file.type, fileSize: file.size }),
      });
      const signingPayload: unknown = await signingResponse.json().catch(() => null);
      if (!signingResponse.ok) throw new Error(getErrorMessage(signingPayload, "Unable to prepare the image upload."));

      const signed = signingPayload as UploadUrlResponse;
      if (signed.bucket !== MEDIA_BUCKET || typeof signed.path !== "string" || typeof signed.token !== "string" || !isExpectedPath(signed.path, propertyId)) {
        throw new Error("The upload service returned an invalid image destination.");
      }

      setProgress(35);
      setStatus("Uploading image…");
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(MEDIA_BUCKET)
        .uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type, upsert: false });
      if (uploadError) throw new Error("The image upload failed. Please try again.");

      setProgress(85);
      setStatus("Saving image details…");
      const completionResponse = await fetch("/api/v1/host/media/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId,
          path: signed.path,
          contentType: file.type,
          fileSize: file.size,
          altText: altText.trim() || null,
          isCover,
        }),
      });
      const completionPayload: unknown = await completionResponse.json().catch(() => null);
      if (!completionResponse.ok) throw new Error(getErrorMessage(completionPayload, "The image uploaded, but its details could not be saved."));

      const media = completionPayload && typeof completionPayload === "object" && "media" in completionPayload
        ? completionPayload.media as SavedMedia
        : null;
      if (!media?.id) throw new Error("The image uploaded, but the saved record was missing.");

      setProgress(100);
      setStatus("Image uploaded and saved.");
      setFile(null);
      setAltText("");
      setIsCover(false);
      onComplete?.(media);
      form.reset();
    } catch (caught) {
      setProgress(0);
      setStatus("Upload did not complete.");
      setError(caught instanceof Error ? caught.message : "Unable to upload the image.");
    } finally {
      setIsUploading(false);
    }
  }

  const fieldClassName = "mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 text-[var(--ink)] outline-none focus:border-[var(--forest)] focus:ring-2 focus:ring-[var(--sky)]";

  return <section className="rounded-2xl border border-[var(--line)] bg-white p-5 sm:p-7" aria-labelledby={`${id}-heading`}>
    <h2 className="serif text-3xl" id={`${id}-heading`}>Add property photos</h2>
    <p className="mt-2 text-sm leading-6 text-[var(--muted)]">JPEG, PNG, or WebP, up to 10 MiB. Images upload only to this property.</p>
    <form className="mt-6 space-y-5" onSubmit={handleSubmit} noValidate>
      <div>
        <label className="text-sm font-semibold" htmlFor={`${id}-file`}>Image file</label>
        <input className={fieldClassName} id={`${id}-file`} type="file" accept="image/jpeg,image/png,image/webp" disabled={isUploading} onChange={(event) => setFile(event.target.files?.[0] ?? null)} aria-describedby={`${id}-file-help`} />
        <p className="mt-1 text-sm text-[var(--muted)]" id={`${id}-file-help`}>{file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MiB` : "No image selected."}</p>
      </div>
      <div>
        <label className="text-sm font-semibold" htmlFor={`${id}-alt`}>Image description <span className="font-normal text-[var(--muted)]">(optional)</span></label>
        <input className={fieldClassName} id={`${id}-alt`} value={altText} maxLength={500} disabled={isUploading} onChange={(event) => setAltText(event.target.value)} placeholder="For example, front view of the homestay" />
      </div>
      <label className="flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={isCover} disabled={isUploading} onChange={(event) => setIsCover(event.target.checked)} /><span><strong>Use as cover image</strong><span className="block text-[var(--muted)]">Only one cover image can be assigned to a property.</span></span></label>
      {(isUploading || progress > 0) && <div>
        <progress className="h-2 w-full" max={100} value={progress} aria-label="Image upload progress">{progress}%</progress>
        <p className="mt-1 text-sm text-[var(--muted)]" role="status" aria-live="polite">{status} {progress}%</p>
      </div>}
      {error && <p className="rounded-xl bg-[var(--sand)] p-3 text-sm text-[var(--terracotta)]" role="alert">{error}</p>}
      <button className="rounded-full bg-[var(--terracotta)] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isUploading}>{isUploading ? "Uploading…" : "Upload image"}</button>
    </form>
  </section>;
}

export default PropertyMediaUploader;
