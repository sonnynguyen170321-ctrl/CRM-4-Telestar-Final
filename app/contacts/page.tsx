import { ContactsWorkspace } from "@/components/contacts/ContactsWorkspace";
import { PageHeader } from "@/components/shared/PageHeader";

export default function ContactsPage() {
  return (
    <main className="min-h-screen bg-slate-50">
      <PageHeader
        eyebrow="SDR operating system"
        title="Contacts"
        description="Review synced contacts, company links, activity context, and manager review status."
      />
      <ContactsWorkspace />
    </main>
  );
}
