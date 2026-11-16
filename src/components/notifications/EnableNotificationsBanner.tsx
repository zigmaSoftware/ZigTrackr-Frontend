import { useState } from "react";
import { Bell, X } from "lucide-react";
import {
  notifyPermission,
  requestNotifyPermission,
  showConfirmationNotification,
} from "@/lib/webNotify";

/** A soft pre-prompt for desktop alerts.
 *
 *  Browsers penalise (and may auto-deny) a site that calls
 *  Notification.requestPermission() unprompted on load. The professional
 *  pattern is this: explain the value in-app first, and only invoke the real
 *  browser prompt on an explicit click. A user who isn't interested dismisses
 *  it for the session and is re-offered next login.
 *
 *  The banner shows itself ONLY when the browser permission is still in its
 *  initial "default" state. Once granted or denied there is nothing to ask,
 *  so it renders nothing.
 */

const DISMISS_KEY = "zbt.webNotify.bannerDismissed";

function dismissedThisSession(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function EnableNotificationsBanner() {
  const [permission, setPermission] = useState(notifyPermission);
  const [dismissed, setDismissed] = useState(dismissedThisSession);
  const [asking, setAsking] = useState(false);

  // Nothing to ask once the user has decided, or if the browser has no API.
  if (permission !== "default" || dismissed) return null;

  async function enable() {
    setAsking(true);
    const result = await requestNotifyPermission();
    setPermission(result);
    setAsking(false);
    if (result === "granted") showConfirmationNotification();
  }

  function notNow() {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Storage may be disabled; the banner just reappears on the next render.
    }
    setDismissed(true);
  }

  return (
    <div
      role="region"
      aria-label="Enable desktop alerts"
      className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--muted)]/60 px-3 py-2 sm:px-4"
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--primary)]/12 text-[var(--primary)]">
        <Bell className="size-3.5" aria-hidden />
      </span>
      <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-[var(--foreground)]">
        <span className="font-medium">Turn on desktop alerts</span>
        <span className="text-[var(--muted-foreground)]">
          {" "}
          so you don't miss ticket assignments, status changes and messages while
          you're on another tab.
        </span>
      </p>
      <button
        type="button"
        onClick={enable}
        disabled={asking}
        className="shrink-0 rounded-md bg-[var(--primary)] px-3 py-1.5 text-[12.5px] font-medium
                   text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-60"
      >
        {asking ? "Enabling…" : "Enable"}
      </button>
      <button
        type="button"
        onClick={notNow}
        aria-label="Dismiss"
        className="grid size-7 shrink-0 place-items-center rounded-md text-[var(--muted-foreground)]
                   hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
