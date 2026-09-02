import { CheckCircle2, CircleDashed } from "lucide-react";

const checklistItems = [
  {
    label: "Required fields mapped",
    description: "Company Name and Website are visible in the static mapping.",
    complete: true,
  },
  {
    label: "Optional fields can be skipped",
    description: "Phone and notes are helpful but not blocking in this preview.",
    complete: true,
  },
  {
    label: "Lead-level fields ignored for now",
    description: "Lead Name and Title stay out of company-first processing.",
    complete: true,
  },
  {
    label: "Ready for parsing later",
    description: "Prompt 9 will add local CSV parsing after the UI is stable.",
    complete: false,
  },
];

export function MappingChecklist() {
  return (
    <div className="rounded-md border bg-background p-4">
      <h3 className="text-sm font-medium text-foreground">Mapping checklist</h3>
      <div className="mt-4 space-y-3">
        {checklistItems.map((item) => {
          const Icon = item.complete ? CheckCircle2 : CircleDashed;

          return (
            <div key={item.label} className="flex gap-3">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {item.label}
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {item.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
