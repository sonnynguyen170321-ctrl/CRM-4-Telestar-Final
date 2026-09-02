"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Building2, Target, Globe, Users, Radar, FileUp, ClipboardList, Mail } from "lucide-react";

import { ROUTES } from "@/lib/v2/routes";

export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const runCommand = React.useCallback(
    (command: () => unknown) => {
      setOpen(false);
      command();
    },
    []
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        
        <CommandGroup heading="Workspace">
          <CommandItem onSelect={() => runCommand(() => router.push(ROUTES.WORKSPACE_LEADS))}>
            <Target className="mr-2 h-4 w-4" />
            <span>Leads Command Center</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => router.push(`${ROUTES.WORKSPACE_ACCOUNTS}?view=projects`))}>
            <Building2 className="mr-2 h-4 w-4" />
            <span>Accounts & Projects</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Index">
          <CommandItem onSelect={() => runCommand(() => router.push(ROUTES.CRM_COMPANIES))}>
            <Globe className="mr-2 h-4 w-4" />
            <span>Companies</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => router.push(ROUTES.CRM_CONTACTS))}>
            <Users className="mr-2 h-4 w-4" />
            <span>Contacts</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => router.push(ROUTES.RESEARCH))}>
            <Radar className="mr-2 h-4 w-4" />
            <span>Intelligence Research</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Data Engine">
          <CommandItem onSelect={() => runCommand(() => router.push(ROUTES.INGESTION_UPLOADS))}>
            <FileUp className="mr-2 h-4 w-4" />
            <span>Upload New Data</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => router.push(ROUTES.INGESTION_JOBS))}>
            <ClipboardList className="mr-2 h-4 w-4" />
            <span>View Job Pipeline</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Outreach">
          <CommandItem onSelect={() => runCommand(() => router.push(ROUTES.OUTREACH_CAMPAIGNS))}>
            <Mail className="mr-2 h-4 w-4" />
            <span>Manage Campaigns</span>
          </CommandItem>
        </CommandGroup>
        
      </CommandList>
    </CommandDialog>
  );
}
