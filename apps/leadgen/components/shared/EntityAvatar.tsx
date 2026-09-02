import { cn } from "@/lib/utils";

type EntityAvatarProps = {
  name: string | null | undefined;
  label?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
  tone?: "blue" | "slate" | "emerald" | "amber" | "violet";
};

const sizeClass = {
  sm: "h-7 w-7 text-[11px]",
  md: "h-9 w-9 text-xs",
  lg: "h-11 w-11 text-sm",
};

const toneClass = {
  blue: "bg-blue-600 text-white",
  slate: "bg-slate-100 text-slate-700",
  emerald: "bg-emerald-600 text-white",
  amber: "bg-amber-500 text-white",
  violet: "bg-violet-600 text-white",
};

export function EntityAvatar({
  name,
  label,
  className,
  size = "md",
  tone = "blue",
}: EntityAvatarProps) {
  const displayName = label ?? name ?? "Unknown";

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md font-semibold",
        sizeClass[size],
        toneClass[tone],
        className
      )}
      aria-label={displayName}
      title={displayName}
    >
      {getInitials(name)}
    </div>
  );
}

function getInitials(value: string | null | undefined) {
  const words = value
    ?.trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (!words || words.length === 0) {
    return "--";
  }

  return words.map((word) => word[0]?.toUpperCase()).join("");
}
