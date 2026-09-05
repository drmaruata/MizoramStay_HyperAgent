"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type BookingCheckoutProps = {
  bookingId: string;
  holdExpiresAt: string;
  amount: number;
  currencyCode: string;
  contact: {
    name: string;
    email: string;
    phone?: string | null;
  };
  propertyName: string;
};

type RazorpayOrder = {
  orderId: string;
  keyId: string;
  amount: number;
  currency: string;
};

type RazorpaySuccess = {
  razorpay_payment_id?: string;
  razorpay_order_id?: string;
  razorpay_signature?: string;
};

type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description: string;
  prefill: { name: string; email: string; contact?: string };
  notes: { booking_id: string };
  theme: { color: string };
  modal: { ondismiss: () => void };
  handler: (response: RazorpaySuccess) => void;
};

type RazorpayInstance = {
  open: () => void;
  on: (event: "payment.failed", handler: () => void) => void;
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

const RAZORPAY_CHECKOUT_URL = "https://checkout.razorpay.com/v1/checkout.js";
let razorpayScriptPromise: Promise<void> | null = null;

function loadRazorpayCheckout() {
  if (window.Razorpay) return Promise.resolve();
  if (razorpayScriptPromise) return razorpayScriptPromise;

  razorpayScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${RAZORPAY_CHECKOUT_URL}"]`);
    const script = existing ?? document.createElement("script");

    const handleLoad = () => window.Razorpay
      ? resolve()
      : reject(new Error("Payment checkout did not initialize."));
    const handleError = () => {
      razorpayScriptPromise = null;
      reject(new Error("Payment checkout could not be loaded."));
    };

    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });
    if (!existing) {
      script.src = RAZORPAY_CHECKOUT_URL;
      script.async = true;
      script.crossOrigin = "anonymous";
      document.head.appendChild(script);
    }
  });

  return razorpayScriptPromise;
}

function getErrorMessage(payload: unknown, fallback: string) {
  return payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
    ? payload.error
    : fallback;
}

function formatAmount(amount: number, currencyCode: string) {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: currencyCode }).format(amount);
  } catch {
    return `${currencyCode} ${amount.toLocaleString("en-IN")}`;
  }
}

function formatRemaining(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function BookingCheckout({
  bookingId,
  holdExpiresAt,
  amount,
  currencyCode,
  contact,
  propertyName,
}: BookingCheckoutProps) {
  const router = useRouter();
  const expiresAt = new Date(holdExpiresAt).getTime();
  const [remaining, setRemaining] = useState(() => Math.max(0, expiresAt - Date.now()));
  const [state, setState] = useState<"idle" | "starting" | "checkout" | "pending" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRemaining(Math.max(0, expiresAt - Date.now()));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  useEffect(() => () => {
    if (refreshTimer.current) clearInterval(refreshTimer.current);
  }, []);

  const expired = remaining <= 0;

  function beginConfirmationChecks() {
    if (refreshTimer.current) clearInterval(refreshTimer.current);
    let attempts = 0;
    refreshTimer.current = setInterval(() => {
      attempts += 1;
      router.refresh();
      if (attempts >= 12 && refreshTimer.current) {
        clearInterval(refreshTimer.current);
        refreshTimer.current = null;
      }
    }, 5_000);
  }

  async function startCheckout() {
    if (expired || state === "starting" || state === "checkout" || state === "pending") return;
    setState("starting");
    setMessage(null);

    try {
      const response = await fetch("/api/v1/payments/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getErrorMessage(payload, "Unable to start payment."));
      if (!payload || typeof payload !== "object" || !("order" in payload)) {
        throw new Error("Payment service returned an invalid response.");
      }
      const order = payload.order as RazorpayOrder;

      await loadRazorpayCheckout();
      if (!window.Razorpay) throw new Error("Payment checkout is unavailable.");

      setState("checkout");
      const checkout = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name: "MizoramStay",
        description: propertyName,
        prefill: {
          name: contact.name,
          email: contact.email,
          contact: contact.phone ?? undefined,
        },
        notes: { booking_id: bookingId },
        theme: { color: "#286052" },
        modal: {
          ondismiss: () => setState((current) => current === "pending" ? current : "idle"),
        },
        handler: () => {
          // Browser callbacks are not proof of payment. Only the signed webhook can
          // confirm the booking, so this state remains pending while server data refreshes.
          setState("pending");
          setMessage("Payment submitted. We’re waiting for secure confirmation from Razorpay.");
          beginConfirmationChecks();
          router.refresh();
        },
      });
      checkout.on("payment.failed", () => {
        setState("error");
        setMessage("Razorpay did not complete the payment. You can try again while the hold is active.");
      });
      checkout.open();
    } catch (caught) {
      setState("error");
      setMessage(caught instanceof Error ? caught.message : "Unable to start payment.");
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-white p-5 sm:p-6" aria-labelledby="payment-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Secure payment</p>
          <h2 className="mt-2 text-2xl font-semibold" id="payment-heading">Complete your booking</h2>
        </div>
        <span className={`rounded-full px-3 py-1.5 text-sm font-semibold ${expired ? "bg-red-50 text-red-800" : "bg-[var(--sand)] text-[var(--deep)]"}`}>
          {expired ? "Hold expired" : `${formatRemaining(remaining)} remaining`}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
        Pay {formatAmount(amount, currencyCode)} through Razorpay before the hold ends. Payment details are entered in Razorpay&apos;s secure checkout.
      </p>
      {message && (
        <p className={`mt-4 rounded-xl p-3 text-sm leading-6 ${state === "error" ? "bg-red-50 text-red-800" : "bg-[var(--sky)] text-[var(--deep)]"}`} role={state === "error" ? "alert" : "status"}>
          {message}
        </p>
      )}
      <button
        type="button"
        onClick={startCheckout}
        disabled={expired || state === "starting" || state === "checkout" || state === "pending"}
        className="mt-5 w-full rounded-full bg-[var(--terracotta)] px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        {expired
          ? "Payment hold expired"
          : state === "starting"
            ? "Preparing secure checkout…"
            : state === "checkout"
              ? "Checkout open…"
              : state === "pending"
                ? "Awaiting payment confirmation…"
                : `Pay ${formatAmount(amount, currencyCode)}`}
      </button>
      <p className="mt-3 text-center text-xs leading-5 text-[var(--muted)]">
        A successful browser message is not final confirmation. Your booking changes to confirmed only after MizoramStay receives Razorpay&apos;s verified webhook.
      </p>
    </section>
  );
}

export default BookingCheckout;
