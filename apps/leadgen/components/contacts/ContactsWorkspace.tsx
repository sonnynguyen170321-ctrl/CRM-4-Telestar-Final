"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  Eye,
  Link2,
  Mail,
  MoreHorizontal,
  Phone,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Upload,
  Users,
  X,
} from "lucide-react";

import { EntityAvatar } from "@/components/shared/EntityAvatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getContact,
  listContacts,
  type ContactDetail,
  type ContactListItem,
  type ContactListResponse,
} from "@/lib/client/contacts";
import { cn } from "@/lib/utils";

const PAGE_SIZE_OPTIONS = [20, 50, 100];

type DraftFilters = {
  search: string;
  sdrName: string;
  companyMatch: string;
  managerReview: string;
  source: string;
  contactData: string;
  meetingStatus: string;
};

const defaultFilters: DraftFilters = {
  search: "",
  sdrName: "",
  companyMatch: "",
  managerReview: "",
  source: "",
  contactData: "",
  meetingStatus: "",
};

export function ContactsWorkspace() {
  const [draftFilters, setDraftFilters] = useState(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState(defaultFilters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [response, setResponse] = useState<ContactListResponse | null>(null);
  const [selectedContactId, setSelectedContactId] = useState<
    string | null | undefined
  >(undefined);
  const [selectedDetail, setSelectedDetail] = useState<ContactDetail | null>(
    null
  );
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadContacts = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const nextResponse = await listContacts({
        search: appliedFilters.search,
        sdrName: appliedFilters.sdrName,
        hasCompanyMatch:
          appliedFilters.companyMatch === ""
            ? undefined
            : appliedFilters.companyMatch === "matched",
        hasManagerReview:
          appliedFilters.managerReview === ""
            ? undefined
            : appliedFilters.managerReview === "needs_review",
        page,
        pageSize,
      });
      setResponse(nextResponse);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Contacts could not be loaded."
      );
    } finally {
      setIsLoading(false);
    }
  }, [appliedFilters, page, pageSize]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadContacts();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadContacts]);

  const contacts = useMemo(() => response?.data ?? [], [response]);
  const visibleContacts = useMemo(() => {
    return contacts.filter((contact) => {
      if (appliedFilters.source && contact.source !== appliedFilters.source) {
        return false;
      }

      if (appliedFilters.contactData === "has_email" && !contact.email) {
        return false;
      }

      if (appliedFilters.contactData === "has_phone" && !contact.phone) {
        return false;
      }

      if (
        appliedFilters.contactData === "has_linkedin" &&
        !contact.contactLinkedInUrl
      ) {
        return false;
      }

      if (
        appliedFilters.meetingStatus === "meeting" &&
        !hasMeetingSignal(contact)
      ) {
        return false;
      }

      if (
        appliedFilters.meetingStatus === "none" &&
        hasMeetingSignal(contact)
      ) {
        return false;
      }

      return true;
    });
  }, [appliedFilters, contacts]);

  const activeSelectedContactId = useMemo(() => {
    if (selectedContactId === null) {
      return null;
    }

    if (
      selectedContactId &&
      visibleContacts.some((contact) => contact.id === selectedContactId)
    ) {
      return selectedContactId;
    }

    return visibleContacts[0]?.id ?? null;
  }, [selectedContactId, visibleContacts]);

  useEffect(() => {
    if (!activeSelectedContactId) {
      return;
    }

    let isCurrent = true;
    queueMicrotask(() => {
      if (isCurrent) {
        setIsDetailLoading(true);
        setDetailError(null);
      }
    });

    getContact(activeSelectedContactId)
      .then((contact) => {
        if (isCurrent) {
          setSelectedDetail(contact);
        }
      })
      .catch((error) => {
        if (isCurrent) {
          setDetailError(
            error instanceof Error
              ? error.message
              : "Contact detail could not be loaded."
          );
          setSelectedDetail(null);
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsDetailLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [activeSelectedContactId]);

  const sdrOptions = useMemo(() => {
    return Array.from(
      new Set(
        contacts
          .flatMap((contact) => [contact.ownerSdrName, contact.latestSdrName])
          .filter((value): value is string => Boolean(value))
      )
    ).sort((a, b) => a.localeCompare(b));
  }, [contacts]);

  const sourceOptions = useMemo(() => {
    return Array.from(new Set(contacts.map((contact) => contact.source))).sort(
      (a, b) => a.localeCompare(b)
    );
  }, [contacts]);

  const total = response?.pagination.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);
  const counts = response?.counts;
  const selectedContact = activeSelectedContactId
    ? selectedDetail?.id === activeSelectedContactId
      ? selectedDetail
      : visibleContacts.find(
          (contact) => contact.id === activeSelectedContactId
        ) ?? null
    : null;

  const applyFilters = () => {
    setAppliedFilters(draftFilters);
    setPage(1);
  };

  const clearFilters = () => {
    setDraftFilters(defaultFilters);
    setAppliedFilters(defaultFilters);
    setPage(1);
  };

  return (
    <div className="px-5 py-5 sm:px-6">
      <div className="grid gap-4 xl:grid-cols-[240px_minmax(820px,1fr)_400px]">
        <FilterPanel
          draftFilters={draftFilters}
          setDraftFilters={setDraftFilters}
          sdrOptions={sdrOptions}
          sourceOptions={sourceOptions}
          onApply={applyFilters}
          onClear={clearFilters}
        />

        <section className="min-w-0 space-y-4">
          <WorkspaceHeader
            total={total}
            isLoading={isLoading}
            onRefresh={loadContacts}
            selectedContact={selectedContact}
          />
          <Tabs total={total} />
          <MetricGrid counts={counts} />

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-950">
                  Contact records
                </h2>
                <p className="text-xs text-slate-500">
                  Synced from saved SDR activity recap rows.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" disabled>
                  <SlidersHorizontal className="mr-2 h-4 w-4" />
                  Views
                </Button>
                <Button variant="outline" size="sm" disabled>
                  Density: Comfortable
                </Button>
                <Button variant="outline" size="icon" disabled>
                  <Settings className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {errorMessage ? (
              <div className="m-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                {errorMessage}
              </div>
            ) : null}

            <ContactsTable
              contacts={visibleContacts}
              isLoading={isLoading}
              selectedContactId={activeSelectedContactId}
              onSelectContact={setSelectedContactId}
            />

            <TableFooter
              page={page}
              totalPages={totalPages}
              pageSize={pageSize}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              total={total}
              setPage={setPage}
              setPageSize={(nextPageSize) => {
                setPageSize(nextPageSize);
                setPage(1);
              }}
            />
          </div>
        </section>

        <ContactDetailPanel
          contact={selectedContact}
          detail={selectedDetail}
          isLoading={isDetailLoading}
          errorMessage={detailError}
          onClear={() => {
            setSelectedContactId(null);
            setSelectedDetail(null);
          }}
        />
      </div>
    </div>
  );
}

function WorkspaceHeader({
  total,
  isLoading,
  selectedContact,
  onRefresh,
}: {
  total: number;
  isLoading: boolean;
  selectedContact: ContactListItem | ContactDetail | null;
  onRefresh: () => void;
}) {
  const openCompanyHref = selectedContact?.companyRecordId
    ? `/companies?search=${encodeURIComponent(
        selectedContact.matchedCompanyName ??
          selectedContact.companyNameRaw ??
          ""
      )}`
    : null;

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-normal text-slate-950">
            Contacts
          </h1>
          <Badge variant="secondary" className="rounded-full">
            {total.toLocaleString()} contacts
          </Badge>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Review synced contacts, company links, activity context, and manager
          review status.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw
            className={cn("mr-2 h-4 w-4", isLoading ? "animate-spin" : "")}
          />
          Refresh
        </Button>
        {openCompanyHref ? (
          <Button asChild variant="outline" size="sm">
            <Link href={openCompanyHref}>
              <Building2 className="mr-2 h-4 w-4" />
              Open Company
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            <Building2 className="mr-2 h-4 w-4" />
            Open Company
          </Button>
        )}
        <Button asChild variant="outline" size="sm">
          <Link href="/activity-recaps">
            <Upload className="mr-2 h-4 w-4" />
            Review Upload
          </Link>
        </Button>
      </div>
    </div>
  );
}

function Tabs({ total }: { total: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button className="inline-flex h-9 items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 text-sm font-medium text-blue-700">
        <Users className="h-4 w-4" />
        All contacts
        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs">
          {total.toLocaleString()}
        </span>
      </button>
    </div>
  );
}

function MetricGrid({
  counts,
}: {
  counts: ContactListResponse["counts"] | undefined;
}) {
  const total = counts?.totalContacts ?? 0;
  const metrics = [
    {
      label: "Total",
      value: total,
      tone: "slate" as const,
    },
    {
      label: "Matched Company",
      value: counts?.withCompanyMatch ?? 0,
      tone: "green" as const,
    },
    {
      label: "Missing Company",
      value: counts?.missingCompanyMatch ?? 0,
      tone: "amber" as const,
    },
    {
      label: "With Activity",
      value: counts?.withActivity ?? 0,
      tone: "blue" as const,
    },
    {
      label: "Meeting Booked",
      value: counts?.meetingBooked ?? 0,
      tone: "green" as const,
    },
    {
      label: "Needs Review",
      value: counts?.withManagerReview ?? 0,
      tone: "rose" as const,
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-slate-500">
                {metric.label}
              </p>
              <p className="mt-1 text-2xl font-semibold text-slate-950">
                {metric.value.toLocaleString()}
              </p>
            </div>
            <span
              className={cn(
                "h-2.5 w-2.5 rounded-full",
                metric.tone === "green" && "bg-emerald-500",
                metric.tone === "amber" && "bg-amber-500",
                metric.tone === "rose" && "bg-rose-500",
                metric.tone === "blue" && "bg-blue-500",
                metric.tone === "slate" && "bg-slate-500"
              )}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function FilterPanel({
  draftFilters,
  setDraftFilters,
  sdrOptions,
  sourceOptions,
  onApply,
  onClear,
}: {
  draftFilters: DraftFilters;
  setDraftFilters: (filters: DraftFilters) => void;
  sdrOptions: string[];
  sourceOptions: string[];
  onApply: () => void;
  onClear: () => void;
}) {
  const updateFilter = (key: keyof DraftFilters, value: string) => {
    setDraftFilters({ ...draftFilters, [key]: value });
  };

  return (
    <aside className="flex min-h-[calc(100vh-9rem)] flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-950">Filters</h2>
        <button
          className="text-xs font-medium text-blue-700 hover:underline"
          onClick={onClear}
          type="button"
        >
          Clear all
        </button>
      </div>

      <div className="mt-4 space-y-4">
        <FilterSearch
          value={draftFilters.search}
          onChange={(value) => updateFilter("search", value)}
        />
        <FilterSelect
          label="Owner / SDR"
          value={draftFilters.sdrName}
          onChange={(value) => updateFilter("sdrName", value)}
        >
          <option value="">All owners</option>
          {sdrOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          label="Company"
          value={draftFilters.companyMatch}
          onChange={(value) => updateFilter("companyMatch", value)}
        >
          <option value="">All companies</option>
          <option value="matched">Matched company</option>
          <option value="missing">Missing company</option>
        </FilterSelect>
        <FilterSelect
          label="Contact Data"
          value={draftFilters.contactData}
          onChange={(value) => updateFilter("contactData", value)}
        >
          <option value="">All contacts</option>
          <option value="has_email">Has email</option>
          <option value="has_phone">Has phone</option>
          <option value="has_linkedin">Has LinkedIn</option>
        </FilterSelect>
        <FilterSelect
          label="Meeting Booked"
          value={draftFilters.meetingStatus}
          onChange={(value) => updateFilter("meetingStatus", value)}
        >
          <option value="">All</option>
          <option value="meeting">Yes</option>
          <option value="none">No / unknown</option>
        </FilterSelect>
        <FilterSelect
          label="Manager Review"
          value={draftFilters.managerReview}
          onChange={(value) => updateFilter("managerReview", value)}
        >
          <option value="">All</option>
          <option value="needs_review">Needs review</option>
          <option value="none">None</option>
        </FilterSelect>
        <FilterSelect
          label="Source"
          value={draftFilters.source}
          onChange={(value) => updateFilter("source", value)}
        >
          <option value="">All sources</option>
          {sourceOptions.map((option) => (
            <option key={option} value={option}>
              {formatSource(option)}
            </option>
          ))}
        </FilterSelect>
      </div>

      <div className="mt-auto grid grid-cols-2 gap-2 pt-6">
        <Button variant="outline" onClick={onClear}>
          Clear all
        </Button>
        <Button onClick={onApply}>Apply filters</Button>
      </div>
    </aside>
  );
}

function FilterSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600">Search</span>
      <span className="relative mt-1 block">
        <Search
          className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400"
          aria-hidden="true"
        />
        <Input
          className="h-10 pl-9"
          placeholder="Name, company, email..."
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </span>
    </label>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <select
        className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
    </label>
  );
}

function ContactsTable({
  contacts,
  isLoading,
  selectedContactId,
  onSelectContact,
}: {
  contacts: ContactListItem[];
  isLoading: boolean;
  selectedContactId: string | null;
  onSelectContact: (contactId: string) => void;
}) {
  if (contacts.length === 0) {
    return (
      <div className="m-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
        {isLoading
          ? "Loading contacts..."
          : "No contacts match the current filters."}
      </div>
    );
  }

  return (
    <div className="h-[min(64vh,720px)] overflow-auto">
      <Table className="min-w-[1250px]">
        <TableHeader className="sticky top-0 z-10 bg-slate-50">
          <TableRow>
            <TableHead className="w-10">
              <span className="sr-only">Select</span>
            </TableHead>
            <TableHead>Contact</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>LinkedIn</TableHead>
            <TableHead>Country</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Activity Status</TableHead>
            <TableHead>Meeting Status</TableHead>
            <TableHead>Manager Review</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contacts.map((contact) => {
            const isSelected = contact.id === selectedContactId;
            return (
              <TableRow
                key={contact.id}
                className={cn(
                  "cursor-pointer hover:bg-slate-50",
                  isSelected && "bg-blue-50/70"
                )}
                onClick={() => onSelectContact(contact.id)}
              >
                <TableCell>
                  <input
                    aria-label={`Select ${contact.fullName}`}
                    checked={isSelected}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600"
                    onChange={() => onSelectContact(contact.id)}
                    onClick={(event) => event.stopPropagation()}
                    type="checkbox"
                  />
                </TableCell>
                <TableCell>
                  <div className="flex min-w-[170px] items-center gap-3">
                    <EntityAvatar
                      name={contact.fullName}
                      size="md"
                      tone={contact.companyRecordId ? "blue" : "slate"}
                    />
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-slate-950">
                        {contact.fullName}
                      </div>
                      <ContactQualityBadge contact={contact} />
                    </div>
                  </div>
                </TableCell>
                <TableCell className="max-w-[150px] truncate text-sm text-slate-700">
                  {contact.title || "-"}
                </TableCell>
                <TableCell>
                  <div className="max-w-[170px] truncate font-medium text-slate-900">
                    {contact.matchedCompanyName ||
                      contact.companyNameRaw ||
                      "No company"}
                  </div>
                  <CompanyMatchBadge matched={Boolean(contact.companyRecordId)} />
                </TableCell>
                <TableCell className="max-w-[190px] truncate text-blue-700">
                  {contact.email ? (
                    <a
                      href={`mailto:${contact.email}`}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {contact.email}
                    </a>
                  ) : (
                    <span className="text-slate-400">-</span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-slate-700">
                  {contact.phone ? (
                    <a
                      href={`tel:${contact.phone}`}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {contact.phone}
                    </a>
                  ) : (
                    <span className="text-slate-400">-</span>
                  )}
                </TableCell>
                <TableCell>
                  {contact.contactLinkedInUrl ? (
                    <a
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-blue-700 hover:bg-blue-50"
                      href={contact.contactLinkedInUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => event.stopPropagation()}
                      aria-label="Open LinkedIn profile"
                    >
                      <Link2 className="h-4 w-4" />
                    </a>
                  ) : (
                    <span className="text-slate-400">-</span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-slate-700">
                  {contact.matchedCompanyCountry || "-"}
                </TableCell>
                <TableCell>
                  <NeutralBadge label={formatSource(contact.source)} />
                </TableCell>
                <TableCell>
                  <ActivityStatusBadge contact={contact} />
                </TableCell>
                <TableCell>
                  <MeetingStatusBadge contact={contact} />
                </TableCell>
                <TableCell>
                  <ManagerReviewBadge count={contact.managerReviewCount} />
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectContact(contact.id);
                      }}
                      aria-label="View contact"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    {contact.companyRecordId ? (
                      <Button asChild size="icon" variant="outline">
                        <Link
                          href={`/companies?search=${encodeURIComponent(
                            contact.matchedCompanyName ??
                              contact.companyNameRaw ??
                              ""
                          )}`}
                          onClick={(event) => event.stopPropagation()}
                          aria-label="Open company"
                        >
                          <Building2 className="h-4 w-4" />
                        </Link>
                      </Button>
                    ) : null}
                    <Button size="icon" variant="outline" disabled>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function ContactDetailPanel({
  contact,
  detail,
  isLoading,
  errorMessage,
  onClear,
}: {
  contact: ContactListItem | ContactDetail | null;
  detail: ContactDetail | null;
  isLoading: boolean;
  errorMessage: string | null;
  onClear: () => void;
}) {
  if (!contact) {
    return (
      <aside className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm xl:sticky xl:top-5 xl:h-[calc(100vh-7rem)]">
        Select a contact to see details.
      </aside>
    );
  }

  return (
    <aside className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm xl:sticky xl:top-5 xl:h-[calc(100vh-7rem)]">
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-5">
          <div className="flex min-w-0 items-start gap-3">
            <EntityAvatar name={contact.fullName} size="lg" tone="blue" />
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold text-slate-950">
                {contact.fullName}
              </h2>
              <p className="truncate text-sm text-slate-600">
                {contact.title || "Title unknown"}
              </p>
              <p className="mt-1 truncate text-sm font-medium text-blue-700">
                {contact.matchedCompanyName ||
                  contact.companyNameRaw ||
                  "No company"}
              </p>
              <div className="mt-2">
                <ContactQualityBadge contact={contact} />
              </div>
            </div>
          </div>
          <button
            aria-label="Clear selected contact"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            onClick={onClear}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex gap-2 border-b border-slate-200 p-4">
          <QuickAction href={contact.email ? `mailto:${contact.email}` : null}>
            <Mail className="h-4 w-4" />
            Email
          </QuickAction>
          <QuickAction href={contact.phone ? `tel:${contact.phone}` : null}>
            <Phone className="h-4 w-4" />
            Call
          </QuickAction>
          <QuickAction
            href={contact.contactLinkedInUrl}
            external={Boolean(contact.contactLinkedInUrl)}
          >
            <Link2 className="h-4 w-4" />
            LinkedIn
          </QuickAction>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {errorMessage ? (
            <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              {errorMessage}
            </div>
          ) : null}
          {isLoading ? (
            <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
              Loading contact detail...
            </div>
          ) : null}

          <DetailSection title="About">
            <DetailRow label="Location" value={contact.matchedCompanyCountry} />
            <DetailRow label="Email" value={contact.email} />
            <DetailRow label="Phone" value={contact.phone} />
            <DetailLink label="LinkedIn" value={contact.contactLinkedInUrl} />
            <DetailRow label="Source" value={formatSource(contact.source)} />
            <DetailRow
              label="Owner SDR"
              value={contact.ownerSdrName ?? contact.latestSdrName}
            />
            <DetailRow
              label="Last updated"
              value={formatDateTime(contact.updatedAt)}
            />
          </DetailSection>

          <DetailSection title="Linked Company">
            {contact.companyRecordId ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-start gap-3">
                  <EntityAvatar
                    name={contact.matchedCompanyName}
                    size="md"
                    tone="blue"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-950">
                      {contact.matchedCompanyName}
                    </div>
                    <div className="truncate text-xs text-slate-500">
                      {contact.matchedCompanyWebsite || "Website unavailable"}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600">
                      <div>{contact.matchedCompanyIndustry || "Industry unknown"}</div>
                      <div>
                        {contact.matchedCompanyStaffCountRange ||
                          "Size unknown"}
                      </div>
                    </div>
                  </div>
                </div>
                <Button asChild className="mt-3 w-full" variant="outline">
                  <Link
                    href={`/companies?search=${encodeURIComponent(
                      contact.matchedCompanyName ??
                        contact.companyNameRaw ??
                        ""
                    )}`}
                  >
                    View company
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                No matched company yet.
              </div>
            )}
          </DetailSection>

          <DetailSection title="Latest Activity">
            {contact.latestActivityDate || contact.latestActivitySummary ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium text-slate-950">
                    {contact.latestActivityDate || "Date unknown"}
                  </div>
                  <ActivityStatusBadge contact={contact} />
                </div>
                <p className="mt-2 text-sm leading-5 text-slate-600">
                  {contact.latestActivitySummary || "No activity note."}
                </p>
                <Button asChild className="mt-3 w-full" variant="outline">
                  <Link href={`/contacts/${contact.id}`}>View all activity</Link>
                </Button>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                No linked activity yet.
              </div>
            )}
          </DetailSection>

          <DetailSection title="Manager Review">
            {contact.managerReviewCount > 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold text-amber-900">
                    {contact.managerReviewCount.toLocaleString()} linked item
                    {contact.managerReviewCount === 1 ? "" : "s"}
                  </div>
                  <ManagerReviewBadge count={contact.managerReviewCount} />
                </div>
                <p className="mt-2 text-sm text-amber-800">
                  {getManagerReviewSummary(detail) ||
                    "Open manager review item linked to this contact."}
                </p>
                <Button asChild className="mt-3 w-full bg-white" variant="outline">
                  <Link href="/manager-review">Open manager review queue</Link>
                </Button>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                No manager review items.
              </div>
            )}
          </DetailSection>

          <DetailSection title="Match Insights">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <InsightMetric
                label="Activity rows"
                value={contact.activityCount.toLocaleString()}
              />
              <InsightMetric
                label="Match method"
                value={contact.companyRecordId ? "CompanyRecord" : "Unknown"}
              />
              <InsightMetric
                label="LinkedIn"
                value={contact.linkedinCount.toLocaleString()}
              />
              <InsightMetric
                label="Email"
                value={contact.emailCount.toLocaleString()}
              />
              <InsightMetric
                label="Calls"
                value={contact.callCount.toLocaleString()}
              />
              <InsightMetric
                label="Source upload"
                value={contact.sourceUploadId ? "Available" : "Unknown"}
              />
            </div>
          </DetailSection>
        </div>
      </div>
    </aside>
  );
}

function QuickAction({
  href,
  external = false,
  children,
}: {
  href: string | null | undefined;
  external?: boolean;
  children: ReactNode;
}) {
  const className =
    "flex flex-1 flex-col items-center justify-center gap-1 rounded-xl border border-slate-200 px-2 py-3 text-xs font-medium text-slate-700";

  if (!href) {
    return (
      <button className={cn(className, "opacity-50")} disabled type="button">
        {children}
      </button>
    );
  }

  return (
    <a
      className={cn(className, "hover:bg-blue-50 hover:text-blue-700")}
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
    >
      {children}
    </a>
  );
}

function TableFooter({
  page,
  totalPages,
  pageSize,
  rangeStart,
  rangeEnd,
  total,
  setPage,
  setPageSize,
}: {
  page: number;
  totalPages: number;
  pageSize: number;
  rangeStart: number;
  rangeEnd: number;
  total: number;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-600 lg:flex-row lg:items-center lg:justify-between">
      <div>
        {rangeStart.toLocaleString()}-{rangeEnd.toLocaleString()} of{" "}
        {total.toLocaleString()}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => setPage(Math.max(1, page - 1))}
        >
          Previous
        </Button>
        <span className="rounded-lg bg-blue-50 px-3 py-1 font-medium text-blue-700">
          {page}
        </span>
        <span>of {totalPages}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => setPage(Math.min(totalPages, page + 1))}
        >
          Next
        </Button>
        <select
          className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm"
          value={pageSize}
          onChange={(event) => setPageSize(Number(event.target.value))}
        >
          {PAGE_SIZE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option} per page
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function ContactQualityBadge({ contact }: { contact: ContactListItem }) {
  if (contact.managerReviewCount > 0) {
    return <StatusBadge label="Needs Review" tone="rose" />;
  }

  if (contact.companyRecordId && contact.email && contact.contactLinkedInUrl) {
    return <StatusBadge label="High" tone="green" />;
  }

  if (contact.companyRecordId || contact.email || contact.contactLinkedInUrl) {
    return <StatusBadge label="Medium" tone="amber" />;
  }

  return <StatusBadge label="Low" tone="rose" />;
}

function CompanyMatchBadge({ matched }: { matched: boolean }) {
  return matched ? (
    <StatusBadge label="Matched" tone="green" />
  ) : (
    <StatusBadge label="Missing" tone="slate" />
  );
}

function ActivityStatusBadge({ contact }: { contact: ContactListItem }) {
  if (contact.activityCount > 0) {
    return <StatusBadge label="Active" tone="green" />;
  }

  return <StatusBadge label="No activity" tone="slate" />;
}

function MeetingStatusBadge({ contact }: { contact: ContactListItem }) {
  return hasMeetingSignal(contact) ? (
    <StatusBadge label="Activity signal" tone="green" />
  ) : (
    <StatusBadge label="Unknown" tone="slate" />
  );
}

function ManagerReviewBadge({ count }: { count: number }) {
  return count > 0 ? (
    <StatusBadge label="Needs Review" tone="amber" />
  ) : (
    <StatusBadge label="None" tone="slate" />
  );
}

function NeutralBadge({ label }: { label: string }) {
  return <StatusBadge label={label} tone="slate" />;
}

function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: "green" | "amber" | "rose" | "blue" | "slate";
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "mt-1 w-fit rounded-md px-2 py-0.5 text-[11px] font-medium",
        tone === "green" && "border-emerald-200 bg-emerald-50 text-emerald-700",
        tone === "amber" && "border-amber-200 bg-amber-50 text-amber-700",
        tone === "rose" && "border-rose-200 bg-rose-50 text-rose-700",
        tone === "blue" && "border-blue-200 bg-blue-50 text-blue-700",
        tone === "slate" && "border-slate-200 bg-slate-100 text-slate-600"
      )}
    >
      {label}
    </Badge>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-slate-200 py-4 first:pt-0 last:border-b-0">
      <h3 className="mb-3 text-sm font-semibold text-slate-950">{title}</h3>
      {children}
    </section>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 py-1 text-sm">
      <div className="text-slate-500">{label}</div>
      <div className="min-w-0 truncate font-medium text-slate-800">
        {value || "Unknown"}
      </div>
    </div>
  );
}

function DetailLink({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 py-1 text-sm">
      <div className="text-slate-500">{label}</div>
      {value ? (
        <a
          className="min-w-0 truncate font-medium text-blue-700 hover:underline"
          href={value}
          target="_blank"
          rel="noreferrer"
        >
          {value}
        </a>
      ) : (
        <div className="font-medium text-slate-800">Unknown</div>
      )}
    </div>
  );
}

function InsightMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 truncate font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function hasMeetingSignal(contact: ContactListItem) {
  return contact.hasMeetingBooked;
}

function getManagerReviewSummary(detail: ContactDetail | null) {
  const item = detail?.managerReviewItems[0];
  if (!item) {
    return null;
  }

  return item.nextAction || `Status: ${item.status}. Priority: ${item.priority}.`;
}

function formatSource(source: string) {
  return source
    .split("_")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDateTime(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
