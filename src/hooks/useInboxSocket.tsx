import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/api/queryKeys";
import { playNotificationSound } from "@/lib/notificationSound";
import { showNativeNotification } from "@/lib/webNotify";
import { ChatToast, PillToast } from "@/components/notifications/NotificationToast";
import type { NotificationRow } from "@/types";
import { useAuth } from "@/features/auth/AuthContext";

/** Per-user socket that keeps unread counts live.
 *
 *  The ticket socket only covers the conversation a user has open, so a
 *  message on any other ticket went unnoticed until a poll fired. This one
 *  stays connected for the whole session.
 *
 *  The server sends only {"type":"inbox_changed"} with no payload, because
 *  ticket visibility is per user and cannot be evaluated by a broadcast group.
 *  So this just invalidates the already-scoped queries and lets the API answer
 *  with the caller's own permissions applied.
 */
export function useInboxSocket(enabled: boolean) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { refresh: refreshSession } = useAuth();

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    /* Consecutive 4403 refusals. The inbox socket authenticates with the
       short-lived access-token cookie (5 min). When it rotates, the server
       refuses the socket with 4403 -- which previously killed it for the rest
       of the session, so live notifications silently stopped a few minutes
       after login. We now refresh the session and reconnect on 4403, but cap
       the attempts so a genuinely unauthorized user doesn't loop forever. */
    let authRetries = 0;
    const MAX_AUTH_RETRIES = 5;

    function refresh() {
      void queryClient.invalidateQueries({ queryKey: ["tickets", "chat-inbox"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.sidebarCounts });
    }

    function refreshNotifications() {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.unreadCount });
    }

    /* Don't toast something the user is already looking at: a reply on the
       ticket currently open on screen is visible without interrupting. The
       badge and bell still update. */
    function alreadyOnScreen(row: NotificationRow) {
      if (document.visibilityState !== "visible") return false;
      const id = row.ticket_id ?? row.bug_id;
      return Boolean(id && window.location.href.includes(id));
    }

    function announce(row: NotificationRow) {
      refreshNotifications();
      // Suppressed together with the toast: if you are already looking at
      // the thing, a chime is just noise.
      if (alreadyOnScreen(row)) return;
      playNotificationSound();
      // Client-side navigation: a full reload would tear down this very
      // socket and lose any other queued notifications.
      const open = row.link ? () => navigate(row.link) : undefined;
      /* Native OS popup, but only when this tab is NOT focused. When it is,
         the in-app toast + chime below already interrupt the user, so a second
         desktop popup would be redundant noise. The OS popup earns its place
         precisely when ZigTrackr is in another tab or behind another app --
         which is the whole point of the feature. */
      if (document.visibilityState !== "visible" && open) {
        showNativeNotification(row, open);
      }
      const isChat = row.notification_type.includes("CHAT");
      // Urgent items stay until dismissed; everything else clears itself.
      const options = { duration: row.is_urgent ? Infinity : 6000 };
      toast.custom(
        (id) => isChat
          ? <ChatToast row={row} onOpen={() => { toast.dismiss(id); open?.(); }} />
          : <PillToast row={row} onOpen={open && (() => { toast.dismiss(id); open(); })} />,
        options,
      );
    }

    function connect() {
      const url = new URL("/api/v1/tickets/inbox/ws/", window.location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(url);
      socket.onmessage = (event) => {
        if (stopped) return;
        try {
          const data = JSON.parse(event.data) as {
            type?: string; notification?: NotificationRow;
          };
          if (data.type === "inbox_changed") refresh();
          else if (data.type === "permissions_changed") {
            void refreshSession().then(() => queryClient.clear());
          }
          else if (data.type === "notification" && data.notification) {
            announce(data.notification);
          }
        } catch {
          // Malformed frame; the next event or the fallback poll recovers.
        }
      };
      socket.onopen = () => {
        // A successful connect clears the auth-retry budget, so a later token
        // rotation gets its own fresh set of attempts.
        authRetries = 0;
      };
      socket.onclose = (event) => {
        if (stopped) return;
        if (event.code === 4403) {
          /* The access token almost certainly rotated out from under the
             socket. Refresh it and reconnect, rather than giving up for the
             rest of the session. Bounded, so a truly revoked session settles
             instead of hammering. */
          if (authRetries >= MAX_AUTH_RETRIES) return;
          authRetries += 1;
          retry = window.setTimeout(() => {
            void refreshSession().then(() => {
              if (!stopped) connect();
            });
          }, 2000 * authRetries);
          return;
        }
        // Any other drop (server bounce, network blip): reconnect and resync.
        retry = window.setTimeout(() => {
          // Counts may have moved while disconnected.
          refresh();
          refreshNotifications();
          connect();
        }, 5000);
      };
    }

    connect();
    const refreshAccess = () => { if (document.visibilityState === "visible") void refreshSession(); };
    window.addEventListener("focus", refreshAccess);
    document.addEventListener("visibilitychange", refreshAccess);
    return () => {
      window.removeEventListener("focus", refreshAccess);
      document.removeEventListener("visibilitychange", refreshAccess);
      stopped = true;
      window.clearTimeout(retry);
      socket?.close();
    };
  }, [enabled, queryClient, navigate, refreshSession]);
}
