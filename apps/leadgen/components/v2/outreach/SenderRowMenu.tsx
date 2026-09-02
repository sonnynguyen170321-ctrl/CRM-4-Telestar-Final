"use client";

import { useState, useTransition } from "react";
import { Ban, Pencil } from "lucide-react";

import { disableSenderAction, updateSenderDisplayAction } from "@/app/v2/outreach/senders/manageActions";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { RowMenu, type RowMenuItem } from "@/components/shared/RowMenu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Sender kebab: edit display identity + disable (soft). Address/credential changes require
// creating a new sender — stated in the edit dialog so the limitation is explicit.

export function SenderRowMenu({
  senderId,
  displayName,
  fromName,
  fromAddress,
}: {
  senderId: string;
  displayName: string;
  fromName: string | null;
  fromAddress: string;
}) {
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameValue, setNameValue] = useState(displayName);
  const [fromNameValue, setFromNameValue] = useState(fromName ?? "");

  const items: RowMenuItem[] = [
    { kind: "item", label: "Edit identity", icon: <Pencil className="mr-2 h-3.5 w-3.5" aria-hidden="true" />, onSelect: () => { setError(null); setNameValue(displayName); setFromNameValue(fromName ?? ""); setEditOpen(true); } },
    { kind: "separator" },
    { kind: "item", label: "Disable sender", icon: <Ban className="mr-2 h-3.5 w-3.5" aria-hidden="true" />, destructive: true, onSelect: () => setConfirmOpen(true) },
  ];

  function submitEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("senderId", senderId);
    fd.set("displayName", nameValue);
    fd.set("fromName", fromNameValue);
    startTransition(async () => {
      const res = await updateSenderDisplayAction(fd);
      if (res.ok) setEditOpen(false);
      else setError(res.error);
    });
  }

  return (
    <>
      <RowMenu items={items} label={`Actions for ${displayName}`} />

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit sender identity</DialogTitle>
            <DialogDescription>
              {fromAddress} — the address, SMTP host, and credentials are fixed per sender;
              create a new sender to change them.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitEdit} className="space-y-3">
            {error ? <div className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Display name
              <Input value={nameValue} onChange={(e) => setNameValue(e.target.value)} required aria-label="Display name" />
            </label>
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              From name (shown to recipients)
              <Input value={fromNameValue} onChange={(e) => setFromNameValue(e.target.value)} placeholder="e.g. Anna from Acme" aria-label="From name" />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={pending || !nameValue.trim()}>{pending ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Disable sender?"
        description={`"${displayName}" (${fromAddress}) stops sending and disappears from pools. Blocked while it is in an active campaign's pool.`}
        confirmLabel="Disable"
        onConfirm={async () => {
          const fd = new FormData();
          fd.set("senderId", senderId);
          const res = await disableSenderAction(fd);
          if (!res.ok) throw new Error(res.error);
        }}
      />
    </>
  );
}
