import { useQuery } from "@tanstack/react-query";
import { getPublicPaymentEnvironment } from "@/lib/public-api";

// Single source of truth for "are we charging real money right now" across
// the app. Any UI copy that claims "sandbox" / "no real funds" or "live" /
// "real funds transferred" must derive from this, never be hardcoded --
// hardcoded sandbox copy would keep telling users no real money is at stake
// after the app is flipped to live PayPal, which is a launch-blocking
// trust/legal problem, not just a cosmetic one.
export function usePaymentEnvironment() {
  const { data } = useQuery({
    queryKey: ["payment-environment"],
    queryFn: getPublicPaymentEnvironment,
    staleTime: 60_000,
  });
  const isLive = data?.mode === "live";
  return { paymentEnvironment: data, isLive };
}
