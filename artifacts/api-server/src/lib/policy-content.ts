// Default legal/policy content seeded on first run. Admins can edit and
// republish any of this from Admin -> Policies without a code deploy.
//
// Content intentionally uses {{TOKEN}} placeholders for business-identity
// facts (name, address, support email, grievance officer) instead of
// invented values. The frontend resolves these against `/site-settings`
// at render time. Until an admin fills them in, the page shows a clear
// "not yet provided" placeholder rather than a fabricated value.
//
// This text is careful, general-purpose policy language for a paid
// product-ranking/community-bidding platform. It intentionally avoids:
//  - absolute "no refunds, ever" language (mandatory consumer-protection
//    rights and statutory remedies are preserved),
//  - broad rights-waiver language,
//  - inventing a governing-law jurisdiction (left as a placeholder).
// Review with qualified legal counsel for your jurisdiction before relying
// on this as your final published policy.

export interface DefaultPolicy {
  policyType: string;
  title: string;
  content: string;
}

export const DEFAULT_POLICIES: DefaultPolicy[] = [
  {
    policyType: "terms",
    title: "Terms & Conditions",
    content: `# Terms & Conditions

_Last updated: see the date shown on this page._

These Terms & Conditions ("Terms") govern access to and use of {{BUSINESS_NAME}}'s product-ranking and community-bidding platform ("the Service"). By creating an account, submitting a listing, placing a bid, or otherwise using the Service, you agree to these Terms. If you do not agree, do not use the Service.

## 1. What the Service does

The Service lets product owners submit listings, place paid "owner bids" to support their own listing's position, and lets community members place paid "community bids" (support) or record penalty signals against listings during recurring, time-boxed campaign windows. Rankings are computed automatically from these signals for the current campaign window and are not manually curated in the ordinary course.

## 2. Eligibility and accounts

You must be able to form a binding contract in your jurisdiction to use the Service. You are responsible for the accuracy of information you submit and for maintaining the confidentiality of your account credentials. You are responsible for activity that occurs under your account, except to the extent caused by our fault.

## 3. Listings and content standards

Listings and any content you submit (descriptions, links, media, reviews) must comply with our [Website & Content Policy](/website-policy) and [Community Guidelines](/community-guidelines). We may review, flag, suspend, or remove listings or content that violate those policies or these Terms, using the moderation process described there.

## 4. Payments, bids, and campaigns

Owner bids, community bids, and related campaign fees are described in our [Refund & Cancellation Policy](/refund-policy), which forms part of these Terms. Rankings change only based on verified, successfully processed payment events; a pending or failed payment has no effect on ranking. Campaign windows run on a recurring server-authoritative schedule and are not extended or reopened for individual participants after they close, except as required by law or as expressly stated in the Refund & Cancellation Policy.

## 5. Reviews and reports

Reviews, support signals, and penalty signals must reflect genuine, good-faith opinions about a listing. Misuse of these features (including fake reviews, coordinated manipulation, or harassment) is prohibited and may result in content removal, account restrictions, or reporting to relevant authorities where required.

## 6. Intellectual property

You retain ownership of content you submit, and grant {{BUSINESS_NAME}} a non-exclusive, worldwide license to host, display, and distribute it as necessary to operate the Service. You represent that you have the rights necessary to grant this license and that your submissions do not infringe third-party rights.

## 7. Disclaimers

The Service is provided "as is" and rankings reflect community and owner activity, not an endorsement, verification, or guarantee of quality, safety, or legality of any listed product by {{BUSINESS_NAME}}. To the fullest extent permitted by applicable law, {{BUSINESS_NAME}} disclaims warranties of merchantability, fitness for a particular purpose, and non-infringement. Nothing in these Terms limits any right or remedy you have under mandatory consumer-protection law that cannot be waived by agreement.

## 8. Limitation of liability

To the fullest extent permitted by applicable law, {{BUSINESS_NAME}}'s aggregate liability arising out of or relating to the Service is limited to the amount you paid to {{BUSINESS_NAME}} in the twelve (12) months preceding the claim. This limitation does not apply where prohibited by law, including for liability that cannot be excluded or limited under applicable consumer-protection statutes.

## 9. Suspension and termination

We may suspend or terminate access to the Service for violations of these Terms, the Website & Content Policy, or the Community Guidelines, following the moderation process described in those policies. You may stop using the Service at any time; certain obligations (payment, content licenses already granted, dispute resolution) survive termination.

## 10. Changes to these Terms

We may update these Terms from time to time. Material changes will be reflected by an updated "last updated" date and, where required by law, additional notice. Continued use of the Service after changes take effect constitutes acceptance of the revised Terms.

## 11. Governing law and disputes

The governing law and dispute-resolution forum for these Terms will be specified here by {{BUSINESS_NAME}} for the relevant jurisdiction. Nothing in this section is intended to remove any statutory right you have to bring a claim in your local courts where such a right cannot be waived by agreement.

## 12. Contact

Questions about these Terms can be sent to {{SUPPORT_EMAIL}}. For grievances, see our [Grievance & Contact](/grievance) page.
`,
  },
  {
    policyType: "privacy",
    title: "Privacy Policy",
    content: `# Privacy Policy

_Last updated: see the date shown on this page._

This Privacy Policy explains what personal data {{BUSINESS_NAME}} collects through the Service, why we collect it, and the choices available to you.

## 1. Information we collect

- **Account information**: name, email address, and profile details you provide (e.g. through sign-in).
- **Listing and submission data**: information you submit about a product or business you own or represent, including public website URLs.
- **Transaction data**: bid amounts, campaign participation, and payment status. Card and full payment-account details are handled by our payment processors directly; we store payment status, amounts, and provider references, not full card numbers.
- **Activity data**: reviews, support/penalty signals, reports, and feedback you submit, and basic usage/analytics data such as page views and click events on listings.
- **Technical data**: IP address, device/browser information, and similar data collected automatically for security, rate-limiting, and abuse prevention.

## 2. How we use information

We use this information to: operate and rank listings for the current campaign; process payments; enforce our Website & Content Policy and Community Guidelines; investigate reports and abuse; respond to support and grievance requests; and improve the Service. We do not sell your personal information.

## 3. Sharing

We share information with: payment processors, to complete transactions; service providers who help us operate the Service (e.g. hosting, analytics) under confidentiality obligations; and law enforcement or regulators where required by law or to protect the rights, property, or safety of {{BUSINESS_NAME}}, our users, or the public.

## 4. Retention

We retain account, transaction, and moderation records for as long as needed to operate the Service, comply with legal and tax obligations, and resolve disputes, after which we delete or anonymize the data in line with applicable law.

## 5. Your rights

Depending on your location, you may have rights to access, correct, export, or request deletion of your personal data, and to object to or restrict certain processing. To exercise these rights, contact {{SUPPORT_EMAIL}}. We will respond within the time required by applicable law. Some records (such as payment and audit records needed for legal, tax, or fraud-prevention purposes) may need to be retained even after a deletion request, to the extent permitted or required by law.

## 6. Security

We use reasonable technical and organizational measures to protect personal data, including access controls on administrative and moderation tools. No system is completely secure, and we cannot guarantee absolute security.

## 7. Children

The Service is not directed to children under the age required by applicable law to consent to data processing on their own behalf, and we do not knowingly collect personal data from such children.

## 8. Changes to this policy

We may update this Privacy Policy from time to time. Material changes will be reflected by an updated "last updated" date and, where required by law, additional notice.

## 9. Contact

Privacy questions or requests can be sent to {{SUPPORT_EMAIL}}. For formal grievances, see our [Grievance & Contact](/grievance) page.
`,
  },
  {
    policyType: "website_policy",
    title: "Website & Content Policy",
    content: `# Website & Content Policy

_Last updated: see the date shown on this page._

This policy describes what may and may not be submitted, listed, or linked to through the Service, and how we handle violations.

## 1. Prohibited listings and content

You may not submit a listing, review, or other content that:

- Is illegal, or promotes or facilitates illegal activity, in the jurisdiction(s) where it is offered.
- Involves phishing, malware, spyware, or other content designed to compromise a visitor's device, account, or data.
- Is fraudulent, a scam, or a pyramid/Ponzi-style scheme, or otherwise misrepresents the product, its ownership, or its results.
- Involves unlicensed or unlawful gambling or betting.
- Is sexually explicit, depicts minors in an unsafe or exploitative way, or otherwise violates applicable obscenity or child-safety law.
- Infringes another party's intellectual property, privacy, or other legal rights, or is submitted without authorization from the product's actual owner.
- Contains material that is deliberately misleading about a product's price, safety, efficacy, or legal status, in a way likely to cause consumer harm.
- Promotes hate speech, harassment, or violence against individuals or groups.
- Attempts to manipulate rankings through fake accounts, coordinated inauthentic bidding/reviews, or automated abuse of the bidding or review systems.

This list is illustrative, not exhaustive; we may act on content that presents comparable risk even if not explicitly listed above.

## 2. Reviewing and reporting

Any visitor can report a listing they believe violates this policy using the "Report" action on the listing page. Reports may be submitted anonymously and are subject to rate limiting to prevent abuse. Automated checks may also flag submitted URLs for basic validity and safety signals; these checks are a signal for human review, not a final determination.

## 3. Moderation states and process

Listings may move through the following states:

- **Active** — visible and eligible for ranking as normal.
- **Pending review** — a new or reported listing awaiting a first moderation pass; may remain visible while under review unless a moderator determines otherwise.
- **Flagged** — a moderator has identified a potential concern; may remain visible pending resolution.
- **Suspended** — temporarily removed from public ranking and listings pending resolution of a violation.
- **Removed** — permanently taken down for a confirmed, serious violation of this policy.

Moderators and admins record a reason for any status change other than "active." Listing owners may contact {{SUPPORT_EMAIL}} to dispute a moderation decision.

## 4. Enforcement

Violations of this policy may result in content or listing removal, account suspension, forfeiture of eligibility for the current campaign's ranking (without affecting the finality of already-processed payments, per our [Refund & Cancellation Policy](/refund-policy)), and, for serious or repeated violations, permanent account termination. Where required by law, we may also report certain violations (e.g. fraud, exploitation of minors) to appropriate authorities.
`,
  },
  {
    policyType: "refund_policy",
    title: "Refund & Cancellation Policy",
    content: `# Refund & Cancellation Policy

_Last updated: see the date shown on this page._

This policy explains how payments, bids, and campaign fees work on the Service, and when a refund may be available. It does not limit any statutory right you have under applicable consumer-protection law, which always takes precedence over anything stated here.

## 1. What you are paying for

- **Owner bids** increase a listing's effective bid to influence its position in the current campaign's ranking. The benefit (inclusion in that campaign's ranking calculation) begins immediately once your payment is verified.
- **Community bids** ("support") let a community member back a listing they believe in during the current campaign window. Once verified, the associated ranking benefit is applied immediately for the remainder of that campaign.
- **Campaign claim fees**, where applicable, cover verification and inclusion of a listing in a specific weekly campaign window.

Because these benefits are delivered immediately and automatically upon verified payment, and the campaign window itself is time-boxed and cannot be "rewound" once activity has occurred within it, most successfully processed payments are **not eligible for a discretionary refund once the ranking benefit has been applied**, except as described below.

## 2. When a refund may be available

We may issue a refund, in whole or in part, where:

- You were charged more than once for the same bid or claim due to a technical error (duplicate charge).
- A payment was verified as fraudulent or unauthorized (e.g. unauthorized card use), subject to our review.
- A technical failure on our end prevented the paid benefit from being applied at all (e.g. payment verified but the ranking benefit never activated).
- Applicable law in your jurisdiction grants you a right to cancel or a refund that cannot be waived by agreement (for example, certain cooling-off periods for online purchases) — in that case, we will honor that right.

Community bid payments that were successfully processed and correctly applied to a listing's ranking are not reversed, even if the supporter later changes their mind, because the funds and the intended ranking effect have already been delivered to the recipient listing.

## 3. How to request a refund

Contact {{SUPPORT_EMAIL}} with your payment reference and the reason for your request. We aim to acknowledge refund requests promptly and will tell you the outcome and reasoning. Approved refunds reverse the specific ledger entry associated with the payment and are issued back through the original payment method where the processor supports it.

## 4. Cancellations

You may stop participating in a future campaign at any time by not placing further bids; there is no subscription to cancel. A payment already verified for the current campaign cannot be "cancelled" after the fact in the ordinary course — see Section 2 for the limited cases where a refund applies instead.

## 5. Payment disputes and chargebacks

If you dispute a charge directly with your bank or card issuer instead of contacting us first, we may need to suspend the related account or listing pending resolution, consistent with our payment processor's policies. We encourage you to contact {{SUPPORT_EMAIL}} first so we can resolve legitimate issues faster.
`,
  },
  {
    policyType: "community_guidelines",
    title: "Community Guidelines",
    content: `# Community Guidelines

_Last updated: see the date shown on this page._

These guidelines describe how we expect members, listing owners, and reviewers to behave on the Service, in addition to the [Website & Content Policy](/website-policy) and [Terms & Conditions](/terms).

## 1. Be honest

- Only submit a listing for a product you own or are authorized to represent.
- Write reviews, support signals, and penalty signals that reflect your genuine opinion or experience.
- Do not create multiple accounts, use bots, or coordinate with others to manipulate rankings, reviews, or reports.

## 2. Be respectful

- Disagree with a product or a review without harassment, personal attacks, or discriminatory language.
- Do not use the reporting system to target a competitor or individual in bad faith; false or abusive reports may themselves result in account action.

## 3. Bidding and reviewing in good faith

- Community bids and penalty signals are meant to reflect real support or real concerns about a listing, not a way to pay for artificial visibility outside the platform's ranking rules.
- Owner replies to reviews should address the substance of the feedback and must not include harassment, threats, or attempts to coerce a reviewer into changing or deleting a genuine review.

## 4. Reporting concerns

If you see a listing, review, or user behavior that violates these guidelines or the Website & Content Policy, use the "Report" action where available, or contact {{SUPPORT_EMAIL}}. Reports can be submitted anonymously and are reviewed by our moderation team.

## 5. Consequences

Depending on severity and history, violations of these guidelines may result in content removal, temporary restrictions, listing suspension, or account termination, following the moderation process described in the Website & Content Policy. We aim to apply consequences proportionate to the violation and to give listing owners a way to raise concerns via {{SUPPORT_EMAIL}}.
`,
  },
  {
    policyType: "grievance",
    title: "Grievance & Contact",
    content: `# Grievance & Contact

_Last updated: see the date shown on this page._

If you have a concern, complaint, or legal notice regarding content on the Service, or believe content about you or your product should be reviewed, please use the contact details below.

## Grievance Officer

- **Name:** {{GRIEVANCE_OFFICER_NAME}}
- **Email:** {{GRIEVANCE_OFFICER_EMAIL}}

## General support

- **Support email:** {{SUPPORT_EMAIL}}

## Business identity

- **Business name:** {{BUSINESS_NAME}}
- **Registered/business address:** {{BUSINESS_ADDRESS}}

## What to include in a grievance

To help us respond quickly, please include:

1. Your name and a way to reach you.
2. The specific listing, review, or page URL you are concerned about.
3. A clear description of the issue and, where relevant, which part of our [Website & Content Policy](/website-policy), [Community Guidelines](/community-guidelines), or [Terms & Conditions](/terms) you believe applies.
4. Any supporting evidence (screenshots, links, documentation).

## What happens next

We acknowledge grievances and aim to respond within the timeframe required by applicable law, or as promptly as reasonably possible where no specific deadline applies. If a report requires content moderation action, it will follow the process described in our Website & Content Policy.
`,
  },
];

export const DEFAULT_SITE_SETTINGS: Record<string, string> = {
  businessName: "",
  businessAddress: "",
  supportEmail: "",
  grievanceOfficerName: "",
  grievanceOfficerEmail: "",
  // Admin address that receives a copy of every generated invoice email.
  // Deliberately admin-configurable rather than hardcoded so no personal
  // email address ever ships in code.
  invoiceAdminEmail: "",
  // Empty/unset means "no tax configured" -- new invoices keep taxCents at
  // 0 exactly like before this feature existed. Stored as text like every
  // other site setting; parsed to a number only where it's used.
  taxRatePercent: "",
  taxRegistrationNumber: "",
  taxLabel: "",
  // Featured/Sponsored Listing product configuration. Empty means "use the
  // built-in default" (see DEFAULT_SPONSORSHIP_PRICE_CENTS/DEFAULT_
  // SPONSORSHIP_DURATION_DAYS in lib/sponsorships.ts) -- there is always a
  // usable price and duration even before an admin has ever configured one.
  sponsorshipPriceCents: "",
  sponsorshipDurationDays: "",
};
