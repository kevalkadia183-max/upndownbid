import { Link } from "wouter";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useGetPolicy, useGetSiteSettings } from "@workspace/api-client-react";
import { MarkdownLite } from "@/lib/markdown-lite";
import { resolvePolicyTokens } from "@/lib/policy-tokens";

// The six public policy types, keyed exactly as the API stores/expects them.
export type PolicyType =
  | "terms"
  | "privacy"
  | "website_policy"
  | "refund_policy"
  | "community_guidelines"
  | "grievance";

export function PolicyPage({ policyType }: { policyType: PolicyType }) {
  const { data: policy, isLoading, error } = useGetPolicy(policyType);
  const { data: siteSettings } = useGetSiteSettings();

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-primary transition-colors mb-8 group"
        data-testid={`link-back-${policyType}`}
      >
        <ArrowLeft className="w-3 h-3 group-hover:-translate-x-1 transition-transform" />
        Back to Ledger
      </Link>

      {isLoading && (
        <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground" data-testid={`loading-${policyType}`}>
          <Loader2 className="h-4 w-4 animate-spin" /> Loading policy…
        </div>
      )}

      {error && !isLoading && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive" data-testid={`error-${policyType}`}>
          This policy is not available right now. Please try again shortly.
        </div>
      )}

      {policy && (
        <div data-testid={`policy-content-${policyType}`}>
          <h1 className="text-3xl font-bold tracking-tight mb-2 border-b border-border/40 pb-4">{policy.title}</h1>
          <p className="mb-8 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            {policy.publishedAt ? `Last published ${new Date(policy.publishedAt).toLocaleDateString()}` : "Not yet published"}
          </p>
          <MarkdownLite content={resolvePolicyTokens(policy.content, siteSettings)} />
        </div>
      )}
    </div>
  );
}
