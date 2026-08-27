import { useRef, useState } from "react";
import type {
  LogoUploadUrlRequestContentType,
  LogoUploadUrlResponse,
} from "@workspace/api-client-react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListingAvatar } from "@/components/listing-avatar";

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const ALLOWED_LOGO_TYPES = new Set<LogoUploadUrlRequestContentType>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);

type LogoUploadControlProps = {
  logoUrl: string | null | undefined;
  initials: string;
  accent: string;
  listingName: string;
  requestUploadUrl: (file: File) => Promise<LogoUploadUrlResponse>;
  saveLogoUrl: (logoUrl: string | null) => Promise<void>;
  onSaved?: (logoUrl: string | null) => void;
};

export function LogoUploadControl({
  logoUrl,
  initials,
  accent,
  listingName,
  requestUploadUrl,
  saveLogoUrl,
  onSaved,
}: LogoUploadControlProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    setError(null);

    if (!ALLOWED_LOGO_TYPES.has(file.type as LogoUploadUrlRequestContentType)) {
      setError("Choose a PNG, JPG, WebP, or SVG image.");
      return;
    }
    if (file.size <= 0 || file.size > MAX_LOGO_BYTES) {
      setError("Logo images must be smaller than 5 MB.");
      return;
    }

    setBusy(true);
    try {
      const upload = await requestUploadUrl(file);
      const response = await fetch(upload.uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) throw new Error("The image upload did not complete.");

      await saveLogoUrl(upload.objectPath);
      onSaved?.(upload.objectPath);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Could not upload the logo.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function removeLogo() {
    setBusy(true);
    setError(null);
    try {
      await saveLogoUrl(null);
      onSaved?.(null);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Could not remove the logo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-background/50 p-3">
      <div className="flex items-center gap-3">
        <ListingAvatar
          logoUrl={logoUrl}
          initials={initials}
          accent={accent}
          alt={`${listingName} logo`}
          className="h-14 w-14 shrink-0 text-lg"
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wider">Product logo</p>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            PNG, JPG, WebP, or SVG. Maximum 5 MB.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="sr-only"
              onChange={(event) => void chooseFile(event.target.files?.[0])}
              disabled={busy}
              data-testid="input-listing-logo"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-[10px] font-bold uppercase tracking-wider"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              data-testid="button-upload-listing-logo"
            >
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="mr-1.5 h-3.5 w-3.5" />}
              {logoUrl ? "Replace logo" : "Upload logo"}
            </Button>
            {logoUrl ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-[10px] font-bold uppercase tracking-wider text-destructive hover:text-destructive"
                onClick={() => void removeLogo()}
                disabled={busy}
                data-testid="button-remove-listing-logo"
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remove
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}