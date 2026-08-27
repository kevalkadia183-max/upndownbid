import { Link } from "wouter";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="container mx-auto px-4 py-24 flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="w-16 h-16 bg-muted/30 rounded-xl flex items-center justify-center mb-6 border border-border/50">
        <Search className="w-8 h-8 text-muted-foreground" />
      </div>
      <h1 className="text-2xl font-bold uppercase tracking-wider text-foreground mb-3">404 - Area Not Found</h1>
      <p className="text-sm font-mono text-muted-foreground max-w-md mb-8">
        The node you're looking for doesn't exist on the public ledger.
        It might have been moved or the locator is incorrect.
      </p>
      <Button asChild size="sm" className="rounded bg-primary text-primary-foreground font-bold uppercase tracking-wider" data-testid="button-not-found-home">
        <Link href="/">Return to Ledger</Link>
      </Button>
    </div>
  );
}