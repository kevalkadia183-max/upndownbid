import './_group.css';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ArrowUpRight,
  TrendingUp,
  TrendingDown,
  Activity,
  ArrowRight,
  Sparkles,
  Search,
  Filter,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Inlined helpers (replicate main app's formatCurrency / formatNumber)
// ---------------------------------------------------------------------------
function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

// ---------------------------------------------------------------------------
// Stub data — realistic shapes matching the real API responses
// ---------------------------------------------------------------------------
interface Listing {
  id: number;
  slug: string;
  name: string;
  initials: string;
  tagline: string;
  category: string;
  reviewCount: number;
  effectiveBid: number;
  accent: string;
  trend: number;
}

interface ActivityEvent {
  id: number;
  listingName: string;
  type: 'support' | 'penalty' | 'owner';
  amount: number;
  rank: number;
  createdAt: string;
}

const STUB_LISTINGS: Listing[] = [
  {
    id: 1,
    slug: 'veritas-analytics',
    name: 'Veritas Analytics',
    initials: 'VA',
    tagline: 'Real-time business intelligence with zero setup friction.',
    category: 'Analytics',
    reviewCount: 3412,
    effectiveBid: 14500,
    accent: '#0033cc',
    trend: 2,
  },
  {
    id: 2,
    slug: 'luminary-crm',
    name: 'Luminary CRM',
    initials: 'LC',
    tagline: 'The CRM that actually learns your sales motion.',
    category: 'Sales',
    reviewCount: 2876,
    effectiveBid: 12200,
    accent: '#cc8800',
    trend: -1,
  },
  {
    id: 3,
    slug: 'forge-payments',
    name: 'Forge Payments',
    initials: 'FP',
    tagline: 'Merchant-first payment rails for the modern stack.',
    category: 'Fintech',
    reviewCount: 2104,
    effectiveBid: 9800,
    accent: '#006633',
    trend: 0,
  },
  {
    id: 4,
    slug: 'axiom-security',
    name: 'Axiom Security',
    initials: 'AS',
    tagline: 'Zero-trust access control for distributed teams.',
    category: 'Security',
    reviewCount: 1987,
    effectiveBid: 8300,
    accent: '#990000',
    trend: 5,
  },
  {
    id: 5,
    slug: 'signal-ops',
    name: 'SignalOps',
    initials: 'SO',
    tagline: 'Incident response automation with ML-driven triage.',
    category: 'DevOps',
    reviewCount: 1654,
    effectiveBid: 7100,
    accent: '#5500cc',
    trend: 3,
  },
  {
    id: 6,
    slug: 'crestline-hr',
    name: 'Crestline HR',
    initials: 'CH',
    tagline: 'People operations platform built for hypergrowth.',
    category: 'HR',
    reviewCount: 1203,
    effectiveBid: 5500,
    accent: '#cc3300',
    trend: -2,
  },
  {
    id: 7,
    slug: 'meridian-seo',
    name: 'Meridian SEO',
    initials: 'MS',
    tagline: 'Content-intelligence platform for organic growth teams.',
    category: 'Marketing',
    reviewCount: 982,
    effectiveBid: 4200,
    accent: '#007799',
    trend: 1,
  },
];

const STUB_ACTIVITIES: ActivityEvent[] = [
  {
    id: 1,
    listingName: 'Veritas Analytics',
    type: 'support',
    amount: 1200,
    rank: 2,
    createdAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
  },
  {
    id: 2,
    listingName: 'Axiom Security',
    type: 'owner',
    amount: 500,
    rank: 0,
    createdAt: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
  },
  {
    id: 3,
    listingName: 'Luminary CRM',
    type: 'penalty',
    amount: 300,
    rank: -1,
    createdAt: new Date(Date.now() - 14 * 60 * 1000).toISOString(),
  },
  {
    id: 4,
    listingName: 'Forge Payments',
    type: 'support',
    amount: 750,
    rank: 1,
    createdAt: new Date(Date.now() - 22 * 60 * 1000).toISOString(),
  },
  {
    id: 5,
    listingName: 'SignalOps',
    type: 'support',
    amount: 400,
    rank: 3,
    createdAt: new Date(Date.now() - 35 * 60 * 1000).toISOString(),
  },
  {
    id: 6,
    listingName: 'Crestline HR',
    type: 'owner',
    amount: 600,
    rank: 0,
    createdAt: new Date(Date.now() - 47 * 60 * 1000).toISOString(),
  },
  {
    id: 7,
    listingName: 'Meridian SEO',
    type: 'penalty',
    amount: 200,
    rank: -2,
    createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  },
  {
    id: 8,
    listingName: 'Veritas Analytics',
    type: 'support',
    amount: 900,
    rank: 1,
    createdAt: new Date(Date.now() - 75 * 60 * 1000).toISOString(),
  },
];

// ---------------------------------------------------------------------------
// Inlined Header (from layout.tsx) — no routing side-effects
// ---------------------------------------------------------------------------
function Header() {
  return (
    <header
      className="sticky top-0 z-40 w-full"
      style={{
        borderBottom: '4px solid hsl(224 100% 10%)',
        backgroundColor: 'hsl(40 33% 98%)',
      }}
    >
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2 cursor-default">
          <div
            style={{
              backgroundColor: 'hsl(224 100% 45%)',
              color: '#fff',
              padding: '4px',
              border: '2px solid hsl(224 100% 10%)',
            }}
          >
            <TrendingUp size={24} strokeWidth={3} />
          </div>
          <span style={{ fontWeight: 700, fontSize: '1.25rem', letterSpacing: '-0.02em' }}>
            upndownbid
          </span>
        </div>

        <nav className="hidden md:flex items-center gap-6">
          {[
            { label: 'Leaderboard', active: true },
            { label: 'How it works', active: false },
          ].map(({ label, active }) => (
            <span
              key={label}
              className="cursor-pointer"
              style={{
                fontSize: '0.875rem',
                fontWeight: 700,
                fontFamily: "'Space Mono', monospace",
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: active ? 'hsl(224 100% 45%)' : 'hsl(224 100% 10%)',
                borderBottom: active ? '2px solid hsl(224 100% 45%)' : 'none',
              }}
            >
              {label}
            </span>
          ))}
        </nav>

        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            className="hidden sm:flex font-mono text-xs"
            style={{ fontFamily: "'Space Mono', monospace" }}
          >
            <Sparkles className="w-4 h-4 mr-2" />
            Get Sandbox Credits
          </Button>
          <Button
            className="font-mono text-xs uppercase"
            style={{
              fontFamily: "'Space Mono', monospace",
              backgroundColor: 'hsl(224 100% 45%)',
              color: '#fff',
              border: '2px solid hsl(224 100% 10%)',
            }}
          >
            Sign In <ArrowUpRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Inlined Footer (from layout.tsx)
// ---------------------------------------------------------------------------
function Footer() {
  return (
    <footer
      style={{
        borderTop: '4px solid hsl(224 100% 10%)',
        backgroundColor: 'hsl(224 20% 90%)',
        marginTop: '5rem',
        paddingTop: '3rem',
        paddingBottom: '3rem',
      }}
    >
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          <div className="col-span-2">
            <div className="flex items-center gap-2 mb-4 cursor-default">
              <div
                style={{
                  backgroundColor: 'hsl(224 100% 10%)',
                  color: '#fff',
                  padding: '4px',
                }}
              >
                <TrendingUp size={20} strokeWidth={3} />
              </div>
              <span style={{ fontWeight: 700, fontSize: '1.125rem', letterSpacing: '-0.02em' }}>
                upndownbid
              </span>
            </div>
            <p
              style={{
                color: 'hsl(224 20% 40%)',
                fontFamily: "'Space Mono', monospace",
                fontSize: '0.875rem',
                maxWidth: '24rem',
              }}
            >
              The public credibility and momentum leaderboard for products and businesses.
              Financial position and review quality stay explicitly distinct.
            </p>
          </div>
          <div>
            <h4
              style={{
                fontWeight: 700,
                marginBottom: '1rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                fontSize: '0.875rem',
              }}
            >
              Platform
            </h4>
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                fontFamily: "'Space Mono', monospace",
                fontSize: '0.875rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
              }}
            >
              {['Leaderboard', 'How it Works', 'Sandbox Protocol'].map((item) => (
                <li key={item}>
                  <span
                    className="cursor-pointer"
                    style={{ color: 'hsl(224 20% 40%)' }}
                  >
                    {item}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4
              style={{
                fontWeight: 700,
                marginBottom: '1rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                fontSize: '0.875rem',
              }}
            >
              Legal
            </h4>
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                fontFamily: "'Space Mono', monospace",
                fontSize: '0.875rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
              }}
            >
              {['Terms of Service', 'Privacy Policy', 'Community Guidelines'].map((item) => (
                <li key={item}>
                  <span
                    className="cursor-pointer"
                    style={{ color: 'hsl(224 20% 40%)' }}
                  >
                    {item}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div
          style={{
            borderTop: '2px solid rgba(9,19,83,0.2)',
            paddingTop: '2rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            alignItems: 'center',
          }}
          className="md:flex-row md:justify-between"
        >
          <p style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.75rem', color: 'hsl(224 20% 40%)' }}>
            &copy; {new Date().getFullYear()} upndownbid. A conceptual experiment in credibility allocation.
          </p>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.75rem',
              fontFamily: "'Space Mono', monospace",
              color: 'hsl(224 20% 40%)',
            }}
          >
            <Activity className="w-3 h-3" style={{ color: 'hsl(75 100% 50%)' }} />
            System Status: Sandbox Online
          </div>
        </div>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Main exported component
// ---------------------------------------------------------------------------
export function CurrentDiscovery() {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'rank' | 'newest' | 'controversial'>('rank');

  const filteredListings = STUB_LISTINGS.filter((l) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return l.name.toLowerCase().includes(q) || l.tagline.toLowerCase().includes(q);
  });

  // Colour shortcuts
  const fg = 'hsl(224 100% 10%)';
  const primary = 'hsl(224 100% 45%)';
  const secondary = 'hsl(75 100% 50%)';
  const cardBg = 'hsl(0 0% 100%)';
  const mutedFg = 'hsl(224 20% 40%)';
  const destructive = 'hsl(0 84% 60%)';
  const mono = "'Space Mono', monospace";

  return (
    <div className="sr-scope min-h-screen" style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}>
      <Header />

      {/* Page body */}
      <div className="container mx-auto px-4 py-12 max-w-7xl">
        {/* Hero heading */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-12">
          <div>
            <h1
              style={{
                fontSize: 'clamp(3rem, 6vw, 4.5rem)',
                fontWeight: 800,
                letterSpacing: '-0.05em',
                lineHeight: 1,
                textTransform: 'uppercase',
                marginBottom: '1rem',
              }}
            >
              The Public{' '}
              <br />
              <span style={{ color: primary }}>Ledger.</span>
            </h1>
            <p
              style={{
                fontSize: '1.25rem',
                fontFamily: mono,
                color: mutedFg,
                maxWidth: '42rem',
              }}
            >
              Where products earn credibility through community signals and transparent rankings.
              Sandbox data only during development.
            </p>
          </div>
          <div
            style={{
              backgroundColor: 'rgba(224, 231, 255, 0.2)',
              border: `2px solid ${fg}`,
              padding: '1rem',
              boxShadow: `2px 2px 0px 0px ${fg}`,
            }}
          >
            <div
              style={{
                fontSize: '0.875rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: '0.25rem',
              }}
            >
              Sandbox Volume
            </div>
            <div style={{ fontSize: '1.875rem', fontFamily: mono, fontWeight: 700 }}>
              $14.2M
            </div>
          </div>
        </div>

        {/* Two-column grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left: listing feed */}
          <div className="lg:col-span-2 space-y-6">
            {/* Sticky search + filter bar */}
            <div
              className="flex flex-col sm:flex-row gap-4 justify-between items-center"
              style={{
                backgroundColor: cardBg,
                border: `4px solid ${fg}`,
                padding: '1rem',
                boxShadow: `4px 4px 0px 0px ${fg}`,
                position: 'sticky',
                top: '5rem',
                zIndex: 30,
              }}
            >
              <div className="relative w-full sm:w-96">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5"
                  style={{ color: mutedFg }}
                />
                <Input
                  placeholder="Search products, companies..."
                  className="pl-10 h-12 text-lg"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ fontFamily: mono }}
                />
              </div>
              <div className="flex w-full sm:w-auto items-center gap-2 overflow-x-auto pb-2 sm:pb-0">
                <Filter className="w-5 h-5 shrink-0" style={{ color: mutedFg }} />
                <Tabs
                  value={sort}
                  onValueChange={(v) => setSort(v as typeof sort)}
                  className="w-full"
                >
                  <TabsList>
                    <TabsTrigger value="rank">Rank</TabsTrigger>
                    <TabsTrigger value="newest">New</TabsTrigger>
                    <TabsTrigger value="controversial">Spicy</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </div>

            {/* Listing cards */}
            <div className="space-y-4">
              {filteredListings.length === 0 ? (
                <div
                  style={{
                    border: `4px dashed ${fg}`,
                    padding: '3rem',
                    textAlign: 'center',
                    backgroundColor: cardBg,
                  }}
                >
                  <div style={{ fontSize: '2.25rem', marginBottom: '1rem', fontFamily: mono }}>
                    _
                  </div>
                  <h3 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                    No signals detected
                  </h3>
                  <p style={{ color: mutedFg, fontFamily: mono }}>
                    Adjust your search parameters or start a new listing.
                  </p>
                </div>
              ) : (
                filteredListings.map((listing, index) => (
                  <div
                    key={listing.id}
                    className="group neo-shadow"
                    style={{
                      border: `4px solid ${fg}`,
                      backgroundColor: cardBg,
                      padding: '1.5rem',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '1.5rem',
                      position: 'relative',
                      overflow: 'hidden',
                      transition: 'background-color 150ms',
                    }}
                    onMouseEnter={(e) =>
                      ((e.currentTarget as HTMLDivElement).style.backgroundColor =
                        'hsl(224 20% 90% / 0.5)')
                    }
                    onMouseLeave={(e) =>
                      ((e.currentTarget as HTMLDivElement).style.backgroundColor = cardBg)
                    }
                  >
                    {/* Rank badge */}
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '4rem',
                        height: '4rem',
                        backgroundColor: primary,
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontFamily: mono,
                        fontWeight: 700,
                        fontSize: '1.5rem',
                        borderBottom: `4px solid ${fg}`,
                        borderRight: `4px solid ${fg}`,
                        zIndex: 10,
                        borderBottomRightRadius: '1.5rem',
                      }}
                    >
                      #{index + 1}
                    </div>

                    <div
                      className="sm:flex-row"
                      style={{ display: 'flex', alignItems: 'flex-start', gap: '1.5rem', paddingLeft: '2.5rem' }}
                    >
                      {/* Logo / initials */}
                      <div
                        style={{
                          width: '4rem',
                          height: '4rem',
                          flexShrink: 0,
                          border: `4px solid ${fg}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 700,
                          fontSize: '1.5rem',
                          color: listing.accent,
                          backgroundColor: '#fff',
                          boxShadow: `2px 2px 0px 0px ${fg}`,
                        }}
                      >
                        {listing.initials}
                      </div>

                      {/* Name + meta */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
                          <h3
                            style={{
                              fontSize: '1.5rem',
                              fontWeight: 700,
                              overflow: 'hidden',
                              whiteSpace: 'nowrap',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {listing.name}
                          </h3>
                          {listing.trend > 0 && (
                            <Badge variant="secondary" className="hidden sm:inline-flex px-1.5 py-0">
                              <TrendingUp className="w-3 h-3 mr-1" />
                              {listing.trend}
                            </Badge>
                          )}
                          {listing.trend < 0 && (
                            <Badge variant="destructive" className="hidden sm:inline-flex px-1.5 py-0">
                              <TrendingDown className="w-3 h-3 mr-1" />
                              {Math.abs(listing.trend)}
                            </Badge>
                          )}
                        </div>
                        <p
                          style={{
                            color: mutedFg,
                            fontFamily: mono,
                            fontSize: '0.875rem',
                            marginBottom: '0.75rem',
                            overflow: 'hidden',
                            display: '-webkit-box',
                            WebkitLineClamp: 1,
                            WebkitBoxOrient: 'vertical',
                          }}
                        >
                          {listing.tagline}
                        </p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem' }}>
                          <Badge variant="outline" style={{ backgroundColor: '#fff' }}>
                            {listing.category}
                          </Badge>
                          <span
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.25rem',
                              color: primary,
                              fontSize: '0.75rem',
                              fontFamily: mono,
                            }}
                          >
                            <Activity className="w-3 h-3" />
                            {formatNumber(listing.reviewCount)} signals
                          </span>
                        </div>
                      </div>

                      {/* Bid + arrow */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'flex-end',
                          gap: '1.5rem',
                          marginLeft: 'auto',
                        }}
                        className="border-t-0 pt-0"
                      >
                        <div style={{ textAlign: 'right' }}>
                          <div
                            style={{
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              textTransform: 'uppercase',
                              letterSpacing: '0.05em',
                              color: mutedFg,
                              marginBottom: '0.25rem',
                            }}
                          >
                            Effective Bid
                          </div>
                          <div style={{ fontSize: '1.5rem', fontFamily: mono, fontWeight: 700 }}>
                            {formatCurrency(listing.effectiveBid)}
                          </div>
                        </div>
                        <div
                          style={{
                            backgroundColor: fg,
                            color: '#fff',
                            padding: '0.75rem',
                            transition: 'background-color 150ms',
                          }}
                          onMouseEnter={(e) =>
                            ((e.currentTarget as HTMLDivElement).style.backgroundColor = primary)
                          }
                          onMouseLeave={(e) =>
                            ((e.currentTarget as HTMLDivElement).style.backgroundColor = fg)
                          }
                        >
                          <ArrowRight className="w-6 h-6" />
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right sidebar */}
          <div className="space-y-8">
            {/* CTA card */}
            <div
              style={{
                backgroundColor: primary,
                color: '#fff',
                border: `4px solid ${fg}`,
                padding: '1.5rem',
                boxShadow: `4px 4px 0px 0px ${fg}`,
              }}
            >
              <h3
                style={{
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  marginBottom: '1rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <Sparkles className="w-6 h-6" />
                Claim Your Space
              </h3>
              <p style={{ fontFamily: mono, marginBottom: '1.5rem', opacity: 0.9 }}>
                Add your product to the ledger. Initial bids start at $500 to prevent spam.
              </p>
              <Button
                variant="secondary"
                className="w-full text-lg"
                size="lg"
                disabled
                title="Listing creation arrives with the owner dashboard phase."
                style={{ width: '100%' }}
              >
                Owner tools coming next
              </Button>
            </div>

            {/* Live activity feed */}
            <div
              style={{
                border: `4px solid ${fg}`,
                backgroundColor: cardBg,
                overflow: 'hidden',
                boxShadow: `2px 2px 0px 0px ${fg}`,
              }}
            >
              {/* Feed header */}
              <div
                style={{
                  backgroundColor: fg,
                  color: '#fff',
                  padding: '1rem',
                  borderBottom: `4px solid ${fg}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <h3
                  style={{
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    fontSize: '0.875rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <Activity className="w-4 h-4" style={{ color: secondary }} />
                  Live Network
                </h3>
                <span style={{ position: 'relative', display: 'flex', height: '0.75rem', width: '0.75rem' }}>
                  <span
                    style={{
                      position: 'absolute',
                      display: 'inline-flex',
                      height: '100%',
                      width: '100%',
                      borderRadius: '9999px',
                      backgroundColor: secondary,
                      opacity: 0.75,
                      animation: 'ping 1s cubic-bezier(0,0,0.2,1) infinite',
                    }}
                  />
                  <span
                    style={{
                      position: 'relative',
                      display: 'inline-flex',
                      borderRadius: '9999px',
                      height: '0.75rem',
                      width: '0.75rem',
                      backgroundColor: secondary,
                    }}
                  />
                </span>
              </div>

              {/* Feed items */}
              <div
                style={{ maxHeight: '37.5rem', overflowY: 'auto' }}
              >
                {STUB_ACTIVITIES.map((event, i) => (
                  <div
                    key={event.id}
                    style={{
                      padding: '1rem',
                      fontSize: '0.875rem',
                      fontFamily: mono,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.5rem',
                      borderTop: i === 0 ? 'none' : `2px solid ${fg}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: 700 }}>{event.listingName}</span>
                      <span style={{ fontSize: '0.75rem', color: mutedFg }}>
                        {new Date(event.createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {event.type === 'support' && (
                        <span
                          style={{
                            backgroundColor: 'rgba(204,255,0,0.2)',
                            color: 'hsl(224 100% 10%)',
                            padding: '0.125rem 0.5rem',
                            border: `1px solid ${secondary}`,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                          }}
                        >
                          <ArrowUpRight className="w-3 h-3" />
                          Supported with {formatCurrency(event.amount)}
                        </span>
                      )}
                      {event.type === 'penalty' && (
                        <span
                          style={{
                            backgroundColor: 'rgba(220,38,38,0.1)',
                            color: destructive,
                            padding: '0.125rem 0.5rem',
                            border: `1px solid ${destructive}`,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                          }}
                        >
                          <TrendingDown className="w-3 h-3" />
                          Penalized with {formatCurrency(event.amount)}
                        </span>
                      )}
                      {event.type === 'owner' && (
                        <span
                          style={{
                            backgroundColor: 'rgba(0,51,204,0.1)',
                            color: primary,
                            padding: '0.125rem 0.5rem',
                            border: `1px solid ${primary}`,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                          }}
                        >
                          <Activity className="w-3 h-3" />
                          Owner bid {formatCurrency(event.amount)}
                        </span>
                      )}
                    </div>

                    <div
                      style={{
                        fontSize: '0.75rem',
                        color: mutedFg,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                        marginTop: '0.25rem',
                      }}
                    >
                      Rank impact:{' '}
                      <span
                        style={{
                          fontWeight: 700,
                          color:
                            event.rank > 0
                              ? secondary
                              : event.rank < 0
                              ? destructive
                              : 'inherit',
                        }}
                      >
                        {event.rank > 0 ? '+' : ''}
                        {event.rank || 'No change'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
