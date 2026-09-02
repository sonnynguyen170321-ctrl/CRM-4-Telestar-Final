import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

type V2ActionButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type V2ActionButtonSize = "sm" | "md";

const variantClassName: Record<V2ActionButtonVariant, string> = {
  primary:
    "bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring/30",
  secondary:
    "border border-border bg-card text-foreground hover:bg-muted focus-visible:ring-ring/20",
  ghost:
    "text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/20",
  danger:
    "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/30",
};

const sizeClassName: Record<V2ActionButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-3 text-sm",
};

const baseClassName =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-md font-medium shadow-xs transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: V2ActionButtonVariant;
  size?: V2ActionButtonSize;
};

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  children: ReactNode;
  href: string;
  variant?: V2ActionButtonVariant;
  size?: V2ActionButtonSize;
};

export function V2ActionButton({
  children,
  className,
  variant = "primary",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(baseClassName, variantClassName[variant], sizeClassName[size], className)}
      {...props}
    >
      {children}
    </button>
  );
}

export function V2ActionLink({
  children,
  className,
  variant = "primary",
  size = "md",
  href,
  ...props
}: LinkProps) {
  return (
    <Link
      href={href}
      className={cn(baseClassName, variantClassName[variant], sizeClassName[size], className)}
      {...props}
    >
      {children}
    </Link>
  );
}
