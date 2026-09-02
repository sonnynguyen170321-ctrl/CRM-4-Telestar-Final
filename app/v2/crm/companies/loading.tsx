import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";

export default function V2CompaniesLoading() {
  return (
    <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0">
      <div className="border-b border-border bg-white px-6 py-5">
        <div className="h-4 w-24 rounded-md bg-muted" />
        <div className="mt-3 h-7 w-72 rounded-md bg-muted" />
        <div className="mt-2 h-4 w-full max-w-lg rounded-md bg-muted" />
      </div>
      <main className="grid gap-5 px-6 py-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <section className="space-y-4">
          <div className="rounded-lg border border-border bg-white p-4">
            <div className="h-4 w-32 rounded-md bg-muted" />
            <div className="mt-4 h-9 rounded-md bg-muted" />
            <div className="mt-3 h-9 rounded-md bg-muted" />
          </div>
          <div className="rounded-lg border border-border bg-white">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="border-b border-border p-4">
                <div className="h-4 w-48 rounded-md bg-muted" />
                <div className="mt-2 h-3 w-32 rounded-md bg-muted" />
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  <div className="h-10 rounded-md bg-muted" />
                  <div className="h-10 rounded-md bg-muted" />
                  <div className="h-10 rounded-md bg-muted" />
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="space-y-4">
          <div className="h-36 rounded-lg border border-border bg-white p-5">
            <div className="h-5 w-64 rounded-md bg-muted" />
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="h-16 rounded-md bg-muted" />
              <div className="h-16 rounded-md bg-muted" />
              <div className="h-16 rounded-md bg-muted" />
            </div>
          </div>
          <div className="h-80 rounded-lg border border-border bg-white p-5">
            <div className="h-5 w-40 rounded-md bg-muted" />
            <div className="mt-5 h-20 rounded-md bg-muted" />
            <div className="mt-4 h-32 rounded-md bg-muted" />
          </div>
        </section>
      </main>
    </WorkspaceFrame>
  );
}
