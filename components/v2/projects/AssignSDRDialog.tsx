"use client";

import * as React from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { updateProjectOwner, addProjectTeamMember, removeProjectTeamMember } from "@/app/v2/workspace/projects/[projectId]/actions";
import { toast } from "sonner";

type UserBasic = {
  id: string;
  name: string | null;
  email: string;
};

type AssignSDRTeamMember = { userId: string; user: { name: string | null } };
type AssignSDRProject = {
  id: string;
  name: string;
  ownerUserId: string | null;
  teamMembers: AssignSDRTeamMember[];
};

export function AssignSDRDialog({
  project,
  users
}: {
  project: AssignSDRProject;
  users: UserBasic[];
}) {
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();
  const router = useRouter();

  const getInitials = (name: string | null) => name ? name.substring(0, 2).toUpperCase() : "U";

  const handleOwnerChange = (userId: string) => {
    startTransition(async () => {
      try {
        await updateProjectOwner(project.id, userId === "none" ? null : userId);
        toast.success("Owner updated successfully");
        router.refresh();
      } catch {
        toast.error("Failed to update owner");
      }
    });
  };

  const handleAddTeamMember = (userId: string) => {
    startTransition(async () => {
      try {
        await addProjectTeamMember(project.id, userId);
        toast.success("Team member added");
        router.refresh();
      } catch {
        toast.error("Failed to add team member");
      }
    });
  };

  const handleRemoveTeamMember = (userId: string) => {
    startTransition(async () => {
      try {
        await removeProjectTeamMember(project.id, userId);
        toast.success("Team member removed");
        router.refresh();
      } catch {
        toast.error("Failed to remove team member");
      }
    });
  };

  const currentTeamIds = project.teamMembers.map((tm) => tm.userId);
  const availableUsersForTeam = users.filter(u => !currentTeamIds.includes(u.id));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full bg-muted hover:bg-muted text-muted-foreground">
          <PlusIcon className="h-3 w-3" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Assign Team & Owner</DialogTitle>
          <DialogDescription>
            Manage who is working on {project.name}.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-4">
          
          <div className="space-y-3">
            <h4 className="text-sm font-medium">Project Owner</h4>
            <Select 
              value={project.ownerUserId || "none"} 
              onValueChange={handleOwnerChange}
              disabled={isPending}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select an owner" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {users.map(u => (
                  <SelectItem key={u.id} value={u.id}>
                    <div className="flex items-center gap-2">
                      <Avatar className="h-4 w-4"><AvatarFallback className="text-[8px]">{getInitials(u.name)}</AvatarFallback></Avatar>
                      {u.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-medium">Team Members ({project.teamMembers.length})</h4>
            
            <div className="border rounded-md divide-y max-h-[150px] overflow-y-auto">
              {project.teamMembers.length === 0 ? (
                <div className="p-3 text-sm text-muted-foreground text-center italic">No team members</div>
              ) : (
                project.teamMembers.map((tm) => (
                  <div key={tm.userId} className="flex justify-between items-center p-2">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-6 w-6"><AvatarFallback className="text-[10px]">{getInitials(tm.user.name)}</AvatarFallback></Avatar>
                      <span className="text-sm font-medium">{tm.user.name}</span>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemoveTeamMember(tm.userId)}
                      disabled={isPending}
                    >
                      <XIcon className="h-3 w-3" />
                    </Button>
                  </div>
                ))
              )}
            </div>

            <Select 
              value="" 
              onValueChange={handleAddTeamMember}
              disabled={isPending || availableUsersForTeam.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder={availableUsersForTeam.length > 0 ? "Add team member..." : "All users are in team"} />
              </SelectTrigger>
              <SelectContent>
                {availableUsersForTeam.map(u => (
                  <SelectItem key={u.id} value={u.id}>
                    <div className="flex items-center gap-2">
                      <Avatar className="h-4 w-4"><AvatarFallback className="text-[8px]">{getInitials(u.name)}</AvatarFallback></Avatar>
                      {u.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}
