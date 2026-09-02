"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Copy, Pencil, Trash2 } from "lucide-react";

import {
  archiveCampaignAction,
  deleteCampaignAction,
  duplicateCampaignAction,
  renameCampaignAction,
} from "@/app/v2/outreach/campaigns/lifecycleActions";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { RowMenu, type RowMenuItem } from "@/components/shared/RowMenu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// The campaign kebab (Instantly-style row lifecycle): rename / duplicate / archive /
// delete. Status rules live server-side in campaignLifecycle; this surfaces them with
// the shared RowMenu + ConfirmDialog primitives. Duplicate navigates to the new draft.

export function CampaignRowMenu({
  campaignId,
  name,
  status,
}: {
  campaignId: string;
  name: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [renameOpen, setRenameOpen] = useState(false);
  const [confirm, setConfirm] = useState<"archive" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState(name);

  const fd = () => {
    const data = new FormData();
    data.set("campaignId", campaignId);
    return data;
  };

  const items: RowMenuItem[] = [
    { kind: "item", label: "Rename", icon: <Pencil className="mr-2 h-3.5 w-3.5" aria-hidden="true" />, onSelect: () => { setError(null); setRenameValue(name); setRenameOpen(true); } },
    { kind: "item", label: "Duplicate", icon: <Copy className="mr-2 h-3.5 w-3.5" aria-hidden="true" />, disabled: pending, onSelect: () => {
      startTransition(async () => {
        const res = await duplicateCampaignAction(fd());
        if (res.ok) router.push(`/v2/outreach/campaigns/${res.campaignId}`);
      });
    } },
    { kind: "separator" },
    { kind: "item", label: "Archive", icon: <Archive className="mr-2 h-3.5 w-3.5" aria-hidden="true" />, disabled: status === "ARCHIVED" || status === "ACTIVE", onSelect: () => setConfirm("archive") },
    { kind: "item", label: "Delete", icon: <Trash2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" />, destructive: true, disabled: status !== "DRAFT" && status !== "ARCHIVED", onSelect: () => setConfirm("delete") },
  ];

  function submitRename(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = fd();
    data.set("name", renameValue);
    startTransition(async () => {
      const res = await renameCampaignAction(data);
      if (res.ok) setRenameOpen(false);
      else setError(res.error);
    });
  }

  return (
    <>
      <RowMenu items={items} label={`Actions for ${name}`} />

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rename campaign</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitRename} className="space-y-3">
            {error ? <div className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
            <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus maxLength={200} aria-label="Campaign name" />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenameOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={pending || !renameValue.trim()}>{pending ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirm === "archive"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Archive campaign?"
        description={`"${name}" stops appearing in active lists; its send history stays intact. You can still delete it later.`}
        confirmLabel="Archive"
        tone="default"
        onConfirm={async () => {
          const res = await archiveCampaignAction(fd());
          if (!res.ok) throw new Error(res.error);
        }}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Delete campaign?"
        description={`"${name}" will be removed from all lists (soft delete). This cannot be undone from the UI.`}
        confirmLabel="Delete"
        onConfirm={async () => {
          const res = await deleteCampaignAction(fd());
          if (!res.ok) throw new Error(res.error);
          router.push("/v2/outreach/campaigns");
        }}
      />
    </>
  );
}
