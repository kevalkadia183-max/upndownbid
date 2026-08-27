export const CATEGORY_GROUPS = [
  {
    label: "AI & Technology",
    items: [
      "SEO & AI Visibility",
      "AI Agents & Infrastructure",
      "AI Media Generation",
      "Developer Tools",
      "Security, Privacy & Compliance",
      "Crypto, Web3 & Investing",
    ],
  },
  {
    label: "Business & Growth",
    items: [
      "Marketing & Advertising",
      "Sales & Lead Generation",
      "Business, Finance & Legal",
      "Ecommerce & Retail",
      "Hiring, Jobs & Careers",
      "Agencies, Studios & Services",
    ],
  },
  {
    label: "Work & Creativity",
    items: [
      "Productivity & Personal Tools",
      "Design & Creative",
      "Writing & Content",
      "Audio, Voice & Podcasting",
      "Media & News",
      "Games & Entertainment",
    ],
  },
  {
    label: "Life & Discovery",
    items: [
      "Education & Learning",
      "Health, Fitness & Wellness",
      "Social Media & Creator Tools",
      "Directories, Launch & Discovery",
      "Travel, Local & Lifestyle",
      "Real Estate & Property",
      "Domains & Web Assets",
      "Leaderboards & Attention Markets",
      "Other",
    ],
  },
] as const;

export const CATEGORY_OPTIONS = [
  "All categories",
  ...CATEGORY_GROUPS.flatMap((group) => group.items),
] as const;

export const CATEGORY_ALIASES: Record<string, string[]> = {
  "SEO & AI Visibility": ["seo", "visibility"],
  "AI Agents & Infrastructure": ["ai", "agent", "infrastructure"],
  "AI Media Generation": ["media"],
  "Marketing & Advertising": ["marketing", "advertising"],
  "Developer Tools": ["developer", "tool"],
  "Productivity & Personal Tools": ["productivity"],
  "Design & Creative": ["design", "creative"],
  "Social Media & Creator Tools": ["social", "creator"],
  "Writing & Content": ["writing", "content"],
  "Sales & Lead Generation": ["sales", "lead"],
  "Business, Finance & Legal": ["business", "finance", "legal"],
  "Games & Entertainment": ["game", "entertainment"],
  "Education & Learning": ["education", "learning"],
  "Health, Fitness & Wellness": ["health", "fitness", "wellness"],
  "Ecommerce & Retail": ["commerce", "ecommerce", "retail"],
  "Directories, Launch & Discovery": ["directory", "launch", "discovery"],
  "Hiring, Jobs & Careers": ["hiring", "job", "career"],
  "Audio, Voice & Podcasting": ["audio", "voice", "podcast"],
  "Crypto, Web3 & Investing": ["crypto", "web3", "invest"],
  "Agencies, Studios & Services": ["agency", "studio", "service"],
  "Security, Privacy & Compliance": ["security", "privacy", "compliance"],
  "Travel, Local & Lifestyle": ["travel", "local", "lifestyle"],
  "Media & News": ["media", "news"],
  "Domains & Web Assets": ["domain", "web"],
  "Leaderboards & Attention Markets": ["leaderboard", "attention", "market"],
  "Real Estate & Property": ["real estate", "property"],
  Other: ["other"],
};