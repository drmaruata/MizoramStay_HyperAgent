"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PropertyDocumentUploader } from "@/components/host/property-document-uploader";
import { PropertyEditor } from "@/components/host/property-editor";
import { PropertyMediaUploader } from "@/components/host/property-media-uploader";

export type HostPropertyWorkspaceProperty = {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  description: string | null;
  addressLine1: string;
  addressLine2: string | null;
  locality: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  checkInTime: string;
  checkOutTime: string;
  maxGuests: number;
  status: string;
};

type PropertyWorkspaceProps = {
  property: HostPropertyWorkspaceProperty;
  initialAmenityIds: string[];
};

function getErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error;
  }
  return fallback;
}

export function PropertyWorkspace({ property, initialAmenityIds }: PropertyWorkspaceProps) {
  const router = useRouter();
  const [status, setStatus] = useState(property.status);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [submissionMessage, setSubmissionMessage] = useState<string | null>(null);
  const canSubmit = status === "draft";

  async function submitForReview() {
    setIsSubmitting(true);
    setSubmissionError(null);
    setSubmissionMessage(null);

    try {
      const response = await fetch(`/api/v1/host/properties/${encodeURIComponent(property.id)}/submit`, {
        method: "POST",
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Unable to submit this property for review."));
      }

      const submittedProperty = payload && typeof payload === "object" && "property" in payload
        ? payload.property
        : null;
      const nextStatus = submittedProperty && typeof submittedProperty === "object" && "status" in submittedProperty && typeof submittedProperty.status === "string"
        ? submittedProperty.status
        : "submitted";

      setStatus(nextStatus);
      setSubmissionMessage("Property submitted for review. You can continue to view its listing details while the review is pending.");
      router.refresh();
    } catch (caught) {
      setSubmissionError(caught instanceof Error ? caught.message : "Unable to submit this property for review.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return <div className="mt-8 space-y-6">
    <PropertyEditor property={property} initialAmenityIds={initialAmenityIds} />
    <div className="grid gap-6 lg:grid-cols-2">
      <PropertyMediaUploader propertyId={property.id} />
      <PropertyDocumentUploader propertyId={property.id} />
    </div>
    <section className="rounded-2xl border border-[var(--line)] bg-white p-5 sm:p-7" aria-labelledby="property-review-heading">
      <p className="eyebrow">Final step</p>
      <h2 className="serif mt-2 text-3xl" id="property-review-heading">Submit for review</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
        Add at least one active room and one property image, then send the listing to the verification team.
      </p>
      <p className="mt-4 text-sm">
        Current status: <strong className="capitalize">{status.replaceAll("_", " ")}</strong>
      </p>
      {submissionError && <p className="mt-4 rounded-xl bg-[var(--sand)] p-3 text-sm text-[var(--terracotta)]" role="alert">{submissionError}</p>}
      {submissionMessage && <p className="mt-4 rounded-xl bg-[var(--sky)] p-3 text-sm text-[var(--forest)]" role="status" aria-live="polite">{submissionMessage}</p>}
      <button
        className="mt-5 rounded-full bg-[var(--forest)] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        type="button"
        disabled={!canSubmit || isSubmitting}
        onClick={submitForReview}
        aria-describedby="property-review-help"
      >
        {isSubmitting ? "Submitting for review…" : canSubmit ? "Submit for review" : "Already submitted"}
      </button>
      <p className="mt-2 text-xs text-[var(--muted)]" id="property-review-help">
        {canSubmit ? "The verification team will review your property details and documents." : "Only draft properties can be submitted for review."}
      </p>
    </section>
  </div>;
}

export default PropertyWorkspace;
