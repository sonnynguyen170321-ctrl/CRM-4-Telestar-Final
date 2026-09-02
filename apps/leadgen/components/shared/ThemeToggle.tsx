"use client";

import { Moon, Sun, Monitor, Palette } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ThemeToggle() {
  const { setTheme, theme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Mount guard for SSR/hydration — the one-shot setState here is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="h-8 w-8 animate-pulse rounded-md bg-muted" />;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border border-hairline bg-surface text-muted-foreground shadow-sm transition-all duration-300 hover:bg-surface-raised hover:text-primary hover:border-hairline"
          title="Toggle theme"
        >
          {theme === "light" && <Sun className="h-4 w-4" />}
          {theme === "dark" && <Moon className="h-4 w-4" />}
          {theme === "midnight" && <Palette className="h-4 w-4 text-indigo-500" />}
          {theme === "dim" && <Palette className="h-4 w-4 text-muted-foreground" />}
          {theme === "system" && <Monitor className="h-4 w-4" />}
          <span className="sr-only">Toggle theme</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")} className="gap-2 cursor-pointer">
          <Sun className="h-4 w-4" /> Light
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")} className="gap-2 cursor-pointer">
          <Moon className="h-4 w-4" /> Dark
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("midnight")} className="gap-2 cursor-pointer text-indigo-600 focus:text-indigo-700 focus:bg-indigo-50">
          <Palette className="h-4 w-4" /> Midnight (Premium)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dim")} className="gap-2 cursor-pointer text-muted-foreground focus:text-foreground focus:bg-muted">
          <Palette className="h-4 w-4" /> Dim (Premium)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")} className="gap-2 cursor-pointer">
          <Monitor className="h-4 w-4" /> System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
