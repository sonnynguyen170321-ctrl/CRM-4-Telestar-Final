import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type WorkspaceFrameProps = {
  children: ReactNode;
  className?: string;
};

export function WorkspaceFrame({ children, className }: WorkspaceFrameProps) {
  return (
    <div
      className={cn(
        "-m-5 min-h-[calc(100vh-4rem)] p-5 sm:-m-6 sm:p-6 lg:-mx-8 lg:-my-5 lg:px-8 lg:py-5",
        className
      )}
    >
      {children}
    </div>
  );
}
