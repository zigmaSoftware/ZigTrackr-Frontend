/** Native OS/Chrome notifications for the in-session notification stream.
 *
 *  ZigTrackr already receives every notification live over a per-user
 *  WebSocket and shows an in-app toast. This module adds the real desktop
 *  popup that appears OUTSIDE the browser window, so a notification is noticed
 *  even when the ZigTrackr tab is not the one in focus.
 *
 *  Written in the spirit of notificationSound.ts: lazy, guarded for browsers
 *  without the API, and failure-swallowing. A thrown error inside the socket
 *  handler would be far worse than a missing popup, so every entry point here
 *  is wrapped and returns a safe default rather than raising.
 */

import type { NotificationRow } from "@/types";

/** Per-viewer preference. Native popups are on by default once permission is
 *  granted; this lets a user mute them without revoking the browser grant. */
const PREF_KEY = "zbt.webNotify.enabled";

/** A raster icon in /public. SVG is not reliably honoured as a notification
 *  icon, so a PNG is used; if it is missing the OS shows a generic bell, which
 *  is an acceptable fallback rather than a reason to withhold the popup. */
const ICON_PATH = "/notification-icon.png";

function supported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notifyPermission(): NotificationPermission {
  if (!supported()) return "denied";
  try {
    return Notification.permission;
  } catch {
    return "denied";
  }
}

export async function requestNotifyPermission(): Promise<NotificationPermission> {
  if (!supported()) return "denied";
  try {
    // Once a user has decided, the browser resolves immediately with the
    // stored answer, so calling this again is harmless.
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

/** Has the viewer muted native popups in-app (independently of the grant)? */
export function nativeNotificationsEnabled(): boolean {
  try {
    // Absent means "not yet chosen" -> default on, matching the plan.
    return localStorage.getItem(PREF_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setNativeNotificationsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, enabled ? "1" : "0");
  } catch {
    // Storage may be disabled; the preference simply won't persist.
  }
}

export function canShowNativeNotification(): boolean {
  return supported() && notifyPermission() === "granted" && nativeNotificationsEnabled();
}

/** Chat titles read "New message on TKT-… from <name>"; surface the sender. */
function titleFor(row: NotificationRow): string {
  if (row.notification_type.includes("CHAT")) {
    const match = row.title.match(/from\s+(.+)$/i);
    const sender = match ? match[1].trim() : (row.ticket_no ?? "Support");
    const ref = row.ticket_no ?? row.bug_no ?? "";
    return ref ? `${sender} · ${ref}` : sender;
  }
  return row.title;
}

/** One stable tag per entity+type, so a burst of updates on one ticket
 *  coalesces into a single replacing popup instead of a stack. */
function tagFor(row: NotificationRow): string {
  return `${row.notification_type}:${row.ticket_id ?? row.bug_id ?? row.id}`;
}

/** Show one native notification. `onClick` reuses the toast's own navigation,
 *  so a click deep-links to exactly the same place the in-app toast would. */
export function showNativeNotification(row: NotificationRow, onClick: () => void): void {
  if (!canShowNativeNotification()) return;
  try {
    const notification = new Notification(titleFor(row), {
      body: row.message || row.type_label || "",
      icon: ICON_PATH,
      tag: tagFor(row),
      // Urgent items stay until dismissed, mirroring the persistent in-app
      // toast; everything else is cleared by the OS on its own schedule.
      requireInteraction: Boolean(row.is_urgent),
      // A replacing notification should not re-alert; a genuinely new one may.
      renotify: false,
    } as NotificationOptions);

    notification.onclick = () => {
      try {
        window.focus();
        onClick();
        notification.close();
      } catch {
        // Navigation is best-effort; a failure here must not surface.
      }
    };
  } catch {
    // A failed native notification must never break the socket handler or
    // suppress the in-app toast that fires alongside it.
  }
}

/** A one-off confirmation popup shown right after the user grants permission,
 *  so they see the feature work immediately. */
export function showConfirmationNotification(): void {
  if (!canShowNativeNotification()) return;
  try {
    const confirmation = new Notification("Desktop alerts are on", {
      body: "You'll be notified here about assignments, messages and new tickets.",
      icon: ICON_PATH,
      tag: "zbt-webnotify-confirmation",
    });
    // Auto-clear the confirmation after a few seconds; it has served its purpose.
    window.setTimeout(() => { try { confirmation.close(); } catch { /* ignore */ } }, 4000);
  } catch {
    // Non-essential; ignore.
  }
}
