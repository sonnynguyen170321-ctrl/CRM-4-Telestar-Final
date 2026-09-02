"use client";

import { toast } from "sonner";

import { V2_NOTIFICATION_EVENT_NAME, normalizeV2Notification, type V2Notification, type V2NotificationPayload } from "@/lib/v2/notifications/events";

export function emitV2Notification(payload: V2NotificationPayload): V2Notification {
  const notification = normalizeV2Notification(payload);
  window.dispatchEvent(new CustomEvent<V2Notification>(V2_NOTIFICATION_EVENT_NAME, { detail: notification }));
  return notification;
}

export function notifyV2(payload: V2NotificationPayload): V2Notification {
  const notification = emitV2Notification(payload);
  const options = {
    description: notification.description,
    action: notification.href
      ? {
          label: notification.actionLabel ?? "Open",
          onClick: () => { window.location.href = notification.href!; },
        }
      : undefined,
  };

  if (notification.kind === "success") toast.success(notification.title, options);
  else if (notification.kind === "error") toast.error(notification.title, options);
  else if (notification.kind === "warning") toast.warning(notification.title, options);
  else toast(notification.title, options);

  return notification;
}