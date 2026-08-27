import { useEffect, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ClerkProvider,
  SignIn,
  useClerk,
} from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Header, Footer, MobileNav } from '@/components/layout';
import { FeedbackButton } from '@/components/feedback-button';
import Leaderboard from '@/pages/leaderboard';
import { openClaimFlow } from '@/lib/claim-flow';
import ListingDetail from '@/pages/listing';
import About from '@/pages/about';
import Terms from '@/pages/terms';
import Privacy from '@/pages/privacy';
import WebsitePolicy from '@/pages/website-policy';
import RefundPolicy from '@/pages/refund-policy';
import CommunityGuidelines from '@/pages/community-guidelines';
import Grievance from '@/pages/grievance';
import NotFound from '@/pages/not-found';
import ListingEditPage from '@/pages/listing-edit';
import WinnersPage from '@/pages/winners';
import {
  Route,
  Switch,
  Link,
  useLocation,
  Router as WouterRouter,
  Redirect,
} from 'wouter';
import { CheckCircle2, CircleAlert, Loader2, Zap, ShieldCheck } from 'lucide-react';
import AdminDashboard from '@/pages/admin';
import OwnerDashboard from '@/pages/owner-dashboard';
import OwnerSignInPage from '@/pages/owner-sign-in';
import OwnerSignUpPage from '@/pages/owner-sign-up';
import {
  getPublicPaymentStatus,
  recordAnalyticsVisit,
} from '@/lib/public-api';
import { getOrCreateVisitorId } from '@/lib/visitor-id';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

const clerkAppearance = {
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/upndownbid-logo-lockup.png`,
  },
  variables: {
    colorPrimary: '#8b5cf6',
    colorBackground: '#fffdf9',
    colorInputBackground: '#ffffff',
    colorInputText: '#1d2430',
    fontFamily: 'Outfit, sans-serif',
    borderRadius: '0.5rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#fffdf9] border border-[#e8e0d8] rounded-xl w-[440px] max-w-full overflow-hidden shadow-xl',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#1d2430] font-bold',
    headerSubtitle: 'text-[#68707d]',
    socialButtonsBlockButtonText: 'text-[#1d2430] font-medium',
    formFieldLabel: 'text-[#1d2430] font-medium',
    footerActionLink: 'text-[#7c3aed] font-semibold',
    footerActionText: 'text-[#68707d]',
    dividerText: 'text-[#68707d]',
    formFieldSuccessText: 'text-[#168a57]',
    alertText: 'text-[#c53b3b]',
    logoBox: 'mb-5',
    logoImage: 'max-h-10',
    socialButtonsBlockButton: 'border border-[#e8e0d8] bg-white hover:bg-[#f5f0eb]',
    formButtonPrimary: 'bg-[#8b5cf6] hover:bg-[#7c3aed] text-white',
    formFieldInput: 'border-[#e8e0d8] bg-white text-[#1d2430]',
    footerAction: 'border-t border-[#e8e0d8]',
    dividerLine: 'bg-[#e8e0d8]',
    alert: 'border-red-500/20 bg-red-50',
    otpCodeFieldInput: 'border-[#e8e0d8] bg-white text-[#1d2430]',
    formFieldRow: 'gap-2',
    main: 'gap-5',
  },
};

function AdminSignInPage() {
  return (
    <div className="relative flex min-h-[100dvh] w-full items-center justify-center overflow-hidden px-4 py-10">
      <div className="absolute inset-0 z-0 bg-background">
        <div className="absolute left-1/2 top-0 -translate-x-1/2 h-[500px] w-[800px] opacity-20 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/30 via-transparent to-transparent pointer-events-none" />
      </div>
      
      <div className="relative z-10 flex w-full max-w-md flex-col items-center">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-sm ring-1 ring-primary/20">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Moderator Access
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in to access the administrative console.
          </p>
        </div>
        
        <div className="w-full">
          <SignIn
            routing="path"
            path={`${basePath}/admin/sign-in`}
            forceRedirectUrl={`${basePath}/admin`}
          />
        </div>
      </div>
    </div>
  );
}

function HomeRedirect() {
  return <Leaderboard />;
}

function CampaignBidRedirect() {
  useEffect(() => {
    openClaimFlow();
  }, []);

  return <Leaderboard />;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  // Clerk's listener fires multiple times while a session is hydrating --
  // typically once with no user yet (still loading) and again moments later
  // once the session resolves. Without tracking "have we seen a settled
  // snapshot at all", that first null->real-user transition looks identical
  // to a genuine account switch and clears the query cache mid-hydration.
  // That's exactly the wrong moment: it's the same window where a
  // just-completed Google sign-in is trying to resume a pending claim, and
  // wiping the cache there raced the campaign data the resume effect needed,
  // making the payment step appear to require a manual refresh to show up.
  // Only clear once we've already captured one settled (loaded) snapshot and
  // the user actually changes after that.
  const hasSettledSnapshotRef = useRef(false);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (!hasSettledSnapshotRef.current) {
        // First snapshot after (re)mount -- record it without clearing,
        // regardless of whether it's the initial "not yet loaded" call or
        // already-resolved. This absorbs the hydration sequence safely.
        prevUserIdRef.current = userId;
        hasSettledSnapshotRef.current = true;
        return;
      }
      if (prevUserIdRef.current !== userId) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener]);

  return null;
}

function AnalyticsTracker() {
  useEffect(() => {
    const sessionStorageKey = "upndownbid-session-id";

    try {
      const visitorId = getOrCreateVisitorId();
      if (!visitorId) return;

      let sessionId = window.sessionStorage.getItem(sessionStorageKey);
      if (!sessionId) {
        sessionId = crypto.randomUUID();
        window.sessionStorage.setItem(sessionStorageKey, sessionId);
      }

      void recordAnalyticsVisit({
        visitorId,
        sessionId,
        path: window.location.pathname,
      }).catch(() => {
        // Analytics must never interfere with the public browsing experience.
      });
    } catch {
      // Browsers that block storage are still allowed to use the site normally.
    }
  }, []);

  return null;
}

function PaymentReturnStatus() {
  const paymentId = new URLSearchParams(window.location.search).get("payment_id");
  const [status, setStatus] = useState<string | null>(null);
  const [environment, setEnvironment] = useState<"sandbox" | "live">("sandbox");
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!paymentId) return;
    let cancelled = false;
    let timer: number | undefined;

    const checkStatus = async () => {
      try {
        const payment = await getPublicPaymentStatus(paymentId);
        if (cancelled) return;
        setStatus(payment.status);
        setEnvironment(payment.environment);
        setUnavailable(false);
        if (payment.status === "succeeded") {
          void queryClient.invalidateQueries({ queryKey: ["listings"] });
          void queryClient.invalidateQueries({ queryKey: ["current-campaign"] });
          void queryClient.invalidateQueries({ queryKey: ["activity"] });
          return;
        }
        if (["failed", "refunded", "partially_refunded", "requires_reconciliation"].includes(payment.status)) {
          return;
        }
        timer = window.setTimeout(() => void checkStatus(), 3_000);
      } catch {
        if (!cancelled) setUnavailable(true);
      }
    };

    void checkStatus();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [paymentId]);

  if (!paymentId) return null;
  const state = unavailable ? "unavailable" : status ?? "pending";
  const paymentLabel = environment === "live" ? "payment" : "sandbox payment";
  const statusContent = {
    pending: {
      icon: <Loader2 className="h-4 w-4 animate-spin" />,
      title: `Confirming your ${paymentLabel}`,
      description: "Your ranking will update automatically after PayPal verifies the payment.",
      className: "border-primary/30 bg-primary/10 text-primary",
    },
    succeeded: {
      icon: <CheckCircle2 className="h-4 w-4" />,
      title: environment === "live" ? "Payment verified" : "Sandbox payment verified",
      description: "Your leaderboard update has been confirmed.",
      className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
    },
    failed: {
      icon: <CircleAlert className="h-4 w-4" />,
      title: environment === "live" ? "Payment was not completed" : "Sandbox payment was not completed",
      description: "No ranking change was made. You can try again when you are ready.",
      className: "border-destructive/30 bg-destructive/10 text-destructive",
    },
    refunded: {
      icon: <CircleAlert className="h-4 w-4" />,
      title: environment === "live" ? "Payment was refunded" : "Sandbox payment was refunded",
      description: "Its ranking effect has been reversed.",
      className: "border-amber-500/30 bg-amber-500/10 text-amber-800",
    },
    partially_refunded: {
      icon: <CircleAlert className="h-4 w-4" />,
      title: environment === "live" ? "Payment was partially refunded" : "Sandbox payment was partially refunded",
      description: "The leaderboard reflects the remaining verified amount.",
      className: "border-amber-500/30 bg-amber-500/10 text-amber-800",
    },
    requires_reconciliation: {
      icon: <CircleAlert className="h-4 w-4" />,
      title: environment === "live" ? "Payment needs reconciliation" : "Sandbox payment needs reconciliation",
      description: "No unverified ranking change has been applied.",
      className: "border-amber-500/30 bg-amber-500/10 text-amber-800",
    },
    unavailable: {
      icon: <CircleAlert className="h-4 w-4" />,
      title: "We could not check this payment yet",
      description: "Please refresh in a moment. No ranking change is shown until verification succeeds.",
      className: "border-amber-500/30 bg-amber-500/10 text-amber-800",
    },
  };
  const content = statusContent[state as keyof typeof statusContent] ?? statusContent.unavailable;

  return (
    <div className={`border-b px-4 py-3 ${content.className}`} role="status" data-testid="payment-return-status">
      <div className="mx-auto flex max-w-5xl items-start gap-2 text-sm">
        <span className="mt-0.5 shrink-0">{content.icon}</span>
        <span><strong>{content.title}.</strong> {content.description}</span>
      </div>
    </div>
  );
}

function Router() {
  return (
    <div className="min-h-screen flex flex-col font-sans text-foreground selection:bg-primary/30 selection:text-primary">
      <Header />
      <PaymentReturnStatus />
      <main className="flex-1">
        <RoutedErrorBoundary>
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/listing/:slug" component={ListingDetail} />
            <Route path="/about" component={About} />
            <Route path="/terms" component={Terms} />
            <Route path="/privacy" component={Privacy} />
            <Route path="/website-policy" component={WebsitePolicy} />
            <Route path="/refund-policy" component={RefundPolicy} />
            <Route path="/community-guidelines" component={CommunityGuidelines} />
            <Route path="/grievance" component={Grievance} />
            <Route path="/add-product" component={CampaignBidRedirect} />
            <Route path="/manage/:token" component={ListingEditPage} />
            <Route path="/winners" component={WinnersPage} />
            <Route path="/admin" component={AdminDashboard} />
            <Route path="/admin/sign-in/*?" component={AdminSignInPage} />
            <Route path="/owner/dashboard" component={OwnerDashboard} />
            <Route path="/owner/sign-in/*?" component={OwnerSignInPage} />
            <Route path="/owner/sign-up/*?" component={OwnerSignUpPage} />
            <Route component={NotFound} />
          </Switch>
        </RoutedErrorBoundary>
      </main>
      <Footer />
      <MobileNav />
      <FeedbackButton />
    </div>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/owner/sign-in`}
      signUpUrl={`${basePath}/owner/sign-up`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <AnalyticsTracker />
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Router />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
