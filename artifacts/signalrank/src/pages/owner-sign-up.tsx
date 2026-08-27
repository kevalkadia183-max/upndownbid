import { SignUp } from '@clerk/react';
import { hasResumableOwnerClaim } from '@/lib/pending-owner-claim';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const claimReturnUrl = `${basePath || ''}/?resume-owner-claim=1`;
const defaultReturnUrl = `${basePath || ''}/`;

export default function OwnerSignUpPage() {
  // Only route back to the claim-resume screen when a claim is actually
  // waiting -- a visitor who reaches sign-up some other way should land on
  // the homepage like a normal sign-up, not on a resume marker with nothing
  // to resume.
  const forceRedirectUrl = hasResumableOwnerClaim() ? claimReturnUrl : defaultReturnUrl;
  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-4 py-10">
      <SignUp
        routing="path"
        path={`${basePath}/owner/sign-up`}
        signInUrl={`${basePath}/owner/sign-in`}
        forceRedirectUrl={forceRedirectUrl}
      />
    </div>
  );
}
