import { useState } from "react";
import { useAuth } from "@clerk/react";
import { Redirect } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGetAdminOverviewQueryKey,
  getSearchAdminUsersQueryKey,
  getGetAdminPoliciesQueryKey,
  getGetSiteSettingsQueryKey,
  useGetAdminOverview,
  useSearchAdminUsers,
  useGetAdminPolicies,
  useGetSiteSettings,
  updateAdminListingStatus,
  updateAdminUserStatus,
  updateAdminUserRole,
  moderateListing,
  moderateReview,
  resolveReport,
  resolveFeedback,
  updateRateLimit,
  updateAdminPolicy,
  updateAdminSiteSettings,
  downloadAdminInvoicePdf,
  ListingModerationInputModerationStatus,
  getGetAdminSponsorshipsQueryKey,
  useGetAdminSponsorships,
  useGetSponsorshipAvailability,
  getGetSponsorshipAvailabilityQueryKey,
  cancelSponsorship as cancelSponsorshipRequest,
  type AdminPolicy,
  type AdminSponsorship,
} from "@workspace/api-client-react";
import {
  Activity,
  Ban,
  CheckCircle2,
  Download,
  EyeOff,
  FileWarning,
  Gauge,
  Landmark,
  Loader2,
  MessageCircleWarning,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  Star,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { getCurrentCampaign } from "@/lib/public-api";

// Every key the Site Settings panel below can edit, kept in one place so
// every draft-merge callback stays in sync without repeating the full
// field list at each call site. taxRatePercent is a number on the wire
// (see SiteSettings in the API spec) but a plain string here like every
// other field, converted back to a number only when saveSiteSettings()
// sends it.
const SITE_SETTING_FIELDS = [
  "businessName",
  "businessAddress",
  "supportEmail",
  "grievanceOfficerName",
  "grievanceOfficerEmail",
  "invoiceAdminEmail",
  "taxRatePercent",
  "taxRegistrationNumber",
  "taxLabel",
  "sponsorshipPriceCents",
  "sponsorshipDurationDays",
] as const;

function baseSiteSettingsDraft(
  draft: Record<string, string> | null,
  siteSettings: Partial<Record<(typeof SITE_SETTING_FIELDS)[number], string | number | null>> | undefined,
): Record<string, string> {
  const base: Record<string, string> = {};
  for (const field of SITE_SETTING_FIELDS) {
    if (draft?.[field] !== undefined) {
      base[field] = draft[field];
      continue;
    }
    const raw = siteSettings?.[field];
    base[field] = raw === null || raw === undefined ? "" : String(raw);
  }
  return base;
}

type DashboardTab =
  | "users"
  | "listings"
  | "transactions"
  | "reviews"
  | "reports"
  | "feedback"
  | "limits"
  | "campaign"
  | "sponsorships"
  | "policies"
  | "audit";

const visibleTransactionLabels: Record<string, string> = {
  OWNER_BID: "CLAIM",
  COMMUNITY_BID: "BOOST",
  PENALTY: "PUSH DOWN",
};

const tabs: Array<{ id: DashboardTab; label: string }> = [
  { id: "users", label: "Users" },
  { id: "listings", label: "Listings" },
  { id: "transactions", label: "Transactions" },
  { id: "reviews", label: "Reviews" },
  { id: "reports", label: "Reports" },
  { id: "feedback", label: "Feedback" },
  { id: "limits", label: "Limits" },
  { id: "campaign", label: "Campaign" },
  { id: "sponsorships", label: "Featured Sponsors" },
  { id: "policies", label: "Policies" },
  { id: "audit", label: "Audit log" },
];

const POLICY_LABELS: Record<string, string> = {
  terms: "Terms & Conditions",
  privacy: "Privacy Policy",
  website_policy: "Website & Content Policy",
  refund_policy: "Refund & Cancellation Policy",
  community_guidelines: "Community Guidelines",
  grievance: "Grievance Redressal",
};

const MODERATION_STATUS_OPTIONS = Object.values(ListingModerationInputModerationStatus);

function StatusBadge({ value }: { value: string }) {
  const destructive = ["suspended", "hidden", "open", "failed", "refunded", "partially_refunded", "PENALTY"].includes(value);
  const review = ["under_review", "requires_reconciliation", "COMMUNITY_BID"].includes(value);
  const success = ["active", "published", "resolved", "succeeded", "OWNER_BID", "admin", "moderator"].includes(value);
  
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md transition-colors",
        destructive && "border-destructive/30 bg-destructive/10 text-destructive",
        success && "border-primary/30 bg-primary/10 text-primary",
        review && "border-amber-500/30 bg-amber-500/10 text-amber-600",
        !destructive && !success && !review && "border-border/50 bg-muted/50 text-muted-foreground"
      )}
    >
      {visibleTransactionLabels[value] ?? value.replaceAll("_", " ")}
    </Badge>
  );
}

function InvoiceCell({
  invoiceId,
  invoiceNumber,
  invoiceStatus,
}: {
  invoiceId: string;
  invoiceNumber: string | null;
  invoiceStatus: string | null;
}) {
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    setDownloading(true);
    try {
      const blob = await downloadAdminInvoicePdf(invoiceId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${invoiceNumber ?? invoiceId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast({ variant: "destructive", title: "Could not download invoice", description: "Try again in a moment." });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0">
        <p className="truncate font-mono text-[10px] font-bold text-foreground">{invoiceNumber}</p>
        {invoiceStatus && <StatusBadge value={invoiceStatus} />}
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void handleDownload()}
        disabled={downloading}
        className="h-7 shrink-0 rounded border-border/60 px-2 text-[10px] font-bold uppercase tracking-wider"
        data-testid={`button-download-admin-invoice-${invoiceId}`}
      >
        <Download className="h-3 w-3" />
      </Button>
    </div>
  );
}

function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          {children}
        </table>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const { isLoaded, isSignedIn } = useAuth();
  const [activeTab, setActiveTab] = useState<DashboardTab>("reports");
  const [limitDrafts, setLimitDrafts] = useState<
    Record<string, { maxRequests: number; windowSeconds: number }>
  >({});
  const [memberSearch, setMemberSearch] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: campaign, refetch: refetchCampaign } = useQuery({
    queryKey: ["current-campaign"],
    queryFn: getCurrentCampaign,
    staleTime: 30_000,
    enabled: Boolean(isLoaded && isSignedIn),
  });
  const [campaignMinimum, setCampaignMinimum] = useState<number | null>(null);
  const [selectedPolicyType, setSelectedPolicyType] = useState<string | null>(null);
  const [policyDraft, setPolicyDraft] = useState<{ title: string; content: string } | null>(null);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [siteSettingsDraft, setSiteSettingsDraft] = useState<Record<string, string> | null>(null);
  const [savingSiteSettings, setSavingSiteSettings] = useState(false);
  const { data: policies, isLoading: isLoadingPolicies } = useGetAdminPolicies({
    query: {
      queryKey: getGetAdminPoliciesQueryKey(),
      enabled: Boolean(isLoaded && isSignedIn),
    },
  });
  const { data: siteSettings } = useGetSiteSettings({
    query: {
      queryKey: getGetSiteSettingsQueryKey(),
      enabled: Boolean(isLoaded && isSignedIn),
    },
  });
  // Site settings return null for sponsorship price/duration until an admin
  // explicitly overrides them -- fall back to this live "effective" value
  // (the same one the checkout flow actually charges) so the settings form
  // never shows blank inputs for a product that is already live with a
  // built-in default. Sourced from the server, never a duplicated constant.
  const { data: sponsorshipAvailability } = useGetSponsorshipAvailability({
    query: {
      queryKey: getGetSponsorshipAvailabilityQueryKey(),
      enabled: Boolean(isLoaded && isSignedIn),
    },
  });
  const { data, isLoading, isFetching, error, refetch } = useGetAdminOverview({
    query: {
      queryKey: getGetAdminOverviewQueryKey(),
      enabled: Boolean(isLoaded && isSignedIn),
    },
  });
  const { data: searchedMembers = [], isFetching: isSearchingMembers } = useSearchAdminUsers(
    { search: memberSearch.trim() || undefined },
    {
      query: {
        queryKey: getSearchAdminUsersQueryKey({
          search: memberSearch.trim() || undefined,
        }),
        enabled: Boolean(isLoaded && isSignedIn && data?.actorRole === "admin"),
      },
    },
  );
  const { data: sponsorships, isLoading: isLoadingSponsorships } = useGetAdminSponsorships({
    query: {
      queryKey: getGetAdminSponsorshipsQueryKey(),
      enabled: Boolean(isLoaded && isSignedIn && data?.actorRole === "admin"),
    },
  });
  const [cancellingSponsorshipId, setCancellingSponsorshipId] = useState<string | null>(null);

  if (!isLoaded) {
    return (
      <div className="container mx-auto flex min-h-[50vh] max-w-7xl flex-col items-center justify-center px-4 py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary/60 mb-4" />
        <h2 className="text-lg font-bold text-foreground">Loading workspace</h2>
      </div>
    );
  }
  if (!isSignedIn) {
    return <Redirect to="/admin/sign-in" />;
  }

  async function runAction(
    description: string,
    action: () => Promise<unknown>,
  ) {
    try {
      await action();
      await queryClient.invalidateQueries({
        queryKey: getGetAdminOverviewQueryKey(),
      });
      await queryClient.invalidateQueries({
        queryKey: getSearchAdminUsersQueryKey(),
      });
      toast({ title: "Moderation action recorded", description });
    } catch {
      toast({
        variant: "destructive",
        title: "Action was not applied",
        description: "The server rejected this moderation request.",
      });
    }
  }

  async function saveCampaignMinimum() {
    const minimumBid = campaignMinimum ?? campaign?.minimumBid;
    if (!minimumBid || minimumBid < 1) return;
    try {
      const response = await fetch("/api/admin/campaigns/current", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minimumBid }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Update rejected");
      setCampaignMinimum(null);
      await refetchCampaign();
      toast({ title: "Campaign minimum updated", description: `Campaign #${campaign?.number ?? ""} now requires at least ${formatCurrency(minimumBid)}.` });
    } catch (saveError) {
      toast({ variant: "destructive", title: "Campaign setting not saved", description: saveError instanceof Error ? saveError.message : "Try again." });
    }
  }

  function confirmAction(message: string) {
    return window.confirm(message);
  }

  async function cancelSponsorshipAction(sponsorship: AdminSponsorship) {
    if (!confirmAction(`Cancel the Featured slot for "${sponsorship.listing.name}"? This frees slot #${sponsorship.slotNumber} immediately and cannot be undone.`)) return;
    setCancellingSponsorshipId(sponsorship.id);
    try {
      await cancelSponsorshipRequest(sponsorship.id);
      await queryClient.invalidateQueries({ queryKey: getGetAdminSponsorshipsQueryKey() });
      toast({ title: "Sponsorship cancelled", description: `Slot #${sponsorship.slotNumber} is now free.` });
    } catch (cancelError) {
      toast({
        variant: "destructive",
        title: "Could not cancel sponsorship",
        description: cancelError instanceof Error ? cancelError.message : "Try again.",
      });
    } finally {
      setCancellingSponsorshipId(null);
    }
  }

  function selectPolicy(policy: AdminPolicy) {
    setSelectedPolicyType(policy.policyType);
    setPolicyDraft({ title: policy.title, content: policy.content });
  }

  async function savePolicy(status: "draft" | "published") {
    if (!selectedPolicyType || !policyDraft || savingPolicy) return;
    setSavingPolicy(true);
    try {
      await updateAdminPolicy(selectedPolicyType, {
        title: policyDraft.title,
        content: policyDraft.content,
        status,
      });
      await queryClient.invalidateQueries({ queryKey: getGetAdminPoliciesQueryKey() });
      await queryClient.invalidateQueries({ queryKey: getGetSiteSettingsQueryKey() });
      toast({
        title: status === "published" ? "Policy published" : "Draft saved",
        description: `${POLICY_LABELS[selectedPolicyType] ?? selectedPolicyType} is now ${status}.`,
      });
    } catch (saveError) {
      toast({
        variant: "destructive",
        title: "Policy not saved",
        description: saveError instanceof Error ? saveError.message : "Try again.",
      });
    } finally {
      setSavingPolicy(false);
    }
  }

  async function saveSiteSettings() {
    if (!siteSettingsDraft || savingSiteSettings) return;
    setSavingSiteSettings(true);
    try {
      const trimmedTaxRate = siteSettingsDraft.taxRatePercent?.trim();
      const taxRatePercent = trimmedTaxRate ? Number(trimmedTaxRate) : null;
      if (trimmedTaxRate && !Number.isFinite(taxRatePercent)) {
        toast({ variant: "destructive", title: "Business details not saved", description: "Tax rate must be a number." });
        return;
      }
      const trimmedSponsorshipPrice = siteSettingsDraft.sponsorshipPriceCents?.trim();
      const sponsorshipPriceCents = trimmedSponsorshipPrice ? Math.round(Number(trimmedSponsorshipPrice) * 100) : null;
      const trimmedSponsorshipDuration = siteSettingsDraft.sponsorshipDurationDays?.trim();
      const sponsorshipDurationDays = trimmedSponsorshipDuration ? Number(trimmedSponsorshipDuration) : null;
      if (trimmedSponsorshipPrice && !Number.isFinite(sponsorshipPriceCents)) {
        toast({ variant: "destructive", title: "Settings not saved", description: "Sponsorship price must be a number." });
        return;
      }
      if (trimmedSponsorshipDuration && !Number.isFinite(sponsorshipDurationDays)) {
        toast({ variant: "destructive", title: "Settings not saved", description: "Sponsorship duration must be a number." });
        return;
      }
      await updateAdminSiteSettings({
        businessName: siteSettingsDraft.businessName?.trim() || null,
        businessAddress: siteSettingsDraft.businessAddress?.trim() || null,
        supportEmail: siteSettingsDraft.supportEmail?.trim() || null,
        grievanceOfficerName: siteSettingsDraft.grievanceOfficerName?.trim() || null,
        grievanceOfficerEmail: siteSettingsDraft.grievanceOfficerEmail?.trim() || null,
        invoiceAdminEmail: siteSettingsDraft.invoiceAdminEmail?.trim() || null,
        taxRatePercent,
        taxRegistrationNumber: siteSettingsDraft.taxRegistrationNumber?.trim() || null,
        taxLabel: siteSettingsDraft.taxLabel?.trim() || null,
        sponsorshipPriceCents,
        sponsorshipDurationDays,
      });
      await queryClient.invalidateQueries({ queryKey: getGetSiteSettingsQueryKey() });
      await queryClient.invalidateQueries({ queryKey: ["sponsorship-availability"] });
      setSiteSettingsDraft(null);
      toast({ title: "Settings updated", description: "Published policy pages and the Featured Sponsors product reflect these values immediately." });
    } catch (saveError) {
      toast({
        variant: "destructive",
        title: "Settings not saved",
        description: saveError instanceof Error ? saveError.message : "Try again.",
      });
    } finally {
      setSavingSiteSettings(false);
    }
  }

  async function setListingModeration(id: string, name: string, moderationStatus: ListingModerationInputModerationStatus) {
    if (!confirmAction(`Set ${name}'s moderation status to "${moderationStatus.replaceAll("_", " ")}"?`)) return;
    await runAction(
      `${name} moderation status is now ${moderationStatus.replaceAll("_", " ")}.`,
      () => moderateListing(id, { moderationStatus }),
    );
  }

  if (isLoading) {
    return (
      <div className="container mx-auto flex min-h-[50vh] max-w-7xl flex-col items-center justify-center px-4 py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary/60 mb-4" />
        <h2 className="text-lg font-bold text-foreground">Loading workspace</h2>
        <p className="text-sm text-muted-foreground mt-2">Syncing moderator console...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="container mx-auto flex min-h-[50vh] max-w-7xl flex-col items-center justify-center px-4 py-16">
        <div className="flex max-w-md flex-col items-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10 text-destructive ring-1 ring-destructive/20">
            <ShieldCheck className="h-8 w-8" />
          </div>
          <h1 className="mb-2 text-2xl font-bold text-foreground">Access unavailable</h1>
          <p className="mb-6 text-sm text-muted-foreground">
            This workspace requires an active moderator role. If you just signed in, 
            refresh after the local sandbox data has initialized.
          </p>
          <Button 
            onClick={() => refetch()}
            className="h-10 rounded-md bg-primary px-6 text-xs font-bold uppercase tracking-wider text-primary-foreground hover:bg-primary/90"
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const stats = [
    { label: "Users", value: data.stats.users, icon: Users },
    { label: "Listings", value: data.stats.listings, icon: Landmark },
    { label: "Transactions", value: data.stats.transactions, icon: Activity },
    { label: "Reports to triage", value: data.stats.openReports, icon: FileWarning },
    { label: "Feedback to triage", value: data.stats.openFeedback, icon: MessageCircleWarning },
    { label: "Suspended accounts", value: data.stats.suspendedAccounts, icon: Ban },
    { label: "Frozen listings", value: data.stats.suspendedListings, icon: ShieldCheck },
  ];

  return (
    <div className="container mx-auto max-w-7xl px-4 py-10 md:py-14">
      <div className="mb-10 flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <div className="mb-3 flex items-center gap-2 text-primary">
            <ShieldCheck className="h-5 w-5" />
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-primary">
              Moderator console
            </span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight md:text-5xl text-foreground">
            Keep the ledger <span className="text-primary">credible.</span>
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
            Review community signals, stop abuse, and leave a permanent record
            of every intervention.
          </p>
        </div>
        <Button 
          variant="outline" 
          onClick={() => refetch()} 
          disabled={isFetching}
          className="shrink-0 h-10 rounded-md border-border/60 bg-card/60 text-xs font-bold uppercase tracking-wider hover:bg-muted"
        >
          <RefreshCw className={cn("mr-2 h-3.5 w-3.5", isFetching && "animate-spin")} />
          Refresh live data
        </Button>
      </div>

      <div className="mb-10 grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {stats.map(({ label, value, icon: Icon }) => (
          <div key={label} className="flex flex-col justify-between rounded-xl border border-border/60 bg-card p-5 shadow-sm transition-shadow hover:shadow-md">
            <Icon className="mb-6 h-5 w-5 text-primary/60" />
            <div>
              <div className="font-mono text-2xl font-bold text-foreground">{value}</div>
              <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {label}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mb-8 flex gap-2 overflow-x-auto border-b border-border/40 pb-3">
        {tabs.map((tab) => (
          <Button
            key={tab.id}
            size="sm"
            variant="ghost"
            className={cn(
              "rounded-full px-4 text-xs font-bold uppercase tracking-wider transition-colors shrink-0",
              activeTab === tab.id 
                ? "bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary" 
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {activeTab === "users" && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
          {data.actorRole === "admin" && (
            <section className="mb-8 rounded-xl border border-border/60 bg-card p-6 shadow-sm">
              <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
                <div>
                  <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-primary">
                    Moderator access
                  </div>
                  <h2 className="mt-1 text-lg font-bold">Manage verified members</h2>
                  <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                    Only Clerk-linked members appear here. Role changes are recorded in the audit log.
                  </p>
                </div>
                <div className="relative w-full md:max-w-sm">
                  <Input
                    aria-label="Search verified members"
                    placeholder="Search name, email, or Clerk ID"
                    value={memberSearch}
                    onChange={(event) => setMemberSearch(event.target.value)}
                    className="h-10 rounded-md border-border/60 bg-background pl-4 pr-10 text-sm focus-visible:ring-primary/30"
                  />
                  {isSearchingMembers && (
                    <Loader2 className="absolute right-3 top-3 h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                </div>
              </div>
              <div className="overflow-hidden rounded-lg border border-border/60 bg-background">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="border-b border-border/60 bg-muted/30 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="p-4">Member</th>
                        <th className="p-4">Role</th>
                        <th className="p-4 text-right">Control</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {searchedMembers.map((user) => (
                        <tr key={user.id} className="transition-colors hover:bg-muted/20">
                          <td className="p-4">
                            <div className="font-bold text-foreground">{user.displayName}</div>
                            <div className="text-xs font-mono text-muted-foreground">{user.email}</div>
                          </td>
                          <td className="p-4"><StatusBadge value={user.role} /></td>
                          <td className="p-4 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              className={cn(
                                "h-8 rounded text-[10px] font-bold uppercase tracking-wider", 
                                user.role === "moderator" 
                                  ? "border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground" 
                                  : "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary"
                              )}
                              onClick={() => {
                                const nextRole = user.role === "moderator" ? "member" : "moderator";
                                const action = nextRole === "moderator" ? "Grant" : "Revoke";
                                if (confirmAction(`${action} moderator access for ${user.displayName}?`)) {
                                  void runAction(
                                    `${user.displayName} is now a ${nextRole}.`,
                                    () => updateAdminUserRole(user.id, { role: nextRole }),
                                  );
                                }
                              }}
                            >
                              {user.role === "moderator" ? "Revoke access" : "Grant moderator"}
                            </Button>
                          </td>
                        </tr>
                      ))}
                      {!isSearchingMembers && !searchedMembers.length && (
                        <tr>
                          <td className="p-8 text-center text-sm text-muted-foreground" colSpan={3}>
                            No verified members match this search.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}
          <TableShell>
            <thead className="border-b border-border/60 bg-muted/30 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="p-4">Member</th>
                <th className="p-4">Role</th>
                <th className="p-4">Status</th>
                <th className="p-4">Joined</th>
                <th className="p-4 text-right">Control</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {data.users.map((user) => (
                <tr key={user.id} className="transition-colors hover:bg-muted/20">
                  <td className="p-4">
                    <div className="font-bold text-foreground">{user.displayName}</div>
                    <div className="text-xs font-mono text-muted-foreground">{user.email}</div>
                  </td>
                  <td className="p-4"><StatusBadge value={user.role} /></td>
                  <td className="p-4"><StatusBadge value={user.status} /></td>
                  <td className="p-4 text-xs text-muted-foreground">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                  <td className="p-4 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={user.id === "usr_moderator_ava"}
                      className={cn(
                        "h-8 rounded text-[10px] font-bold uppercase tracking-wider",
                        user.status === "active" 
                          ? "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive" 
                          : "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary"
                      )}
                      onClick={() => {
                        const next = user.status === "active" ? "suspended" : "active";
                        if (confirmAction(`${next === "suspended" ? "Suspend" : "Reactivate"} ${user.displayName}?`)) {
                          void runAction(
                            `${user.displayName} is now ${next}.`,
                            () => updateAdminUserStatus(user.id, { status: next }),
                          );
                        }
                      }}
                    >
                      {user.status === "active" ? "Suspend" : "Reactivate"}
                    </Button>
                  </td>
                </tr>
              ))}
              {!data.users.length && (
                <tr>
                  <td className="p-8 text-center text-sm text-muted-foreground" colSpan={5}>
                    No members found.
                  </td>
                </tr>
              )}
            </tbody>
          </TableShell>
        </div>
      )}

      {activeTab === "listings" && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
          <TableShell>
            <thead className="border-b border-border/60 bg-muted/30 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="p-4">Listing</th>
                <th className="p-4">Rank</th>
                <th className="p-4">Ranking power</th>
                <th className="p-4">Demo</th>
                <th className="p-4">Demo views</th>
                <th className="p-4">Status</th>
                <th className="p-4">Moderation</th>
                <th className="p-4 text-right">Control</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {data.listings.map((listing) => {
                const status = listing.status ?? "active";
                const moderationStatus = listing.moderationStatus ?? "active";
                return (
                  <tr key={listing.id} className="transition-colors hover:bg-muted/20">
                    <td className="p-4">
                      <div className="font-bold text-foreground">{listing.name}</div>
                      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{listing.category}</div>
                    </td>
                    <td className="p-4 font-mono font-bold text-foreground">#{listing.rank}</td>
                    <td className="p-4 font-mono">{formatCurrency(listing.effectiveBid)}</td>
                    <td className="p-4">
                      {listing.demoVideoUrl ? (
                        <a
                          href={listing.demoVideoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] font-bold uppercase tracking-wider text-primary hover:underline"
                          data-testid={`link-admin-demo-${listing.id}`}
                        >
                          View link
                        </a>
                      ) : (
                        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-4 font-mono">{listing.demoVideoUrl ? formatNumber(listing.demoViewCount ?? 0) : "—"}</td>
                    <td className="p-4"><StatusBadge value={status} /></td>
                    <td className="p-4">
                      <select
                        value={moderationStatus}
                        onChange={(event) =>
                          void setListingModeration(
                            listing.id,
                            listing.name,
                            event.target.value as ListingModerationInputModerationStatus,
                          )
                        }
                        className="h-8 rounded-md border border-border/60 bg-background px-2 text-[10px] font-bold uppercase tracking-wider text-foreground"
                        data-testid={`select-moderation-${listing.id}`}
                      >
                        {MODERATION_STATUS_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option.replaceAll("_", " ")}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-4 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className={cn(
                          "h-8 rounded text-[10px] font-bold uppercase tracking-wider",
                          status === "active" 
                            ? "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive" 
                            : "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary"
                        )}
                        onClick={() => {
                          const next = status === "active" ? "suspended" : "active";
                          if (confirmAction(`${next === "suspended" ? "Freeze" : "Reactivate"} ${listing.name}?`)) {
                            void runAction(
                              `${listing.name} is now ${next}.`,
                              () => updateAdminListingStatus(listing.id, { status: next }),
                            );
                          }
                        }}
                      >
                        {status === "active" ? "Freeze" : "Reactivate"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {!data.listings.length && (
                <tr>
                  <td className="p-8 text-center text-sm text-muted-foreground" colSpan={8}>
                    No listings found.
                  </td>
                </tr>
              )}
            </tbody>
          </TableShell>
        </div>
      )}

      {activeTab === "campaign" && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
          <section className="max-w-xl rounded-xl border border-border/60 bg-card p-6 shadow-sm">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
               <Landmark className="h-5 w-5" />
            </div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-primary">Weekly claim settings</p>
            <h2 className="mt-1 text-2xl font-bold text-foreground">Campaign #{campaign?.number ?? "…"}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Sunday-to-Sunday campaign boundaries are server-controlled. Update the current minimum before accepting more qualifying claims.
            </p>
            <div className="mt-6 flex flex-col gap-4 border-t border-border/40 pt-6 sm:flex-row sm:items-end">
              <label className="block flex-1 space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Minimum claim (USD)</span>
                <Input
                  type="number"
                  min={1}
                  value={campaignMinimum ?? campaign?.minimumBid ?? 5}
                  onChange={(event) => setCampaignMinimum(Math.max(1, Number(event.target.value) || 1))}
                  className="h-10 max-w-[200px] rounded-md border-border/60 bg-background font-mono text-base font-bold focus-visible:ring-primary/30"
                />
              </label>
              <Button 
                className="h-10 shrink-0 rounded-md bg-primary px-6 text-xs font-bold uppercase tracking-wider text-primary-foreground hover:bg-primary/90" 
                onClick={() => void saveCampaignMinimum()} 
                disabled={data.actorRole !== "admin"}
              >
                Save minimum
              </Button>
            </div>
            {data.actorRole !== "admin" && (
              <p className="mt-4 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                Only administrators can change campaign settings.
              </p>
            )}
          </section>
        </div>
      )}

      {activeTab === "sponsorships" && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-6">
          <section className="max-w-xl rounded-xl border border-violet-500/30 bg-card p-6 shadow-sm">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 ring-1 ring-violet-500/20 dark:text-violet-300">
              <Star className="h-5 w-5 fill-current" />
            </div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-violet-600 dark:text-violet-300">Featured / Sponsored settings</p>
            <h2 className="mt-1 text-2xl font-bold text-foreground">4 rotating slots</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              A fully separate product from the weekly campaign — this price and duration apply to every new purchase and never affect ranking.
            </p>
            <div className="mt-6 grid gap-4 border-t border-border/40 pt-6 sm:grid-cols-2">
              <label className="block space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Price (USD)</span>
                <Input
                  type="number"
                  min={1}
                  step={0.01}
                  value={
                    siteSettingsDraft?.sponsorshipPriceCents ??
                    (siteSettings?.sponsorshipPriceCents != null
                      ? (siteSettings.sponsorshipPriceCents / 100).toString()
                      : sponsorshipAvailability?.price != null
                        ? sponsorshipAvailability.price.toString()
                        : "")
                  }
                  onChange={(event) =>
                    setSiteSettingsDraft((draft) => ({
                      ...baseSiteSettingsDraft(draft, siteSettings),
                      sponsorshipPriceCents: event.target.value,
                    }))
                  }
                  className="h-10 rounded-md border-border/60 bg-background font-mono text-sm"
                  data-testid="input-site-setting-sponsorshipPriceCents"
                />
              </label>
              <label className="block space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Duration (days)</span>
                <Input
                  type="number"
                  min={1}
                  max={90}
                  value={
                    siteSettingsDraft?.sponsorshipDurationDays ??
                    (siteSettings?.sponsorshipDurationDays ?? sponsorshipAvailability?.durationDays ?? "").toString()
                  }
                  onChange={(event) =>
                    setSiteSettingsDraft((draft) => ({
                      ...baseSiteSettingsDraft(draft, siteSettings),
                      sponsorshipDurationDays: event.target.value,
                    }))
                  }
                  className="h-10 rounded-md border-border/60 bg-background font-mono text-sm"
                  data-testid="input-site-setting-sponsorshipDurationDays"
                />
              </label>
            </div>
            <Button
              onClick={() => void saveSiteSettings()}
              disabled={savingSiteSettings || !siteSettingsDraft}
              className="mt-5 h-10 rounded-md bg-violet-600 px-6 text-xs font-bold uppercase tracking-wider text-white hover:bg-violet-600/90"
              data-testid="button-save-sponsorship-settings"
            >
              {savingSiteSettings ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
              Save sponsorship settings
            </Button>
          </section>

          <TableShell>
            <thead className="border-b border-border/60 bg-muted/30 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="p-4">Slot</th>
                <th className="p-4">Business</th>
                <th className="p-4">Status</th>
                <th className="p-4">Dates</th>
                <th className="p-4">Analytics</th>
                <th className="p-4">Revenue</th>
                <th className="p-4">Invoice</th>
                <th className="p-4 text-right">Control</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {isLoadingSponsorships && (
                <tr>
                  <td className="flex items-center gap-2 p-4 text-xs text-muted-foreground" colSpan={8}>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading sponsorships…
                  </td>
                </tr>
              )}
              {sponsorships?.map((sponsorship) => (
                <tr key={sponsorship.id} className="transition-colors hover:bg-muted/20" data-testid={`row-sponsorship-${sponsorship.id}`}>
                  <td className="p-4 font-mono text-sm font-bold text-foreground">#{sponsorship.slotNumber}</td>
                  <td className="p-4">
                    <p className="font-bold text-foreground">{sponsorship.listing.name}</p>
                    <p className="font-mono text-[10px] text-muted-foreground">{sponsorship.ownerName ?? sponsorship.ownerId}</p>
                  </td>
                  <td className="p-4"><StatusBadge value={sponsorship.status} /></td>
                  <td className="p-4 text-xs text-muted-foreground">
                    {sponsorship.startAt ? <p>Start: {new Date(sponsorship.startAt).toLocaleDateString()}</p> : <p>Not started</p>}
                    {sponsorship.expiresAt && <p>Expires: {new Date(sponsorship.expiresAt).toLocaleDateString()}</p>}
                    {sponsorship.cancelledAt && <p className="text-destructive">Cancelled: {new Date(sponsorship.cancelledAt).toLocaleDateString()}</p>}
                  </td>
                  <td className="p-4 font-mono text-[11px] text-muted-foreground">
                    <p>{formatNumber(sponsorship.analytics.popupImpressions)} popup · {formatNumber(sponsorship.analytics.sectionImpressions)} section</p>
                    <p>{formatNumber(sponsorship.analytics.clicks)} clicks · {(sponsorship.analytics.ctr * 100).toFixed(1)}% CTR</p>
                  </td>
                  <td className="p-4 font-mono font-bold text-foreground">{formatCurrency(sponsorship.revenue)}</td>
                  <td className="p-4">
                    {sponsorship.invoiceId ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          const blob = await downloadAdminInvoicePdf(sponsorship.invoiceId as string);
                          const url = URL.createObjectURL(blob);
                          const link = document.createElement("a");
                          link.href = url;
                          link.download = `sponsorship-${sponsorship.id}.pdf`;
                          document.body.appendChild(link);
                          link.click();
                          link.remove();
                          URL.revokeObjectURL(url);
                        }}
                        className="h-7 rounded border-border/60 px-2 text-[10px] font-bold uppercase tracking-wider"
                        data-testid={`button-download-sponsorship-invoice-${sponsorship.id}`}
                      >
                        <Download className="h-3 w-3" />
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="p-4 text-right">
                    {(sponsorship.status === "active" || sponsorship.status === "pending") && (
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={cancellingSponsorshipId === sponsorship.id}
                        onClick={() => void cancelSponsorshipAction(sponsorship)}
                        className="h-7 rounded px-2 text-[10px] font-bold uppercase tracking-wider"
                        data-testid={`button-cancel-sponsorship-${sponsorship.id}`}
                      >
                        {cancellingSponsorshipId === sponsorship.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Cancel"}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {!isLoadingSponsorships && !sponsorships?.length && (
                <tr>
                  <td className="p-8 text-center text-sm text-muted-foreground" colSpan={8}>
                    No Featured Sponsors slot has ever been purchased.
                  </td>
                </tr>
              )}
            </tbody>
          </TableShell>
        </div>
      )}

      {activeTab === "policies" && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 grid gap-6 lg:grid-cols-[280px_1fr]">
          <div className="space-y-4">
            <section className="rounded-xl border border-border/60 bg-card shadow-sm">
              <div className="border-b border-border/40 p-4">
                <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
                  <ScrollText className="h-4 w-4" />
                </div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-primary">Legal & policy documents</p>
                <p className="mt-1 text-xs text-muted-foreground">Edits publish immediately to the public policy pages — no deploy required.</p>
              </div>
              <ul className="divide-y divide-border/40">
                {isLoadingPolicies && (
                  <li className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading policies…
                  </li>
                )}
                {policies?.map((policy) => (
                  <li key={policy.policyType}>
                    <button
                      type="button"
                      onClick={() => selectPolicy(policy)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 p-4 text-left text-xs transition-colors hover:bg-muted/30",
                        selectedPolicyType === policy.policyType && "bg-primary/[0.06]",
                      )}
                      data-testid={`button-select-policy-${policy.policyType}`}
                    >
                      <span className="font-bold text-foreground">{POLICY_LABELS[policy.policyType] ?? policy.title}</span>
                      <StatusBadge value={policy.status} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <div className="space-y-6">
            {policyDraft && selectedPolicyType ? (
              <section className="rounded-xl border border-border/60 bg-card p-6 shadow-sm" data-testid="panel-policy-editor">
                <h2 className="text-lg font-bold text-foreground">{POLICY_LABELS[selectedPolicyType] ?? selectedPolicyType}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Content uses light markdown (# headings, **bold**, [links](/path), - lists) and {"{{TOKEN}}"} placeholders resolved from Business details below.
                </p>
                <label className="mt-4 block space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Title</span>
                  <Input
                    value={policyDraft.title}
                    onChange={(event) => setPolicyDraft((draft) => (draft ? { ...draft, title: event.target.value } : draft))}
                    className="h-10 rounded-md border-border/60 bg-background"
                    data-testid="input-policy-title"
                  />
                </label>
                <label className="mt-4 block space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Content</span>
                  <Textarea
                    value={policyDraft.content}
                    onChange={(event) => setPolicyDraft((draft) => (draft ? { ...draft, content: event.target.value } : draft))}
                    rows={18}
                    className="rounded-md border-border/60 bg-background font-mono text-xs leading-relaxed"
                    data-testid="textarea-policy-content"
                  />
                </label>
                <div className="mt-5 flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    onClick={() => void savePolicy("draft")}
                    disabled={savingPolicy}
                    className="h-10 rounded-md text-xs font-bold uppercase tracking-wider"
                    data-testid="button-save-policy-draft"
                  >
                    {savingPolicy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                    Save draft
                  </Button>
                  <Button
                    onClick={() => void savePolicy("published")}
                    disabled={savingPolicy}
                    className="h-10 rounded-md bg-primary text-xs font-bold uppercase tracking-wider text-primary-foreground hover:bg-primary/90"
                    data-testid="button-publish-policy"
                  >
                    {savingPolicy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                    Publish
                  </Button>
                </div>
              </section>
            ) : (
              <section className="flex min-h-[200px] items-center justify-center rounded-xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
                Select a policy on the left to edit its content.
              </section>
            )}

            <section className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-wider text-primary">Business details</p>
              <h2 className="mt-1 text-lg font-bold text-foreground">Used to fill {"{{TOKEN}}"} placeholders</h2>
              <p className="mt-2 text-xs text-muted-foreground">
                Until these are filled in, policy pages show "not yet provided" instead of guessing a legal fact.
              </p>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {([
                  { key: "businessName", label: "Business name" },
                  { key: "businessAddress", label: "Business address" },
                  { key: "supportEmail", label: "Support email" },
                  { key: "grievanceOfficerName", label: "Grievance officer name" },
                  { key: "grievanceOfficerEmail", label: "Grievance officer email" },
                ] as const).map((field) => (
                  <label key={field.key} className="block space-y-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{field.label}</span>
                    <Input
                      value={siteSettingsDraft?.[field.key] ?? siteSettings?.[field.key] ?? ""}
                      onChange={(event) =>
                        setSiteSettingsDraft((draft) => ({
                          ...baseSiteSettingsDraft(draft, siteSettings),
                          [field.key]: event.target.value,
                        }))
                      }
                      className="h-10 rounded-md border-border/60 bg-background text-sm"
                      data-testid={`input-site-setting-${field.key}`}
                    />
                  </label>
                ))}
              </div>
              <div className="mt-5 border-t border-border/40 pt-5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-primary">Invoice notifications</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Every generated invoice is emailed here in addition to the payer. Leave blank to skip admin copies.
                </p>
                <label className="mt-3 block max-w-sm space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Invoice notification email</span>
                  <Input
                    value={siteSettingsDraft?.invoiceAdminEmail ?? siteSettings?.invoiceAdminEmail ?? ""}
                    onChange={(event) =>
                      setSiteSettingsDraft((draft) => ({
                        ...baseSiteSettingsDraft(draft, siteSettings),
                        invoiceAdminEmail: event.target.value,
                      }))
                    }
                    className="h-10 rounded-md border-border/60 bg-background text-sm"
                    data-testid="input-site-setting-invoiceAdminEmail"
                  />
                </label>
              </div>
              <div className="mt-5 border-t border-border/40 pt-5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-primary">Tax / VAT</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Leave the rate blank for regions where no tax applies. Once set, every newly issued invoice shows a{" "}
                  {siteSettingsDraft?.taxLabel ?? siteSettings?.taxLabel ?? "tax"} line and registration number; invoices issued
                  before this was configured are never changed.
                </p>
                <div className="mt-3 grid gap-4 sm:grid-cols-3">
                  <label className="block space-y-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tax rate (%)</span>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step={0.01}
                      value={siteSettingsDraft?.taxRatePercent ?? (siteSettings?.taxRatePercent ?? "").toString()}
                      onChange={(event) =>
                        setSiteSettingsDraft((draft) => ({
                          ...baseSiteSettingsDraft(draft, siteSettings),
                          taxRatePercent: event.target.value,
                        }))
                      }
                      className="h-10 rounded-md border-border/60 bg-background text-sm"
                      data-testid="input-site-setting-taxRatePercent"
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tax label</span>
                    <Input
                      placeholder="VAT, GST, Tax..."
                      value={siteSettingsDraft?.taxLabel ?? siteSettings?.taxLabel ?? ""}
                      onChange={(event) =>
                        setSiteSettingsDraft((draft) => ({
                          ...baseSiteSettingsDraft(draft, siteSettings),
                          taxLabel: event.target.value,
                        }))
                      }
                      className="h-10 rounded-md border-border/60 bg-background text-sm"
                      data-testid="input-site-setting-taxLabel"
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tax registration number</span>
                    <Input
                      value={siteSettingsDraft?.taxRegistrationNumber ?? siteSettings?.taxRegistrationNumber ?? ""}
                      onChange={(event) =>
                        setSiteSettingsDraft((draft) => ({
                          ...baseSiteSettingsDraft(draft, siteSettings),
                          taxRegistrationNumber: event.target.value,
                        }))
                      }
                      className="h-10 rounded-md border-border/60 bg-background text-sm"
                      data-testid="input-site-setting-taxRegistrationNumber"
                    />
                  </label>
                </div>
              </div>
              <Button
                onClick={() => void saveSiteSettings()}
                disabled={savingSiteSettings || !siteSettingsDraft}
                className="mt-5 h-10 rounded-md bg-primary px-6 text-xs font-bold uppercase tracking-wider text-primary-foreground hover:bg-primary/90"
                data-testid="button-save-site-settings"
              >
                {savingSiteSettings ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                Save business details
              </Button>
            </section>
          </div>
        </div>
      )}

      {activeTab === "transactions" && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
          <TableShell>
            <thead className="border-b border-border/60 bg-muted/30 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="p-4">Transaction</th>
                <th className="p-4">Listing</th>
                <th className="p-4">Type</th>
                <th className="p-4">Amount</th>
                <th className="p-4">Provider</th>
                <th className="p-4">When</th>
                <th className="p-4">Invoice</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {data.transactions.map((transaction) => (
                <tr key={transaction.id} className="transition-colors hover:bg-muted/20">
                  <td className="p-4 font-mono text-[10px] text-muted-foreground">{transaction.id}</td>
                  <td className="p-4 font-bold text-foreground">{transaction.listingName}</td>
                  <td className="p-4"><StatusBadge value={transaction.type} /></td>
                  <td className="p-4 font-mono font-bold text-foreground">{formatCurrency(transaction.amount)}</td>
                  <td className="p-4 text-xs">{transaction.provider}</td>
                  <td className="p-4 text-xs text-muted-foreground">
                    {new Date(transaction.createdAt).toLocaleString()}
                  </td>
                  <td className="p-4">
                    {transaction.invoiceId ? (
                      <InvoiceCell invoiceId={transaction.invoiceId} invoiceNumber={transaction.invoiceNumber} invoiceStatus={transaction.invoiceStatus} />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {!data.transactions.length && (
                <tr>
                  <td className="p-8 text-center text-sm text-muted-foreground" colSpan={7}>
                    No transactions found.
                  </td>
                </tr>
              )}
            </tbody>
          </TableShell>
        </div>
      )}

      {activeTab === "reviews" && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
          <TableShell>
            <thead className="border-b border-border/60 bg-muted/30 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="p-4">Review</th>
                <th className="p-4">Signal</th>
                <th className="p-4">Status</th>
                <th className="p-4">Reason</th>
                <th className="p-4 text-right">Control</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {data.reviews.map((review) => {
                const status = review.status ?? "published";
                return (
                  <tr key={review.id} className="transition-colors hover:bg-muted/20">
                    <td className="max-w-sm p-4">
                      <div className="font-bold text-foreground">{review.author} · <span className="font-mono text-muted-foreground">{review.rating}/5</span></div>
                      <div className="mt-1 text-xs text-muted-foreground">{review.body}</div>
                    </td>
                    <td className="p-4"><StatusBadge value={review.kind} /></td>
                    <td className="p-4"><StatusBadge value={status} /></td>
                    <td className="p-4 text-xs text-muted-foreground">
                      {review.moderationReason || review.reason}
                    </td>
                    <td className="p-4 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className={cn(
                          "h-8 rounded text-[10px] font-bold uppercase tracking-wider",
                          status === "hidden" 
                            ? "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary" 
                            : "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive"
                        )}
                        onClick={() => {
                          const next = status === "hidden" ? "published" : "hidden";
                          if (confirmAction(`${next === "hidden" ? "Hide" : "Publish"} this review?`)) {
                            void runAction(
                              `Review is now ${next}.`,
                              () => moderateReview(review.id, { status: next }),
                            );
                          }
                        }}
                      >
                        {status === "hidden" ? "Publish" : <><EyeOff className="mr-1.5 h-3.5 w-3.5" />Hide</>}
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {!data.reviews.length && (
                <tr>
                  <td className="p-8 text-center text-sm text-muted-foreground" colSpan={5}>
                    No reviews found.
                  </td>
                </tr>
              )}
            </tbody>
          </TableShell>
        </div>
      )}

      {activeTab === "reports" && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
          <TableShell>
            <thead className="border-b border-border/60 bg-muted/30 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="p-4">Reported content</th>
                <th className="p-4">Concern</th>
                <th className="p-4">Status</th>
                <th className="p-4">Submitted</th>
                <th className="p-4 text-right">Triage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {data.reports.map((report) => (
                <tr key={report.id} className="transition-colors hover:bg-muted/20">
                  <td className="p-4">
                    <div className="font-bold text-foreground capitalize">{report.targetType}</div>
                    <div className="text-[10px] font-mono text-muted-foreground">{report.targetId}</div>
                  </td>
                  <td className="max-w-sm p-4">
                    <div className="font-bold text-foreground">{report.reason}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{report.details}</div>
                  </td>
                  <td className="p-4"><StatusBadge value={report.status} /></td>
                  <td className="p-4 text-xs text-muted-foreground">
                    {new Date(report.createdAt).toLocaleDateString()}
                  </td>
                  <td className="p-4 text-right">
                    {["resolved", "dismissed"].includes(report.status) ? (
                      <CheckCircle2 className="ml-auto h-5 w-5 text-primary/60" />
                    ) : (
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 rounded border-primary/30 bg-primary/10 text-[10px] font-bold uppercase tracking-wider text-primary hover:bg-primary/20 hover:text-primary"
                          onClick={() => void runAction(
                            "Report marked resolved.",
                            () => resolveReport(report.id, { status: "resolved" }),
                          )}
                        >
                          Resolve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 rounded border-border/60 text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:bg-muted hover:text-foreground"
                          onClick={() => void runAction(
                            "Report dismissed.",
                            () => resolveReport(report.id, { status: "dismissed" }),
                          )}
                        >
                          Dismiss
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {!data.reports.length && (
                <tr>
                  <td className="p-8 text-center text-sm text-muted-foreground" colSpan={5}>
                    No reports found.
                  </td>
                </tr>
              )}
            </tbody>
          </TableShell>
        </div>
      )}

      {activeTab === "feedback" && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
          <TableShell>
            <thead className="border-b border-border/60 bg-muted/30 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="p-4">Category</th>
                <th className="p-4">Message</th>
                <th className="p-4">Contact</th>
                <th className="p-4">Status</th>
                <th className="p-4">Submitted</th>
                <th className="p-4 text-right">Triage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {data.feedback.map((item) => (
                <tr key={item.id} className="transition-colors hover:bg-muted/20">
                  <td className="p-4">
                    <div className="font-bold text-foreground capitalize">{item.category.replaceAll("_", " ")}</div>
                    {item.path && <div className="text-[10px] font-mono text-muted-foreground">{item.path}</div>}
                  </td>
                  <td className="max-w-sm whitespace-pre-wrap p-4 text-sm text-foreground">{item.message}</td>
                  <td className="p-4 text-xs font-mono text-muted-foreground">{item.contactEmail ?? "—"}</td>
                  <td className="p-4"><StatusBadge value={item.status} /></td>
                  <td className="p-4 text-xs text-muted-foreground">
                    {new Date(item.createdAt).toLocaleDateString()}
                  </td>
                  <td className="p-4 text-right">
                    {["resolved", "dismissed"].includes(item.status) ? (
                      <CheckCircle2 className="ml-auto h-5 w-5 text-primary/60" />
                    ) : (
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 rounded border-primary/30 bg-primary/10 text-[10px] font-bold uppercase tracking-wider text-primary hover:bg-primary/20 hover:text-primary"
                          onClick={() => void runAction(
                            "Feedback marked resolved.",
                            () => resolveFeedback(item.id, { status: "resolved" }),
                          )}
                        >
                          Resolve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 rounded border-border/60 text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:bg-muted hover:text-foreground"
                          onClick={() => void runAction(
                            "Feedback dismissed.",
                            () => resolveFeedback(item.id, { status: "dismissed" }),
                          )}
                        >
                          Dismiss
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {!data.feedback.length && (
                <tr>
                  <td className="p-8 text-center text-sm text-muted-foreground" colSpan={6}>
                    No feedback found.
                  </td>
                </tr>
              )}
            </tbody>
          </TableShell>
        </div>
      )}

      {activeTab === "limits" && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
          <TableShell>
            <thead className="border-b border-border/60 bg-muted/30 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="p-4">Protected action</th>
                <th className="p-4">Requests</th>
                <th className="p-4">Window (seconds)</th>
                <th className="p-4 text-right">Save</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {data.limits.map((limit) => {
                const draft = limitDrafts[limit.action] ?? limit;
                return (
                  <tr key={limit.action} className="transition-colors hover:bg-muted/20">
                    <td className="p-4"><div className="flex items-center gap-2 font-bold text-foreground"><Gauge className="h-4 w-4 text-primary" />{limit.action}</div></td>
                    <td className="p-4">
                      <Input 
                        className="h-9 w-24 rounded-md border-border/60 bg-background font-mono text-sm focus-visible:ring-primary/30" 
                        type="number" 
                        min={1} 
                        value={draft.maxRequests} 
                        onChange={(event) => setLimitDrafts((current) => ({ ...current, [limit.action]: { ...draft, maxRequests: Number(event.target.value) } }))} 
                      />
                    </td>
                    <td className="p-4">
                      <Input 
                        className="h-9 w-28 rounded-md border-border/60 bg-background font-mono text-sm focus-visible:ring-primary/30" 
                        type="number" 
                        min={1} 
                        value={draft.windowSeconds} 
                        onChange={(event) => setLimitDrafts((current) => ({ ...current, [limit.action]: { ...draft, windowSeconds: Number(event.target.value) } }))} 
                      />
                    </td>
                    <td className="p-4 text-right">
                      <Button 
                        size="sm"
                        variant="outline"
                        className="h-8 rounded border-primary/30 bg-primary/10 text-[10px] font-bold uppercase tracking-wider text-primary hover:bg-primary/20 hover:text-primary"
                        onClick={() => void runAction(
                          `${limit.action} limit updated.`,
                          () => updateRateLimit(limit.action, { maxRequests: draft.maxRequests, windowSeconds: draft.windowSeconds }),
                        )}
                      >
                        Save limit
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {!data.limits.length && (
                <tr>
                  <td className="p-8 text-center text-sm text-muted-foreground" colSpan={4}>
                    No limits found.
                  </td>
                </tr>
              )}
            </tbody>
          </TableShell>
        </div>
      )}

      {activeTab === "audit" && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
          <TableShell>
            <thead className="border-b border-border/60 bg-muted/30 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="p-4">When</th>
                <th className="p-4">Actor</th>
                <th className="p-4">Action</th>
                <th className="p-4">Target</th>
                <th className="p-4">Context</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {data.auditEvents.map((event) => (
                <tr key={event.id} className="transition-colors hover:bg-muted/20">
                  <td className="p-4 text-[10px] text-muted-foreground">
                    {new Date(event.createdAt).toLocaleString()}
                  </td>
                  <td className="p-4 font-bold text-foreground">{event.actorId}</td>
                  <td className="p-4"><StatusBadge value={event.action} /></td>
                  <td className="p-4 text-[10px] text-muted-foreground">{event.targetId}</td>
                  <td className="p-4 font-mono text-[10px] text-muted-foreground">
                    <pre className="max-w-xs overflow-x-auto whitespace-pre-wrap">{JSON.stringify(event.metadata)}</pre>
                  </td>
                </tr>
              ))}
              {!data.auditEvents.length && (
                <tr>
                  <td className="p-8 text-center text-sm text-muted-foreground" colSpan={5}>
                    No audit events found.
                  </td>
                </tr>
              )}
            </tbody>
          </TableShell>
        </div>
      )}
    </div>
  );
}
