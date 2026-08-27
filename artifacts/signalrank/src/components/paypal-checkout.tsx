import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { getPublicPaymentEnvironment, createPayPalOrder, capturePayPalOrder } from "@/lib/public-api";
import { logClaimFlowEvent } from "@/lib/claim-flow-log";

type PayPalButtonActions = {
  resolve: (orderId: string) => void;
  reject: (reason?: unknown) => void;
};

type PayPalButtonInstance = {
  render: (container: HTMLElement) => void | Promise<void>;
  close?: () => void;
};

type PayPalSdk = {
  Buttons: (options: {
    createOrder: (_data: unknown, actions: PayPalButtonActions) => Promise<string>;
    onApprove: (data: { orderID?: string }) => Promise<void>;
    onCancel: () => void;
    onError: (error: unknown) => void;
  }) => PayPalButtonInstance;
};

declare global {
  interface Window {
    paypal?: PayPalSdk;
  }
}

type PayPalCheckoutProps = {
  paymentId: string;
  onCompleted: () => void;
  onCancelled?: () => void;
};

function sdkSource(clientId: string) {
  const params = new URLSearchParams({
    "client-id": clientId,
    currency: "USD",
    intent: "capture",
    components: "buttons",
    // "Pay Later" (PayPal's BNPL financing button) doesn't fit a small,
    // one-off ranking claim/boost payment -- keep PayPal and card only.
    "disable-funding": "paylater",
  });
  return `https://www.paypal.com/sdk/js?${params.toString()}`;
}

export function PayPalCheckout({ paymentId, onCompleted, onCancelled }: PayPalCheckoutProps) {
  const buttonContainer = useRef<HTMLDivElement>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void getPublicPaymentEnvironment()
      .then((environment) => {
        if (!active) return;
        const configuredClientId = "paypalClientId" in environment ? environment.paypalClientId : null;
        if (!configuredClientId) {
          setError("PayPal checkout is not configured yet. Please try again later.");
          setLoading(false);
          return;
        }
        setClientId(configuredClientId);
      })
      .catch(() => {
        if (!active) return;
        setError("PayPal checkout could not be prepared. Please try again.");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!clientId || !buttonContainer.current) return;
    let active = true;
    let instance: PayPalButtonInstance | undefined;
    const renderButtons = () => {
      if (!active || !buttonContainer.current || !window.paypal) return;
      buttonContainer.current.replaceChildren();
      instance = window.paypal.Buttons({
        createOrder: async () => {
          setError("");
          logClaimFlowEvent("PAYPAL_ORDER_CREATE_STARTED", paymentId);
          const order = await createPayPalOrder(paymentId);
          logClaimFlowEvent("PAYPAL_ORDER_CREATED", paymentId, { orderId: order.orderId, status: order.status });
          return order.orderId;
        },
        onApprove: async (data) => {
          if (!data.orderID) {
            setError("PayPal did not return an approved order. Please try again.");
            return;
          }
          logClaimFlowEvent("PAYPAL_APPROVED", paymentId, { orderId: data.orderID });
          try {
            logClaimFlowEvent("PAYPAL_CAPTURE_STARTED", paymentId, { orderId: data.orderID });
            const payment = await capturePayPalOrder(paymentId, data.orderID);
            if (payment.status !== "succeeded") {
              setError("Your payment is still being confirmed. Your ranking will update after PayPal verifies it.");
              return;
            }
            logClaimFlowEvent("PAYPAL_CAPTURED", paymentId, { orderId: data.orderID });
            onCompleted();
          } catch (captureError) {
            logClaimFlowEvent("TRANSACTION_FAILED", paymentId, { step: "capture" });
            setError(captureError instanceof Error ? captureError.message : "PayPal could not confirm this payment. Please try again.");
          }
        },
        onCancel: () => {
          setError("PayPal checkout was cancelled. Your ranking has not changed.");
          onCancelled?.();
        },
        onError: () => {
          setError("PayPal checkout could not be completed. Your ranking has not changed.");
        },
      });
      void Promise.resolve(instance.render(buttonContainer.current)).then(() => {
        if (active) logClaimFlowEvent("PAYPAL_CHECKOUT_RENDERED", paymentId);
      });
      setLoading(false);
    };

    const selector = "script[data-upndownbid-paypal-sdk]";
    const existing = document.querySelector<HTMLScriptElement>(selector);
    if (window.paypal) {
      renderButtons();
    } else if (existing) {
      existing.addEventListener("load", renderButtons, { once: true });
      existing.addEventListener("error", () => {
        if (active) {
          setError("PayPal checkout could not be loaded. Check your connection and try again.");
          setLoading(false);
        }
      }, { once: true });
    } else {
      const script = document.createElement("script");
      script.src = sdkSource(clientId);
      script.async = true;
      script.dataset.upndownbidPaypalSdk = "true";
      script.addEventListener("load", renderButtons, { once: true });
      script.addEventListener("error", () => {
        if (active) {
          setError("PayPal checkout could not be loaded. Check your connection and try again.");
          setLoading(false);
        }
      }, { once: true });
      document.head.appendChild(script);
    }
    return () => {
      active = false;
      instance?.close?.();
    };
  }, [clientId, onCancelled, onCompleted, paymentId]);

  return (
    <div className="space-y-3" data-testid="paypal-checkout">
      <p className="text-center text-xs text-muted-foreground">Pay securely with PayPal. Your leaderboard update is applied only after PayPal confirms the capture.</p>
      {loading && (
        <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading secure PayPal checkout
        </div>
      )}
      <div ref={buttonContainer} aria-label="PayPal checkout buttons" />
      {error && <p className="text-center text-xs font-medium text-destructive" role="alert">{error}</p>}
    </div>
  );
}