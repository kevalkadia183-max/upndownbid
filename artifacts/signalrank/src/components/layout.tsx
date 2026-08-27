import { Link, useLocation } from "wouter";
import { useUser, useClerk } from "@clerk/react";
import { useGetMyProfile, getGetMyProfileQueryKey } from "@workspace/api-client-react";
import {
  Compass,
  LogIn,
  LogOut,
  Plus,
  Menu,
  Search,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";
import { openClaimFlow } from "@/lib/claim-flow";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./ui/sheet";

function BrandLogo({ footer = false }: { footer?: boolean }) {
  return (
    <span
      data-brand-logo
      className={cn(
        "flex min-w-0 max-w-full items-center",
        footer ? "gap-3" : "gap-2.5",
      )}
    >
      <img
        src="/upndownbid-logo-lockup.png"
        alt="upndownbid.lol"
        data-brand-lockup
        className={cn(
          "block h-auto max-w-full w-auto object-contain",
          footer ? "h-10" : "h-8 sm:h-9",
        )}
      />
    </span>
  );
}

function BrandLink({ footer = false }: { footer?: boolean }) {
  return (
    <Link
      href="/"
      data-brand-link
      className={cn(
        "min-w-0 max-w-full shrink flex items-center group",
        footer ? "gap-2 mb-4" : "gap-2.5",
      )}
      data-testid={footer ? "link-footer-home" : "link-home"}
    >
      <BrandLogo footer={footer} />
    </Link>
  );
}

export function Header() {
  const [location] = useLocation();
  const { isLoaded: isClerkLoaded, isSignedIn } = useUser();
  const { signOut } = useClerk();
  const { data: profile } = useGetMyProfile({
    query: {
      enabled: Boolean(isClerkLoaded && isSignedIn),
      queryKey: getGetMyProfileQueryKey(),
      staleTime: 60_000,
    },
  });
  const isModerator = profile?.role === "moderator" || profile?.role === "admin";

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div data-brand-header-inner className="container mx-auto flex h-14 items-center justify-between gap-3 px-4">
          <BrandLink />

          <nav className="hidden lg:flex items-center gap-5">
            <Link
              href="/#discover"
              className={cn(
                "text-xs font-bold uppercase tracking-wider transition-colors hover:text-primary",
                location === "/" ? "text-primary" : "text-muted-foreground"
              )}
              data-testid="link-discover"
            >
              Explore
            </Link>
            <Link href="/about" className="text-xs font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:text-primary" data-testid="link-sandbox">How it works</Link>
            <Link
              href={isSignedIn ? "/owner/dashboard" : "/owner/sign-in"}
              className="text-xs font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:text-primary"
              data-testid="link-owner-sign-in"
            >
              {isSignedIn ? "Owner portal" : "Owner login"}
            </Link>
            {isModerator && (
              <Link href="/admin" className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary transition-colors hover:text-primary/80" data-testid="link-admin">
                <ShieldCheck className="h-3.5 w-3.5" />
                Admin
              </Link>
            )}
            {isClerkLoaded && (
              isSignedIn ? (
                <button
                  type="button"
                  onClick={() => void signOut({ redirectUrl: "/" })}
                  className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:text-primary"
                  data-testid="button-sign-out"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </button>
              ) : (
                <Link
                  href="/owner/sign-in"
                  className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:text-primary"
                  data-testid="button-sign-in"
                >
                  <LogIn className="h-3.5 w-3.5" />
                  Sign in
                </Link>
              )
            )}
            <Link href="/#discover" aria-label="Search listings" className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground" data-testid="link-search">
              <Search className="h-4 w-4" />
            </Link>
          </nav>

          <div data-brand-controls className="flex shrink-0 items-center gap-2">
            <Link href="/#discover" aria-label="Search listings" className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground lg:hidden" data-testid="button-mobile-search">
              <Search className="h-4 w-4" />
            </Link>
            <Button size="sm" className="hidden h-9 rounded-md bg-primary px-3 text-xs font-bold uppercase tracking-wider text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 sm:inline-flex" asChild data-testid="button-campaign-bid">
              <Link href="/add-product" onClick={openClaimFlow}><Plus className="mr-1.5 h-3.5 w-3.5" /> Claim a spot</Link>
            </Button>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-md lg:hidden" aria-label="Open navigation menu" data-testid="button-mobile-menu">
                  <Menu className="h-4 w-4" />
                </Button>
              </SheetTrigger>
              <SheetContent data-mobile-menu-sheet side="right" className="w-[86vw] border-border/60 bg-card p-6">
                <SheetHeader className="text-left">
                  <SheetTitle className="text-base font-bold">Navigate</SheetTitle>
                  <SheetDescription className="font-mono text-xs">Explore the public signal network.</SheetDescription>
                </SheetHeader>
                <nav className="mt-8 grid gap-2" aria-label="Mobile menu">
                  {[
                    { href: "/#discover", label: "Browse categories", id: "mobile-menu-categories" },
                    { href: "/about", label: "How it works", id: "mobile-menu-how-it-works" },
                    { href: "/#campaign-bid", label: "Claim a campaign spot", id: "mobile-menu-campaign-bid" },
                    {
                      href: isSignedIn ? "/owner/dashboard" : "/owner/sign-in",
                      label: isSignedIn ? "Owner portal" : "Owner login",
                      id: "mobile-menu-owner-sign-in",
                    },
                    ...(isModerator
                      ? [{ href: "/admin", label: "Admin dashboard", id: "mobile-menu-admin" }]
                      : []),
                  ].map((item) => (
                    <SheetClose asChild key={item.id}>
                      <Link
                        href={item.href}
                        onClick={item.id === "mobile-menu-campaign-bid" ? openClaimFlow : undefined}
                        className="rounded-md border border-border/50 bg-muted/20 px-4 py-3 text-sm font-semibold transition-colors hover:border-primary/50 hover:text-primary"
                        data-mobile-menu-link
                        data-testid={`link-${item.id}`}
                      >
                        {item.label}
                      </Link>
                    </SheetClose>
                  ))}
                  {isClerkLoaded && (
                    isSignedIn ? (
                      <SheetClose asChild>
                        <button
                          type="button"
                          onClick={() => void signOut({ redirectUrl: "/" })}
                          className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-left text-sm font-semibold text-destructive transition-colors hover:border-destructive/50"
                          data-mobile-menu-link
                          data-testid="mobile-menu-sign-out"
                        >
                          <LogOut className="h-4 w-4" />
                          Sign out
                        </button>
                      </SheetClose>
                    ) : (
                      <SheetClose asChild>
                        <Link
                          href="/owner/sign-in"
                          className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-sm font-semibold text-primary transition-colors hover:border-primary/50"
                          data-mobile-menu-link
                          data-testid="mobile-menu-sign-in"
                        >
                          <LogIn className="h-4 w-4" />
                          Sign in
                        </Link>
                      </SheetClose>
                    )
                  )}
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>
    </>
  );
}

export function MobileNav() {
  const { isSignedIn } = useUser();
  return (
    <nav data-mobile-navigation className="fixed inset-x-4 bottom-4 z-50 grid grid-cols-3 rounded-xl border border-border/60 bg-card/95 p-1.5 shadow-xl backdrop-blur-xl md:hidden" aria-label="Mobile navigation">
      <Link href="/#discover" className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-bold uppercase tracking-wider text-primary transition-colors hover:bg-muted/50" data-testid="mobile-nav-discover">
        <Compass className="h-4 w-4" />
        Discover
      </Link>
      <Link href="/add-product" onClick={openClaimFlow} className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg bg-primary text-[10px] font-bold uppercase tracking-wider text-primary-foreground transition-colors hover:bg-primary/90" data-testid="mobile-nav-campaign-bid">
        <Plus className="h-4 w-4" />
        Claim a Spot
      </Link>
      <Link
        href={isSignedIn ? "/owner/dashboard" : "/owner/sign-in"}
        className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-muted/50 hover:text-primary"
        data-testid="mobile-nav-owner-login"
      >
        <UserRound className="h-4 w-4" />
        {isSignedIn ? "Portal" : "Owner"}
      </Link>
    </nav>
  );
}

export function Footer() {
  return (
    <footer className="mt-8 border-t border-border/40 bg-background pb-28 pt-12 md:mt-24 md:py-12">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          <div className="col-span-2">
            <BrandLink footer />
            <p className="text-muted-foreground text-xs max-w-xs leading-relaxed font-mono">
              The public credibility and momentum leaderboard for products and businesses. 
              Financial position and review quality stay explicitly distinct.
            </p>
          </div>
          <div>
            <h4 className="font-bold uppercase tracking-wider mb-4 text-foreground text-xs">Platform</h4>
            <ul className="space-y-2 text-sm font-mono text-muted-foreground">
              <li><Link href="/" className="hover:text-primary transition-colors" data-testid="link-footer-leaderboard">Leaderboard</Link></li>
              <li><Link href="/about" className="hover:text-primary transition-colors" data-testid="link-footer-sandbox">Sandbox Protocol</Link></li>
              <li><Link href="/owner/dashboard" className="hover:text-primary transition-colors" data-testid="link-footer-owner">Owner Portal</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-bold uppercase tracking-wider mb-4 text-foreground text-xs">Legal</h4>
            <ul className="space-y-2 text-sm font-mono text-muted-foreground">
              <li><Link href="/terms" className="hover:text-primary transition-colors" data-testid="link-footer-terms">Terms & Conditions</Link></li>
              <li><Link href="/privacy" className="hover:text-primary transition-colors" data-testid="link-footer-privacy">Privacy Policy</Link></li>
              <li><Link href="/website-policy" className="hover:text-primary transition-colors" data-testid="link-footer-website-policy">Website & Content Policy</Link></li>
              <li><Link href="/refund-policy" className="hover:text-primary transition-colors" data-testid="link-footer-refund-policy">Refund & Cancellation Policy</Link></li>
              <li><Link href="/community-guidelines" className="hover:text-primary transition-colors" data-testid="link-footer-community-guidelines">Community Guidelines</Link></li>
              <li><Link href="/grievance" className="hover:text-primary transition-colors" data-testid="link-footer-grievance">Grievance Redressal</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-border/40 pt-6 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
            &copy; {new Date().getFullYear()} upndownbid
          </p>
          <div className="flex items-center gap-2 text-[10px] font-mono font-bold text-primary bg-primary/10 px-2.5 py-1 rounded border border-primary/20">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary"></span>
            </span>
            NETWORK ONLINE
          </div>
        </div>
      </div>
    </footer>
  );
}
