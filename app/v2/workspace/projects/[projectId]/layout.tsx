import * as React from "react";
import { notFound } from "next/navigation";
import { FileBoxIcon, CalendarIcon } from "lucide-react";

import { requireTenantContext } from "@/lib/v2/tenant/requireTenantContext";
import { prisma } from "@/lib/server/prisma";

import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AssignSDRDialog } from "@/components/v2/projects/AssignSDRDialog";
import { ProjectTabs } from "./ProjectTabs";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const context = await requireTenantContext();
  const { projectId } = await params;

  // We only fetch core metadata here.
  const project = await prisma.v2Project.findUnique({
    where: { id: projectId, organizationId: context.organizationId },
    include: {
      clientAccount: true,
      ownerUser: true,
      teamMembers: {
        include: { user: true }
      }
    }
  });

  if (!project) {
    notFound();
  }

  // Fetch all users for SDR assignment
  const allUsers = await prisma.v2User.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" }
  });

  const getInitials = (name: string | null) => name ? name.substring(0, 2).toUpperCase() : "U";

  return (
    <div className="flex h-full flex-col bg-muted/50">
      {/* Premium Header */}
      <div className="bg-white border-b px-6 py-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between md:items-start gap-6">
          <div className="flex items-start gap-4">
            <div className="h-16 w-16 bg-primary/10 text-primary rounded-2xl flex items-center justify-center flex-shrink-0">
              <FileBoxIcon className="h-8 w-8" />
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
                <Badge variant={project.stage === 'IN_PROGRESS' ? 'default' : 'secondary'} className="rounded-full px-3">
                  {project.stage.replace('_', ' ')}
                </Badge>
              </div>
              <p className="text-muted-foreground">Account: {project.clientAccount.name}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-8 bg-muted/40 rounded-xl border p-4">
            {/* Owner */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Owner</span>
              {project.ownerUser ? (
                <div className="flex items-center gap-2">
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className="text-[10px]">{getInitials(project.ownerUser.name)}</AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium">{project.ownerUser.name}</span>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground italic">Unassigned</span>
              )}
            </div>

            <div className="w-px h-8 bg-border hidden sm:block"></div>

            {/* Timeline */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Timeline</span>
              <div className="flex items-center gap-2">
                <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {project.startDate ? project.startDate.toLocaleDateString() : 'TBD'} - {project.endDate ? project.endDate.toLocaleDateString() : 'TBD'}
                </span>
              </div>
            </div>

            <div className="w-px h-8 bg-border hidden sm:block"></div>

            {/* Team */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Team</span>
                <AssignSDRDialog project={project} users={allUsers} />
              </div>
              <div className="flex items-center -space-x-2">
                {project.teamMembers.length > 0 ? (
                  <>
                    {project.teamMembers.slice(0, 3).map((tm) => (
                      <Avatar key={tm.userId} className="h-6 w-6 border-2 border-white">
                        <AvatarFallback className="text-[10px] bg-muted">{getInitials(tm.user.name)}</AvatarFallback>
                      </Avatar>
                    ))}
                    {project.teamMembers.length > 3 && (
                      <div className="h-6 w-6 rounded-full border-2 border-white bg-muted flex items-center justify-center text-[10px] font-medium">
                        +{project.teamMembers.length - 3}
                      </div>
                    )}
                  </>
                ) : (
                  <span className="text-sm text-muted-foreground italic ml-2">No team</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <ProjectTabs projectId={projectId} />

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-7xl mx-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
