import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

// Mirrors artifacts/api-server/src/lib/accent-colors.ts ACCENT_PALETTE (the
// auto-assigned defaults) plus a few extra swatches, all guaranteed-valid
// 6-digit hex so a listing's brand accent always renders. Owners can also
// type any other hex value in the custom field below.
export const BRAND_COLOR_SWATCHES = [
  "#FF7A5C", // coral
  "#8B5CF6", // violet
  "#3B82F6", // blue
  "#2DD4BF", // mint
  "#F59E0B", // amber
  "#EC4899", // pink
  "#10B981", // emerald
  "#EF4444", // red
] as const;

export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function isValidHexColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value.trim());
}

export function BrandColorPicker({
  value,
  onChange,
  label = "Brand color",
  testIdPrefix = "brand-color",
}: {
  value: string;
  onChange: (next: string) => void;
  label?: string;
  testIdPrefix?: string;
}) {
  const trimmed = value.trim();
  const valid = isValidHexColor(trimmed);

  return (
    <div className="space-y-2">
      <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</Label>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {BRAND_COLOR_SWATCHES.map((swatch) => {
          const selected = valid && trimmed.toLowerCase() === swatch.toLowerCase();
          return (
            <button
              key={swatch}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={swatch}
              onClick={() => onChange(swatch)}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-full border-2 transition-transform hover:scale-105",
                selected ? "border-foreground" : "border-transparent",
              )}
              style={{ backgroundColor: swatch }}
              data-testid={`${testIdPrefix}-swatch-${swatch.replace("#", "")}`}
            >
              {selected && <Check className="h-4 w-4 text-white drop-shadow" />}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <span
          className={cn("h-9 w-9 flex-none rounded-md border border-border/60", !valid && "opacity-30")}
          style={{ backgroundColor: valid ? trimmed : undefined }}
        />
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="#FF7A5C"
          maxLength={7}
          className="h-9 flex-1 font-mono text-sm uppercase"
          data-testid={`${testIdPrefix}-hex-input`}
        />
      </div>
      {!valid && trimmed.length > 0 && (
        <p className="text-[10px] font-medium text-destructive">
          Enter a 6-digit hex color, e.g. #FF7A5C.
        </p>
      )}
      <p className="text-[10px] text-muted-foreground">
        Pick a swatch or type any hex color. Leave the default if you're not sure.
      </p>
    </div>
  );
}
