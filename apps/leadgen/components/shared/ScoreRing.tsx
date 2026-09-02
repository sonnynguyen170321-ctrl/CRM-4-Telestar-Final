// Compact SVG score ring (0-100 fit score) with canonical tiering colors.
// Pure presentational; no emoji, fixed sizes, accessible label.

type ScoreRingProps = {
  score: number; // 0-100
  size?: "sm" | "md" | "lg";
  label?: string;
};

const SIZES = {
  sm: { px: 36, stroke: 4, text: "text-xs" },
  md: { px: 56, stroke: 5, text: "text-sm" },
  lg: { px: 80, stroke: 6, text: "text-base" },
} as const;

function tierColor(score: number): string {
  if (score >= 75) return "#16A34A"; // success
  if (score >= 45) return "#F59E0B"; // warning
  return "#EF4444"; // danger
}

export function ScoreRing({ score, size = "md", label }: ScoreRingProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const { px, stroke, text } = SIZES[size];
  const radius = (px - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);
  const color = tierColor(clamped);

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: px, height: px }}
      role="img"
      aria-label={`${label ? `${label}: ` : ""}fit score ${clamped} of 100`}
    >
      <svg width={px} height={px} className="-rotate-90">
        <circle cx={px / 2} cy={px / 2} r={radius} fill="none" stroke="#E5EAF2" strokeWidth={stroke} />
        <circle
          cx={px / 2}
          cy={px / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span className={`absolute font-semibold tabular-nums text-[#0F172A] ${text}`}>{clamped}</span>
    </div>
  );
}
