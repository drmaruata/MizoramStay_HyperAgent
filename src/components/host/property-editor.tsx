"use client";

import { FormEvent, useEffect, useId, useState } from "react";

type EditableProperty = {
  id: string;
  slug: string;
  name: string;
  summary?: string | null;
  description?: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  locality?: string | null;
  postalCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  checkInTime?: string;
  checkOutTime?: string;
  maxGuests: number;
};

type Amenity = {
  id: string;
  slug: string;
  name: string;
  category: string;
  icon_name: string | null;
};

type PropertyEditorProps = {
  property: EditableProperty;
  initialAmenityIds?: string[];
  onSaved?: (property: unknown, amenityIds: string[]) => void;
};

type FieldErrors = Record<string, string>;

function getErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") return payload.error;
  return fallback;
}

function timeForInput(value: string | undefined, fallback: string) {
  return value ? value.slice(0, 5) : fallback;
}

export function PropertyEditor({ property, initialAmenityIds = [], onSaved }: PropertyEditorProps) {
  const id = useId();
  const [name, setName] = useState(property.name);
  const [slug, setSlug] = useState(property.slug);
  const [summary, setSummary] = useState(property.summary ?? "");
  const [description, setDescription] = useState(property.description ?? "");
  const [addressLine1, setAddressLine1] = useState(property.addressLine1);
  const [addressLine2, setAddressLine2] = useState(property.addressLine2 ?? "");
  const [locality, setLocality] = useState(property.locality ?? "");
  const [postalCode, setPostalCode] = useState(property.postalCode ?? "");
  const [latitude, setLatitude] = useState(property.latitude?.toString() ?? "");
  const [longitude, setLongitude] = useState(property.longitude?.toString() ?? "");
  const [checkInTime, setCheckInTime] = useState(timeForInput(property.checkInTime, "14:00"));
  const [checkOutTime, setCheckOutTime] = useState(timeForInput(property.checkOutTime, "11:00"));
  const [maxGuests, setMaxGuests] = useState(property.maxGuests.toString());
  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [selectedAmenityIds, setSelectedAmenityIds] = useState<string[]>(initialAmenityIds);
  const [amenitiesError, setAmenitiesError] = useState<string | null>(null);
  const [isLoadingAmenities, setIsLoadingAmenities] = useState(true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function loadAmenities() {
      try {
        const response = await fetch("/api/v1/amenities", { signal: controller.signal });
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error(getErrorMessage(payload, "Unable to load amenities."));
        const catalog = payload && typeof payload === "object" && "data" in payload && Array.isArray(payload.data)
          ? payload.data as Amenity[]
          : [];
        setAmenities(catalog);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setAmenitiesError(caught instanceof Error ? caught.message : "Unable to load amenities.");
      } finally {
        if (!controller.signal.aborted) setIsLoadingAmenities(false);
      }
    }
    void loadAmenities();
    return () => controller.abort();
  }, []);

  function validate() {
    const nextErrors: FieldErrors = {};
    if (name.trim().length < 2) nextErrors.name = "Enter a property name of at least 2 characters.";
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim())) nextErrors.slug = "Use lowercase letters, numbers, and single hyphens.";
    if (!addressLine1.trim()) nextErrors.addressLine1 = "Enter the property address.";
    if (!Number.isInteger(Number(maxGuests)) || Number(maxGuests) < 1 || Number(maxGuests) > 1_000) nextErrors.maxGuests = "Enter between 1 and 1,000 guests.";
    if (checkInTime === checkOutTime) nextErrors.checkOutTime = "Check-out time must differ from check-in time.";
    if (latitude !== "" && (!Number.isFinite(Number(latitude)) || Number(latitude) < -90 || Number(latitude) > 90)) nextErrors.latitude = "Enter a latitude from -90 to 90.";
    if (longitude !== "" && (!Number.isFinite(Number(longitude)) || Number(longitude) < -180 || Number(longitude) > 180)) nextErrors.longitude = "Enter a longitude from -180 to 180.";
    return nextErrors;
  }

  function toggleAmenity(amenityId: string) {
    setSelectedAmenityIds((current) => current.includes(amenityId)
      ? current.filter((idToKeep) => idToKeep !== amenityId)
      : [...current, amenityId]);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validate();
    setErrors(nextErrors);
    setFormError(null);
    setSuccessMessage(null);
    if (Object.keys(nextErrors).length > 0) return;

    setIsSaving(true);
    try {
      const response = await fetch(`/api/v1/host/properties/${encodeURIComponent(property.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: slug.trim(),
          name: name.trim(),
          summary: summary.trim() || null,
          description: description.trim() || null,
          addressLine1: addressLine1.trim(),
          addressLine2: addressLine2.trim() || null,
          locality: locality.trim() || null,
          postalCode: postalCode.trim() || null,
          latitude: latitude === "" ? null : Number(latitude),
          longitude: longitude === "" ? null : Number(longitude),
          checkInTime,
          checkOutTime,
          maxGuests: Number(maxGuests),
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getErrorMessage(payload, "Unable to save the property."));

      const amenityResponse = await fetch(`/api/v1/host/properties/${encodeURIComponent(property.id)}/amenities`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amenityIds: selectedAmenityIds }),
      });
      const amenityPayload: unknown = await amenityResponse.json().catch(() => null);
      if (!amenityResponse.ok) {
        throw new Error(`Property details were saved, but amenities were not: ${getErrorMessage(amenityPayload, "please try saving again.")}`);
      }

      const savedProperty = payload && typeof payload === "object" && "property" in payload ? payload.property : payload;
      setSuccessMessage("Property details and amenities saved.");
      onSaved?.(savedProperty, selectedAmenityIds);
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "Unable to save the property.");
    } finally {
      setIsSaving(false);
    }
  }

  const fieldClassName = "mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 text-[var(--ink)] outline-none focus:border-[var(--forest)] focus:ring-2 focus:ring-[var(--sky)]";
  const errorId = (field: string) => `${id}-${field}-error`;
  const categories = Array.from(new Set(amenities.map((amenity) => amenity.category)));

  return <section className="rounded-2xl border border-[var(--line)] bg-white p-5 sm:p-7" aria-labelledby={`${id}-heading`}>
    <p className="eyebrow">Listing editor</p>
    <h2 className="serif mt-2 text-3xl" id={`${id}-heading`}>Edit property details</h2>
    <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Listing status and owner assignment are managed separately and cannot be changed here.</p>
    <form className="mt-6 space-y-6" onSubmit={handleSubmit} noValidate>
      <div className="grid gap-5 sm:grid-cols-2">
        <div><label className="text-sm font-semibold" htmlFor={`${id}-name`}>Property name</label><input className={fieldClassName} id={`${id}-name`} value={name} maxLength={180} onChange={(event) => setName(event.target.value)} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? errorId("name") : undefined} />{errors.name && <p className="mt-1 text-sm text-[var(--terracotta)]" id={errorId("name")}>{errors.name}</p>}</div>
        <div><label className="text-sm font-semibold" htmlFor={`${id}-slug`}>Listing slug</label><input className={fieldClassName} id={`${id}-slug`} value={slug} maxLength={180} onChange={(event) => setSlug(event.target.value)} aria-invalid={Boolean(errors.slug)} aria-describedby={errors.slug ? errorId("slug") : undefined} />{errors.slug && <p className="mt-1 text-sm text-[var(--terracotta)]" id={errorId("slug")}>{errors.slug}</p>}</div>
      </div>
      <div><label className="text-sm font-semibold" htmlFor={`${id}-summary`}>Short summary</label><textarea className={fieldClassName} id={`${id}-summary`} value={summary} maxLength={500} rows={3} onChange={(event) => setSummary(event.target.value)} /></div>
      <div><label className="text-sm font-semibold" htmlFor={`${id}-description`}>Full description</label><textarea className={fieldClassName} id={`${id}-description`} value={description} maxLength={10_000} rows={7} onChange={(event) => setDescription(event.target.value)} /></div>
      <fieldset className="space-y-5"><legend className="text-lg font-semibold">Address</legend>
        <div><label className="text-sm font-semibold" htmlFor={`${id}-address-1`}>Address line 1</label><input className={fieldClassName} id={`${id}-address-1`} value={addressLine1} maxLength={300} onChange={(event) => setAddressLine1(event.target.value)} aria-invalid={Boolean(errors.addressLine1)} aria-describedby={errors.addressLine1 ? errorId("address-1") : undefined} />{errors.addressLine1 && <p className="mt-1 text-sm text-[var(--terracotta)]" id={errorId("address-1")}>{errors.addressLine1}</p>}</div>
        <div><label className="text-sm font-semibold" htmlFor={`${id}-address-2`}>Address line 2 <span className="font-normal text-[var(--muted)]">(optional)</span></label><input className={fieldClassName} id={`${id}-address-2`} value={addressLine2} maxLength={300} onChange={(event) => setAddressLine2(event.target.value)} /></div>
        <div className="grid gap-5 sm:grid-cols-2"><div><label className="text-sm font-semibold" htmlFor={`${id}-locality`}>Locality</label><input className={fieldClassName} id={`${id}-locality`} value={locality} maxLength={120} onChange={(event) => setLocality(event.target.value)} /></div><div><label className="text-sm font-semibold" htmlFor={`${id}-postal-code`}>Postal code</label><input className={fieldClassName} id={`${id}-postal-code`} value={postalCode} maxLength={20} onChange={(event) => setPostalCode(event.target.value)} /></div></div>
      </fieldset>
      <div className="grid gap-5 sm:grid-cols-2"><div><label className="text-sm font-semibold" htmlFor={`${id}-latitude`}>Latitude <span className="font-normal text-[var(--muted)]">(optional)</span></label><input className={fieldClassName} id={`${id}-latitude`} type="number" step="any" value={latitude} onChange={(event) => setLatitude(event.target.value)} aria-invalid={Boolean(errors.latitude)} aria-describedby={errors.latitude ? errorId("latitude") : undefined} />{errors.latitude && <p className="mt-1 text-sm text-[var(--terracotta)]" id={errorId("latitude")}>{errors.latitude}</p>}</div><div><label className="text-sm font-semibold" htmlFor={`${id}-longitude`}>Longitude <span className="font-normal text-[var(--muted)]">(optional)</span></label><input className={fieldClassName} id={`${id}-longitude`} type="number" step="any" value={longitude} onChange={(event) => setLongitude(event.target.value)} aria-invalid={Boolean(errors.longitude)} aria-describedby={errors.longitude ? errorId("longitude") : undefined} />{errors.longitude && <p className="mt-1 text-sm text-[var(--terracotta)]" id={errorId("longitude")}>{errors.longitude}</p>}</div></div>
      <div className="grid gap-5 sm:grid-cols-3"><div><label className="text-sm font-semibold" htmlFor={`${id}-check-in`}>Check-in</label><input className={fieldClassName} id={`${id}-check-in`} type="time" value={checkInTime} onChange={(event) => setCheckInTime(event.target.value)} /></div><div><label className="text-sm font-semibold" htmlFor={`${id}-check-out`}>Check-out</label><input className={fieldClassName} id={`${id}-check-out`} type="time" value={checkOutTime} onChange={(event) => setCheckOutTime(event.target.value)} aria-invalid={Boolean(errors.checkOutTime)} aria-describedby={errors.checkOutTime ? errorId("check-out") : undefined} />{errors.checkOutTime && <p className="mt-1 text-sm text-[var(--terracotta)]" id={errorId("check-out")}>{errors.checkOutTime}</p>}</div><div><label className="text-sm font-semibold" htmlFor={`${id}-max-guests`}>Maximum guests</label><input className={fieldClassName} id={`${id}-max-guests`} type="number" min="1" max="1000" step="1" value={maxGuests} onChange={(event) => setMaxGuests(event.target.value)} aria-invalid={Boolean(errors.maxGuests)} aria-describedby={errors.maxGuests ? errorId("max-guests") : undefined} />{errors.maxGuests && <p className="mt-1 text-sm text-[var(--terracotta)]" id={errorId("max-guests")}>{errors.maxGuests}</p>}</div></div>
      <fieldset><legend className="text-lg font-semibold">Amenities</legend>
        {isLoadingAmenities ? <p className="mt-3 text-sm text-[var(--muted)]" role="status">Loading amenities…</p> : amenitiesError ? <p className="mt-3 rounded-xl bg-[var(--sand)] p-3 text-sm text-[var(--terracotta)]" role="alert">{amenitiesError} Property details can still be saved, but the existing amenity selection will be submitted.</p> : categories.map((category) => <div className="mt-4" key={category}><h3 className="text-sm font-bold capitalize">{category}</h3><div className="mt-2 grid gap-2 sm:grid-cols-2">{amenities.filter((amenity) => amenity.category === category).map((amenity) => <label className="flex items-center gap-3 rounded-xl border border-[var(--line)] p-3 text-sm" key={amenity.id}><input type="checkbox" checked={selectedAmenityIds.includes(amenity.id)} onChange={() => toggleAmenity(amenity.id)} /><span>{amenity.name}</span></label>)}</div></div>)}
      </fieldset>
      {formError && <p className="rounded-xl bg-[var(--sand)] p-3 text-sm text-[var(--terracotta)]" role="alert">{formError}</p>}
      {successMessage && <p className="rounded-xl bg-[var(--sky)] p-3 text-sm text-[var(--forest)]" role="status">{successMessage}</p>}
      <button className="rounded-full bg-[var(--terracotta)] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isSaving}>{isSaving ? "Saving changes…" : "Save property"}</button>
    </form>
  </section>;
}

export default PropertyEditor;
