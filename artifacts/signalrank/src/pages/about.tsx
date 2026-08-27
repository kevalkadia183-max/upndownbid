import { Link } from "wouter";
import { ArrowLeft, Shield, TrendingUp, Zap } from "lucide-react";
import { usePaymentEnvironment } from "@/hooks/use-payment-environment";

export default function About() {
  const { isLive } = usePaymentEnvironment();
  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <Link href="/" className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-primary transition-colors mb-8 group" data-testid="link-back-about">
        <ArrowLeft className="w-3 h-3 group-hover:-translate-x-1 transition-transform" />
        Back to Ledger
      </Link>

      <div className="space-y-12">
        <section>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-4 text-foreground leading-tight">
            The Public Protocol for <br />
            <span className="text-primary">Credibility Allocation.</span>
          </h1>
          <p className="text-sm font-mono text-muted-foreground leading-relaxed max-w-2xl">
            upndownbid explores a transparent alternative to opaque discovery algorithms and shallow review signals.
          </p>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-card border border-border/50 rounded-xl p-6 shadow-sm">
            <div className="w-10 h-10 bg-primary/10 text-primary rounded flex items-center justify-center mb-4">
              <TrendingUp className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold mb-2 text-foreground uppercase tracking-wider">Ranking Power</h3>
            <p className="text-muted-foreground font-mono text-xs leading-relaxed">
              Rankings are determined by Ranking Power, not an opaque algorithm.
              Ranking Power is the sum of the owner&apos;s starting claim, plus all community boosts,
              minus all push downs.
            </p>
          </div>

          <div className="bg-card border border-border/50 rounded-xl p-6 shadow-sm">
            <div className="w-10 h-10 bg-secondary/10 text-secondary rounded flex items-center justify-center mb-4">
              <Shield className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold mb-2 text-foreground uppercase tracking-wider">Economic Consensus</h3>
            <p className="text-muted-foreground font-mono text-xs leading-relaxed">
              Community signals are recorded alongside reviews so people can see the forces affecting a rank.
              {isLive ? " Every claim, boost, and push down is a real PayPal payment." : " Sandbox entries let us test that ranking model without real-money claims."}
            </p>
          </div>
        </section>

        <section className="bg-primary/5 border border-primary/20 rounded-xl p-6 md:p-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-6 opacity-10 pointer-events-none text-primary">
            <Zap className="w-24 h-24" />
          </div>
          <div className="relative z-10">
            <h2 className="text-lg font-bold mb-3 text-foreground uppercase tracking-wider flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" /> {isLive ? "Live Payments" : "Sandbox Protocol"}
            </h2>
            <div className="font-mono text-xs text-muted-foreground leading-relaxed space-y-4 max-w-2xl">
              {isLive ? (
                <>
                  <p>
                    upndownbid is operating with <strong>live PayPal payments</strong>. Claims, boosts, and push downs
                    are real transactions and move real money.
                  </p>
                  <p>
                    Every payment is verified server-side against PayPal before it affects a ranking, and every
                    ranking change is backed by a completed, verified payment.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    upndownbid is currently operating in <strong>Sandbox Mode</strong>. All displayed amounts, 
                     claims, boosts, and push downs are simulated. No real money is being exchanged.
                  </p>
                  <p>
                     During this phase, sandbox actions help test how boosts and push downs affect rankings.
                    The results inform future product decisions; they do not represent a balance, payment, or financial account.
                  </p>
                </>
              )}
            </div>
            <Link
              href="/add-product"
              className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-xs font-bold uppercase tracking-wider text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Add your product
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}