import { SignIn } from '@clerk/react';
import { hasResumableOwnerClaim } from '@/lib/pending-owner-claim';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const claimReturnUrl = `${basePath || ''}/?resume-owner-claim=1`;
const dashboardUrl = `${basePath}/owner/dashboard`;

export default function OwnerSignInPage() {
  // Clerk's own <SignUp> silently continues as a sign-in when the entered
  // email already has an account, landing the user on THIS component even
  // though they started on the sign-up page mid owner-claim flow. Without
  // this check, that (very common -- any returning owner) path redirected to
  // the dashboard and dropped the pending claim, forcing the user to
  // manually navigate back and re-enter everything. Checking for a
  // resumable claim here mirrors owner-sign-up.tsx so either component
  // completing the auth still lands back on the claim-resume screen.
  const forceRedirectUrl = hasResumableOwnerClaim() ? claimReturnUrl : dashboardUrl;
  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-4 py-10">
      <SignIn
        routing="path"
        path={`${basePath}/owner/sign-in`}
        signUpUrl={`${basePath}/owner/sign-up`}
        forceRedirectUrl={forceRedirectUrl}
      />
    </div>
  );
}
