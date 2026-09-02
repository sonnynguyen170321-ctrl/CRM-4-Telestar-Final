export const V2_NOTIFICATION_EVENT_NAME = "v2:notification";

export const V2_NOTIFICATION_EVENT_TYPES = [
  "research.run.started",
  "research.stage.completed",
  "research.stage.failed",
  "research.candidate.ready",
  "research.promoted",
  "enrichment.completed",
  "lead.created",
] as const;

export type V2NotificationEventType = typeof V2_NOTIFICATION_EVENT_TYPES[number];
export type V2NotificationKind = "info" | "success" | "warning" | "error";

export type V2NotificationPayload = {
  id?: string;
  type: V2NotificationEventType;
  kind: V2NotificationKind;
  title: string;
  description?: string;
  href?: string;
  actionLabel?: string;
  createdAt?: string;
};

export type V2Notification = Required<Pick<V2NotificationPayload, "id" | "type" | "kind" | "title" | "createdAt">> &
  Pick<V2NotificationPayload, "description" | "href" | "actionLabel">;

export function normalizeV2Notification(payload: V2NotificationPayload): V2Notification {
  return {
    id: payload.id ?? `${payload.type}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    type: payload.type,
    kind: payload.kind,
    title: payload.title,
    description: payload.description,
    href: payload.href,
    actionLabel: payload.actionLabel,
    createdAt: payload.createdAt ?? new Date().toISOString(),
  };
}