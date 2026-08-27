import { useMemo, useRef, useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGetPublicManagedListingQueryKey,
  useGetPublicManagedListing,
} from "@workspace/api-client-react";
import { Activity, Archive, ArrowLeft, ExternalLink, Loader2, Save, Share2, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  archiveManagedListing,
  getCurrentCampaign,
  newIdempotencyKey,
  updateManagedListing,
  requestManagedListingLogoUploadUrl,
} from "@/lib/public-api";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { usePaymentEnvironment } from "@/hooks/use-payment-environment";
import { LogoUploadControl } from "@/components/logo-upload-control";

const categories = ["AI Agents & Infrastructure", "AI", "SaaS", "Productivity", "Developer Tools", "Marketing", "Finance", "E-commerce", "Education", "Health", "Climate", "Social", "Entertainment", "Other"];

export default function ListingEditPage() {
  const { token } = useParams<{ token: string }>();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, error } = useGetPublicManagedListing(token, {
    query: {
      enabled: Boolean(token),
      retry: false,
      queryKey: getGetPublicManagedListingQueryKey(token),
    },
  });
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null | undefined>(undefined);
  const bidKey = useRef(newIdempotencyKey());
  const [draft, setDraft] = useState<Record<string, string | number> | null>(null);
  const { isLive } = usePaymentEnvironment();
  const { data: campaign } = useQuery({
    queryKey: ["current-campaign"],
    queryFn: getCurrentCampaign,
    staleTime: 30_000,
  });

  const values = useMemo(() => draft ?? (data ? {
    name: data.listing.name,
    tagline: data.listing.tagline,
    description: data.listing.description,
    category: data.listing.category,
    websiteUrl: data.listing.websiteUrl ?? "",
    demoVideoUrl: data.listing.demoVideoUrl ?? "",
    ownerBid: data.listing.ownerBid,
  } : null), [data, draft]);

  if (isLoading) {
    return <div className="container mx-auto max-w-4xl px-4 py-16"><div className="h-96 animate-pulse rounded-xl border border-border/50 bg-card" /></div>;
  }
  if (error || !data || !values) {
    return (
      <div className="container mx-auto max-w-xl px-4 py-20 text-center">
        <h1 className="text-2xl font-bold">Management link unavailable</h1>
        <p className="mt-3 text-sm text-muted-foreground">This secure product link is expired, revoked, or no longer available.</p>
        <Button asChild className="mt-6"><Link href="/add-product">Add your product</Link></Button>
      </div>
    );
  }
  const managed = data;
  const formValues = values;
  const displayedLogoUrl = logoUrl === undefined ? managed.listing.logoUrl : logoUrl;
  const minimumOwnerBid = Math.max(managed.listing.ownerBid, campaign?.minimumBid ?? 5);

  function change(key: string, value: string | number) {
    setDraft((current) => ({ ...(current ?? formValues), [key]: value }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const ownerBidChanged = Number(formValues.ownerBid) > managed.listing.ownerBid;
      await updateManagedListing(token, {
        name: String(formValues.name),
        tagline: String(formValues.tagline),
        description: String(formValues.description),
        category: String(formValues.category),
        websiteUrl: String(formValues.websiteUrl),
        demoVideoUrl: String(formValues.demoVideoUrl).trim() || null,
        ownerBid: Number(formValues.ownerBid),
      }, ownerBidChanged ? bidKey.current : undefined);
      await queryClient.invalidateQueries({ queryKey: getGetPublicManagedListingQueryKey(token) });
      setDraft(null);
      bidKey.current = newIdempotencyKey();
       toast({ title: "Product updated", description: ownerBidChanged ? (isLive ? "Your increased claim is now reflected in the ranking." : "Your increased sandbox claim is now reflected in the ranking.") : "Your public product details are up to date." });
    } catch (saveError) {
      toast({ variant: "destructive", title: "Could not save product", description: saveError instanceof Error ? saveError.message : "Try again." });
      bidKey.current = newIdempotencyKey();
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!window.confirm("Archive this product? It will disappear from public rankings, while the transaction history stays preserved.")) return;
    setArchiving(true);
    try {
      await archiveManagedListing(token);
      toast({ title: "Product archived", description: "The secure management link is now revoked." });
      window.location.assign("/");
    } catch (archiveError) {
      toast({ variant: "destructive", title: "Could not archive product", description: archiveError instanceof Error ? archiveError.message : "Try again." });
    } finally {
      setArchiving(false);
    }
  }

  async function share() {
    const url = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}/listing/${managed.listing.slug}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: managed.listing.name, text: managed.listing.tagline, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast({ title: "Public link copied", description: "Share your product with the community." });
      }
    } catch {
      // A cancelled native share does not need a user-facing error.
    }
  }

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8 md:py-12">
      <Link href={`/listing/${data.listing.slug}`} className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-primary"><ArrowLeft className="h-3 w-3" /> View public product</Link>
      <div className="mt-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">Secure owner link</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Manage {data.listing.name}</h1>
          <p className="mt-2 text-sm text-muted-foreground">No account or password is needed for this product-only workspace.</p>
        </div>
        <Button onClick={share} variant="outline"><Share2 className="mr-2 h-4 w-4" /> Share product</Button>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_310px]">
        <form onSubmit={save} className="space-y-6">
          <Card className="space-y-5 border-border/60 bg-card p-5 shadow-sm md:p-7">
            <LogoUploadControl
              logoUrl={displayedLogoUrl}
              initials={managed.listing.initials}
              accent={managed.listing.accent}
              listingName={String(formValues.name)}
              requestUploadUrl={(file) => requestManagedListingLogoUploadUrl(token, {
                name: file.name,
                size: file.size,
                contentType: file.type as "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml",
              })}
              saveLogoUrl={async (nextLogoUrl) => {
                await updateManagedListing(token, { logoUrl: nextLogoUrl });
                await queryClient.invalidateQueries({ queryKey: getGetPublicManagedListingQueryKey(token) });
              }}
              onSaved={(nextLogoUrl) => {
                setLogoUrl(nextLogoUrl);
                toast({
                  title: nextLogoUrl ? "Logo uploaded" : "Logo removed",
                  description: nextLogoUrl
                    ? "Your new logo is now shown across the site."
                    : "Your listing now uses its initials avatar.",
                });
              }}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-2"><span className="text-xs font-bold uppercase tracking-wider">Product name</span><Input value={String(values.name)} onChange={(event) => change("name", event.target.value)} required /></label>
              <label className="space-y-2"><span className="text-xs font-bold uppercase tracking-wider">Category</span>
                <select value={String(values.category)} onChange={(event) => change("category", event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  {categories.map((category) => <option key={category}>{category}</option>)}
                </select>
              </label>
            </div>
            <label className="block space-y-2"><span className="text-xs font-bold uppercase tracking-wider">Website URL</span><Input type="url" value={String(values.websiteUrl)} onChange={(event) => change("websiteUrl", event.target.value)} required /></label>
            <label className="block space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider">Demo video URL (optional)</span>
                {String(values.demoVideoUrl) && (
                  <button type="button" onClick={() => change("demoVideoUrl", "")} className="text-[10px] font-bold uppercase text-muted-foreground hover:text-destructive" data-testid="button-clear-managed-demo-url">
                    Clear
                  </button>
                )}
              </div>
              <Input type="text" inputMode="url" value={String(values.demoVideoUrl)} onChange={(event) => change("demoVideoUrl", event.target.value)} placeholder="https://youtube.com/watch?v=... or https://vimeo.com/..." />
              <span className="block text-[11px] text-muted-foreground">A YouTube, Shorts, or Vimeo link shows a "Demo" button on your listing.</span>
            </label>
            <label className="block space-y-2"><span className="text-xs font-bold uppercase tracking-wider">Short description</span><Input value={String(values.tagline)} onChange={(event) => change("tagline", event.target.value)} required maxLength={160} /></label>
            <label className="block space-y-2"><span className="text-xs font-bold uppercase tracking-wider">Product details</span><Textarea value={String(values.description)} onChange={(event) => change("description", event.target.value)} required maxLength={2000} className="min-h-32" /></label>
            <Button type="submit" disabled={saving} className="h-11 w-full font-bold uppercase tracking-wider">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="mr-2 h-4 w-4" /> Save product details</>}</Button>
          </Card>
        </form>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card className="border-primary/30 bg-primary/5 p-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Your product</p>
            <div className="mt-3 flex items-end justify-between"><span className="text-4xl font-bold">#{data.listing.rank}</span><span className="font-mono text-lg font-bold">{formatCurrency(data.listing.effectiveBid)}</span></div>
             <p className="mt-1 text-xs text-muted-foreground">Current rank · Ranking power</p>
            <dl className="mt-5 space-y-2 border-t border-primary/20 pt-4 text-xs">
              <div className="flex justify-between"><dt className="text-muted-foreground">Owner claim</dt><dd className="font-mono font-bold">{formatCurrency(data.listing.ownerBid)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Community boosts</dt><dd className="font-mono font-bold text-secondary">+{formatCurrency(data.listing.communitySupport)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Push downs</dt><dd className="font-mono font-bold text-destructive">-{formatCurrency(data.listing.penalties)}</dd></div>
            </dl>
             <label className="mt-5 block space-y-2"><span className="text-xs font-bold uppercase tracking-wider">{data.listing.ownerBid ? "Increase owner claim" : "Enter this week’s campaign"}</span><Input type="number" min={minimumOwnerBid} value={Number(values.ownerBid)} onChange={(event) => change("ownerBid", Math.max(minimumOwnerBid, Number(event.target.value) || minimumOwnerBid))} className="font-mono font-bold" /></label>
             <p className="mt-2 text-[10px] text-muted-foreground">Campaign #{campaign?.number ?? "…"} minimum: {formatCurrency(minimumOwnerBid)}. Each week requires a new owner claim to participate.</p>
          </Card>
          <Card className="p-5">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider"><Activity className="h-4 w-4 text-primary" /> Recent activity</p>
            <div className="mt-3 space-y-3">
              {data.activity.length ? data.activity.slice(0, 5).map((item) => <div key={item.id} className="flex justify-between gap-3 text-xs"><span className="truncate text-muted-foreground">{item.type === "OWNER_BID" ? "CLAIM" : item.type === "COMMUNITY_BID" ? "BOOST" : item.type === "PENALTY" ? "PUSH DOWN" : item.type.replaceAll("_", " ")}</span><span className="shrink-0 font-mono font-bold">{formatCurrency(item.amount)}</span></div>) : <p className="text-xs text-muted-foreground">No activity yet.</p>}
            </div>
            <Button asChild variant="outline" className="mt-4 w-full text-xs"><Link href={`/listing/${data.listing.slug}`}><ExternalLink className="mr-2 h-3.5 w-3.5" /> View reviews & activity</Link></Button>
          </Card>
          <Button variant="outline" className="w-full border-destructive/40 text-destructive hover:bg-destructive/10" onClick={archive} disabled={archiving}>{archiving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Archive className="mr-2 h-4 w-4" /> Archive product</>}</Button>
        </aside>
      </div>
    </div>
  );
}