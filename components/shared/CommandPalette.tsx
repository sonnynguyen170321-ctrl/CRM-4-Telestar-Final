"use client";

import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { Search, Building2, Target, LayoutDashboard, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const runCommand = (command: () => void) => {
    setOpen(false);
    command();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex justify-center pt-[10vh]">
      <Command.Dialog 
        open={open} 
        onOpenChange={setOpen}
        className="fixed z-50 w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl outline-none"
        shouldFilter={true}
      >
        <div className="flex items-center border-b border-border px-3">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <Command.Input 
            autoFocus
            placeholder="Type a command or search..." 
            className="flex h-12 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
        <Command.List className="max-h-[300px] overflow-y-auto overflow-x-hidden p-2 scrollbar-hide">
          <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
            No results found.
          </Command.Empty>
          
          <Command.Group heading="Navigation" className="px-2 text-xs font-medium text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
            <Command.Item 
              onSelect={() => runCommand(() => router.push("/v2/home"))}
              className="relative flex cursor-default select-none items-center rounded-sm px-2 py-2 text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground"
            >
              <LayoutDashboard className="mr-2 h-4 w-4" />
              <span>Go to Home</span>
            </Command.Item>
            <Command.Item 
              onSelect={() => runCommand(() => router.push("/v2/workspace/leads"))}
              className="relative flex cursor-default select-none items-center rounded-sm px-2 py-2 text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground"
            >
              <Target className="mr-2 h-4 w-4" />
              <span>Leads Command Center</span>
            </Command.Item>
            <Command.Item 
              onSelect={() => runCommand(() => router.push("/v2/workspace/projects"))}
              className="relative flex cursor-default select-none items-center rounded-sm px-2 py-2 text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground"
            >
              <Building2 className="mr-2 h-4 w-4" />
              <span>Accounts & Projects</span>
            </Command.Item>
          </Command.Group>
          
          <Command.Separator className="-mx-1 h-px bg-border my-1" />
          
          <Command.Group heading="Settings" className="px-2 text-xs font-medium text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
            <Command.Item 
              onSelect={() => runCommand(() => router.push("/v2/settings"))}
              className="relative flex cursor-default select-none items-center rounded-sm px-2 py-2 text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground"
            >
              <Settings className="mr-2 h-4 w-4" />
              <span>Settings</span>
            </Command.Item>
          </Command.Group>
        </Command.List>
      </Command.Dialog>
    </div>
  );
}
