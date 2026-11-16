import { lazy, Suspense, useId, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Activity, AlertTriangle, ArrowRight, ArrowUpRight, Bug, CalendarDays,
  CheckCheck, CheckCircle2, ChevronRight, ClipboardList, Clock3, FlaskConical,
  Inbox, KeyRound, Layers, Play, RefreshCw, RotateCcw, ShieldCheck, Users,
  type LucideIcon,
} from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer,
  Tooltip as ChartTooltip, XAxis, YAxis,
} from "recharts";
import { format, subDays } from "date-fns";
import { dashboardApi, ticketApi } from "@/api/services";
import { queryKeys } from "@/api/queryKeys";
import { Button, Skeleton } from "@/components/ui/primitives";
import { ErrorState, PermissionDenied } from "@/components/feedback/states";
import { useAuth } from "@/features/auth/AuthContext";
import { useCountUp } from "@/hooks/useCountUp";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { formatDate, greeting, longDate, relativeTime } from "@/lib/dates";
import { dailyApi } from "@/features/daily-updates/api";
import { attentionParams, chartRows, shortStatus, trendForPeriod, workParams, type AttentionTab, type WorkTab } from "./dashboardModel";
import type { ChartDatum, SupportTicketRow } from "@/types";
import "./DashboardPage.css";

const TicketDetailDialog = lazy(() => import("@/features/tickets/dialogs/TicketDetailDialog").then((m) => ({ default: m.TicketDetailDialog })));

const COLORS = ["var(--dash-violet)", "var(--dash-coral)", "var(--dash-teal)", "var(--dash-blue)", "var(--dash-gold)", "#b4bfce"];
const WORK_TABS: { key: WorkTab; label: string }[] = [{ key: "all", label: "All active" }, { key: "progress", label: "In progress" }, { key: "verification", label: "Verification" }];
const ATTENTION_TABS: { key: AttentionTab; label: string }[] = [{ key: "overdue", label: "Overdue" }, { key: "critical", label: "Critical" }, { key: "unassigned", label: "Unassigned" }];
const ATTENTION_ROUTES: Record<AttentionTab, string> = { overdue: "/tickets/overdue", critical: "/tickets/critical", unassigned: "/tickets/unassigned" };

/** Lifecycle stages shown in the workflow pipeline, in workflow order. */
const PIPELINE: { code: string; label: string; note: string; color: string }[] = [
  { code: "NEW", label: "New", note: "awaiting routing", color: "var(--status-new-solid)" },
  { code: "ASSIGNED", label: "Assigned", note: "routed to developers", color: "var(--status-assigned-solid)" },
  { code: "IN_PROGRESS", label: "In Progress", note: "being worked", color: "var(--status-in-progress-solid)" },
  { code: "TESTING", label: "Rectified", note: "awaiting verification", color: "var(--status-testing-solid)" },
  { code: "RESOLVED", label: "Resolved", note: "awaiting closure", color: "var(--status-resolved-solid)" },
  { code: "CLOSED", label: "Closed", note: "completed", color: "var(--status-closed-solid)" },
];

const TYPE_COLOR: Record<string, string> = { BUG: "var(--dash-coral)", SERVICE_REQUEST: "var(--dash-blue)", ACCESS_REQUEST: "var(--dash-violet)" };

type Scope = "developer" | "lead" | "management" | "super";

/** Resolve which dashboard layout to show from the signed-in user's real role. */
function useScope(): { scope: Scope; caption: string; intro: string } {
  const { user, hasRole, can } = useAuth();
  return useMemo(() => {
    if (user?.is_superuser) return { scope: "super", caption: "Super Admin", intro: "Global console — every company and ticket in the system." };
    if (hasRole("MANAGEMENT")) return { scope: "management", caption: "Management", intro: "The whole picture — volume, ageing and closure performance." };
    if (hasRole("TEAM_LEAD", "ADMIN") || can("tickets.ticket.assign")) return { scope: "lead", caption: "Team Lead", intro: "Route new work and keep your team unblocked." };
    return { scope: "developer", caption: user?.roles?.[0]?.name ?? "Developer", intro: "Here's your queue for today." };
  }, [user, hasRole, can]);
}

export function DashboardPage() {
  const { user, can } = useAuth();
  const reduced = usePrefersReducedMotion();
  const gradientId = useId().replaceAll(":", "");
  const { scope, caption, intro } = useScope();
  const [period, setPeriod] = useState(30);
  const [workTab, setWorkTab] = useState<WorkTab>("all");
  const [attentionTab, setAttentionTab] = useState<AttentionTab>("overdue");
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const canDashboard = can("dashboard.dashboard.view");
  const canReadTickets = can("tickets.ticket.view");
  const canReadActivity = canReadTickets && can("bugs.update.view");
  const wideScope = scope === "management" || scope === "super";

  const kpis = useQuery({ queryKey: queryKeys.dashboard.kpis, queryFn: dashboardApi.kpis, enabled: canDashboard, staleTime: 60_000 });
  const charts = useQuery({ queryKey: queryKeys.dashboard.charts, queryFn: dashboardApi.charts, enabled: canDashboard, staleTime: 60_000 });
  const myParams = workParams(workTab);
  const work = useQuery({ queryKey: queryKeys.tickets.list(myParams), queryFn: () => ticketApi.list(myParams), enabled: canDashboard && canReadTickets, staleTime: 60_000 });
  const urgentParams = attentionParams(attentionTab);
  const attention = useQuery({ queryKey: queryKeys.tickets.list(urgentParams), queryFn: () => ticketApi.list(urgentParams), enabled: canDashboard && canReadTickets, staleTime: 60_000 });
  const activityParams = { from_date: format(subDays(new Date(), 6), "yyyy-MM-dd"), to_date: format(new Date(), "yyyy-MM-dd"), category: "all", limit: 5, page: 1 };
  const activity = useQuery({ queryKey: queryKeys.tickets.dailyUpdates(activityParams), queryFn: () => dailyApi.list(activityParams), enabled: canDashboard && canReadActivity, staleTime: 60_000 });

  const trend = trendForPeriod(charts.data?.closure_trend ?? [], period);
  const opened = trend.reduce((sum, day) => sum + day.opened, 0);
  const closed = trend.reduce((sum, day) => sum + day.closed, 0);
  const priorities = chartRows(charts.data?.by_priority ?? []);
  const priorityTotal = priorities.reduce((sum, row) => sum + row.count, 0);
  const statuses = chartRows(charts.data?.by_status ?? []).sort((a, b) => b.count - a.count).slice(0, 6);
  const modules = chartRows(charts.data?.by_module ?? []).sort((a, b) => b.count - a.count).slice(0, 6);

  // Pipeline counts come from the same by_status series the charts endpoint returns.
  const statusCount = useMemo(() => {
    const map = new Map<string, number>();
    chartRows(charts.data?.by_status ?? []).forEach((row) => { if (row.code) map.set(row.code, row.count); });
    return map;
  }, [charts.data]);
  const pipelineOpen = PIPELINE.filter((s) => s.code !== "CLOSED").reduce((sum, s) => sum + (statusCount.get(s.code) ?? 0), 0);

  async function refresh() {
    setRefreshing(true);
    try {
      await Promise.allSettled([kpis.refetch(), charts.refetch(),
        ...(canReadTickets ? [work.refetch(), attention.refetch()] : []),
        ...(canReadActivity ? [activity.refetch()] : [])]);
    } finally { setRefreshing(false); }
  }

  if (!canDashboard) return <PermissionDenied />;

  const k = kpis.data;

  return <div className="dashboard-page">
    {/* ---------- header ---------- */}
    <header className="dash-header">
      <div>
        <h1>{greeting()}, {user?.name?.split(" ")[0] || "there"}</h1>
      </div>
      <span className="dash-sub">{intro}</span>
      <div className="dash-header-actions">
        <span className="dash-scope-chip"><ShieldCheck className="size-3" aria-hidden />{caption}</span>
        <span className="dash-updated"><i aria-hidden />{kpis.dataUpdatedAt ? `Updated ${format(kpis.dataUpdatedAt, "hh:mm a")}` : "Current snapshot"}</span>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing} aria-label="Refresh dashboard">
          <RefreshCw className={refreshing && !reduced ? "animate-spin" : ""} /><span>Refresh</span>
        </Button>
      </div>
    </header>

    {/* ---------- signal strip ---------- */}
    {kpis.isLoading ? <div className="dash-signals-row">{Array.from({ length: 5 }, (_, i) => <div key={i} className="dash-sig"><Skeleton className="size-9 rounded-xl" /><div className="flex-1"><Skeleton className="h-5 w-10" /><Skeleton className="mt-2 h-2.5 w-20" /></div></div>)}</div>
      : kpis.isError ? <div className="dash-surface"><ErrorState title="Summary couldn't be loaded" onRetry={() => void kpis.refetch()} className="py-8" /></div>
      : k ? <div className="dash-signals-row">
        <Signal label="Critical open" value={k.critical} icon={AlertTriangle} color="var(--destructive)" to={can("tickets.critical.access") ? "/tickets/critical" : undefined} />
        <Signal label="Overdue" value={k.overdue} icon={Clock3} color="var(--warning)" to={can("tickets.overdue.access") ? "/tickets/overdue" : undefined} />
        {scope === "developer"
          ? <Signal label="Assigned to me" value={k.assigned} icon={CheckCheck} color="var(--dash-violet)" to={can("tickets.all.access") ? "/tickets?owner=me" : undefined} />
          : <Signal label="Unassigned" value={k.unassigned} icon={Users} color="var(--info)" to={can("tickets.unassigned.access") ? "/tickets/unassigned" : undefined} />}
        <Signal label="Awaiting verification" value={k.testing} icon={FlaskConical} color="var(--dash-teal)" to={can("tickets.testing.access") ? "/tickets/testing" : undefined} />
        <Signal label="Reopened" value={k.reopened} icon={RotateCcw} color="var(--dash-coral)" />
      </div> : null}

    {/* ---------- focal metrics + workflow pipeline ---------- */}
    <div className="dash-row dash-row-focal">
      <section className="dash-surface" aria-label="Key figures">
        <div className="dash-panel-header">
          <h2>{scope === "developer" ? "Your workload" : scope === "lead" ? "Routing & team" : scope === "super" ? "All companies" : "Operations"}</h2>
          <span className="dash-hint">{wideScope ? "all visible records" : "scoped to you"}</span>
        </div>
        {kpis.isLoading ? <div className="dash-metrics">{Array.from({ length: 4 }, (_, i) => <div key={i} className="dash-metric"><Skeleton className="h-3 w-20" /><Skeleton className="mt-3 h-8 w-14" /><Skeleton className="mt-2 h-2.5 w-24" /></div>)}</div>
          : k ? <div className="dash-metrics">
            {scope === "developer" ? <>
              <Metric label="Assigned to me" value={k.assigned} icon={Inbox} color="var(--dash-violet)" note={`${k.in_progress} in progress`} to={can("tickets.all.access") ? "/tickets?owner=me" : undefined} />
              <Metric label="Update pending" value={k.update_pending} icon={ClipboardList} color="var(--warning)" note="post a daily update" to={can("tickets.all.access") ? "/updates/today" : undefined} />
              <Metric label="Awaiting verification" value={k.testing} icon={ShieldCheck} color="var(--dash-teal)" note="rectified, with QA" to={can("tickets.testing.access") ? "/tickets/testing" : undefined} />
              <Metric label="Overdue" value={k.overdue} icon={Clock3} color="var(--destructive)" note="past expected closure" to={can("tickets.overdue.access") ? "/tickets/overdue" : undefined} />
            </> : scope === "lead" ? <>
              <Metric label="Unassigned" value={k.unassigned} icon={Users} color="var(--warning)" note="route to a developer" to={can("tickets.unassigned.access") ? "/tickets/unassigned" : undefined} />
              <Metric label="In progress" value={k.in_progress} icon={Play} color="var(--dash-violet)" note="active across the team" to={can("tickets.all.access") ? "/tickets?status=IN_PROGRESS" : undefined} />
              <Metric label="Awaiting verification" value={k.testing} icon={ShieldCheck} color="var(--dash-teal)" note="ready to verify and close" to={can("tickets.testing.access") ? "/tickets/testing" : undefined} />
              <Metric label="Overdue" value={k.overdue} icon={Clock3} color="var(--destructive)" note="past expected closure" to={can("tickets.overdue.access") ? "/tickets/overdue" : undefined} />
            </> : <>
              <Metric label="Total open" value={k.total_open} icon={Layers} color="var(--dash-violet)" note={`${k.new_today} received today`} to={can("tickets.all.access") ? "/tickets" : undefined} />
              <Metric label="Overdue" value={k.overdue} icon={AlertTriangle} color="var(--destructive)" note={k.total_open ? `${Math.round(k.overdue / k.total_open * 100)}% of open` : "none open"} to={can("tickets.overdue.access") ? "/tickets/overdue" : undefined} />
              <Metric label="Closed this month" value={k.closed_this_month} icon={CheckCheck} color="var(--dash-teal)" note={`${k.closed_today} closed today`} to={can("tickets.closed.access") ? "/tickets/closed" : undefined} />
              <Metric label="Avg closure" value={k.avg_closure_days ?? 0} icon={Clock3} color="var(--dash-blue)" note="days from report to close" suffix="d" decimals={1} />
            </>}
          </div> : null}
      </section>

      <section className="dash-surface" aria-label="Workflow pipeline">
        <div className="dash-panel-header">
          <h2>Workflow pipeline</h2>
          <span className="dash-hint">open bugs by stage · bar = share of open</span>
        </div>
        {charts.isError ? <PanelError onRetry={() => void charts.refetch()} />
          : charts.isLoading ? <div className="dash-flow">{PIPELINE.map((s) => <div key={s.code} className="dash-stage"><Skeleton className="h-3 w-16" /><Skeleton className="mt-2 h-[72px] w-full rounded-xl" /></div>)}</div>
          : !statusCount.size ? <QuietState icon={Layers} title="No bug workflow data" description="Stages fill in as bugs move through the lifecycle." />
          : <div className="dash-flow">
            {PIPELINE.map((stage, i) => {
              const value = statusCount.get(stage.code) ?? 0;
              const share = stage.code === "CLOSED" || !pipelineOpen ? 0 : Math.round(value / pipelineOpen * 100);
              return <div key={stage.code} className="dash-stage" style={{ "--stage-color": stage.color } as CSSProperties}>
                <div className="dash-stage-cap"><i aria-hidden /><span>{stage.label}</span></div>
                <div className="dash-stage-cell">
                  <div className="dash-stage-value tnum">{value.toLocaleString()}</div>
                  <div className="dash-stage-note">{stage.note}</div>
                  {i < PIPELINE.length - 1 ? <ChevronRight className="dash-stage-arrow size-3.5" aria-hidden /> : null}
                </div>
                <div className="dash-stage-meter"><i style={{ width: `${share}%` }} /></div>
              </div>;
            })}
          </div>}
      </section>
    </div>

    {/* ---------- trend + priority mix ---------- */}
    <div className="dash-row dash-row-charts">
      <section className="dash-surface" aria-label="Bug activity trend">
        <div className="dash-panel-header">
          <h2>Opened vs closed</h2>
          <div className="dash-hint dash-period" role="group" aria-label="Trend period">
            {[7, 14, 30].map((days) => <button type="button" key={days} aria-pressed={period === days} onClick={() => setPeriod(days)}>{days}d</button>)}
          </div>
        </div>
        {charts.isError ? <PanelError onRetry={() => void charts.refetch()} /> : charts.isLoading ? <ChartLoading /> : trend.length === 0 || opened + closed === 0 ? <QuietState title="No bug activity in this period" description="New and closed bugs appear here as work moves forward." /> : <>
          <div className="dash-chart">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <AreaChart data={trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }} accessibilityLayer>
                <defs>
                  <linearGradient id={`${gradientId}-opened`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--dash-coral)" stopOpacity={.26} /><stop offset="100%" stopColor="var(--dash-coral)" stopOpacity={0} /></linearGradient>
                  <linearGradient id={`${gradientId}-closed`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--dash-teal)" stopOpacity={.24} /><stop offset="100%" stopColor="var(--dash-teal)" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 6" strokeOpacity={.6} />
                <XAxis dataKey="date" axisLine={false} tickLine={false} minTickGap={24} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} tickFormatter={(value: string) => formatDate(value).slice(0, 6)} dy={6} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
                <ChartTooltip cursor={{ stroke: "var(--dash-violet)", strokeDasharray: "3 3" }} content={({ active, payload, label }) => active && payload?.length ? <div className="dash-tooltip"><p>{formatDate(String(label))}</p>{payload.map((row) => <div key={String(row.dataKey)} className="dash-tooltip-row"><span style={{ color: row.color }}>{row.name}</span><strong>{String(row.value)}</strong></div>)}</div> : null} />
                <Area type="monotone" dataKey="opened" name="Opened" stroke="var(--dash-coral)" strokeWidth={2.2} fill={`url(#${gradientId}-opened)`} isAnimationActive={!reduced} animationDuration={800} activeDot={{ r: 4, strokeWidth: 3, stroke: "var(--card)" }} />
                <Area type="monotone" dataKey="closed" name="Closed" stroke="var(--dash-teal)" strokeWidth={2.2} fill={`url(#${gradientId}-closed)`} isAnimationActive={!reduced} animationDuration={800} activeDot={{ r: 4, strokeWidth: 3, stroke: "var(--card)" }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="dash-legend">
            <span><i style={{ background: "var(--dash-coral)" }} />Opened <strong className="tnum">{opened.toLocaleString()}</strong></span>
            <span><i style={{ background: "var(--dash-teal)" }} />Closed <strong className="tnum">{closed.toLocaleString()}</strong></span>
          </div>
        </>}
      </section>

      <section className="dash-surface" aria-label="Open bug priorities">
        <div className="dash-panel-header"><h2>Open by priority</h2><span className="dash-hint">visible bugs</span></div>
        {charts.isError ? <PanelError onRetry={() => void charts.refetch()} /> : charts.isLoading ? <ChartLoading /> : !priorityTotal ? <QuietState icon={CheckCircle2} title="No open bugs" description="Your visible bug queue is clear." /> : <div className="dash-donut-layout">
          <div className="dash-donut">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}><PieChart>
              <Pie data={priorities} dataKey="count" nameKey="label" innerRadius="70%" outerRadius="92%" paddingAngle={priorityTotal > 1 ? 3 : 0} cornerRadius={4} stroke="none" startAngle={90} endAngle={-270} isAnimationActive={!reduced} animationDuration={800}>
                {priorities.map((row, i) => <Cell key={row.code || row.label} fill={row.color || COLORS[i % COLORS.length]} />)}
              </Pie>
              <ChartTooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 11 }} />
            </PieChart></ResponsiveContainer>
            <div className="dash-donut-center"><strong className="tnum">{priorityTotal.toLocaleString()}</strong><span>open bugs</span></div>
          </div>
          <ul className="dash-priorities">{priorities.map((row, i) => <li key={row.code || row.label} className="dash-priority">
            <i className="dash-legend-dot" style={{ background: row.color || COLORS[i % COLORS.length] }} />
            <span title={row.label}>{row.label}</span>
            <div><strong>{row.count.toLocaleString()}</strong><small>{Math.round(row.count / priorityTotal * 100)}%</small></div>
          </li>)}</ul>
        </div>}
      </section>
    </div>

    {/* ---------- queues ---------- */}
    <div className="dash-row dash-row-2">
      {scope === "developer" ? <QueuePanel
        title="My queue" hint="assigned to you"
        tabs={WORK_TABS} selected={workTab} onSelect={setWorkTab} tabsLabel="My work filter"
        query={work} canRead={canReadTickets} onOpen={setTicketId}
        emptyTitle={workTab === "all" ? "You're all caught up" : "No tickets in this queue"}
        emptyNote="Assigned work appears here."
        footer={work.data ? `Showing ${work.data.results.length} of ${work.data.count}` : "Only your assigned tickets"}
        link={can("tickets.all.access") ? { to: "/tickets?owner=me", label: "View my tickets" } : undefined}
      /> : <QueuePanel
        title={scope === "lead" ? "Unassigned — route now" : "Needs attention"} hint={wideScope ? "org-wide" : "your team"}
        tabs={ATTENTION_TABS} selected={attentionTab} onSelect={setAttentionTab} tabsLabel="Attention queue filter"
        query={attention} canRead={canReadTickets} onOpen={setTicketId} overdue={attentionTab === "overdue"}
        emptyTitle={`No ${attentionTab} tickets`} emptyNote="Nothing needs attention in this queue."
        footer={attention.data ? `${attention.data.count} tickets in this queue` : "Permission-scoped tickets"}
        link={can(`tickets.${attentionTab}.access`) ? { to: ATTENTION_ROUTES[attentionTab], label: "View queue" } : undefined}
      />}

      {scope === "developer" ? <QueuePanel
        title="Needs attention" hint="priority queue"
        tabs={ATTENTION_TABS} selected={attentionTab} onSelect={setAttentionTab} tabsLabel="Attention queue filter"
        query={attention} canRead={canReadTickets} onOpen={setTicketId} overdue={attentionTab === "overdue"}
        emptyTitle={`No ${attentionTab} tickets`} emptyNote="Nothing needs your attention right now."
        footer={attention.data ? `${attention.data.count} tickets in this queue` : "Permission-scoped tickets"}
        link={can(`tickets.${attentionTab}.access`) ? { to: ATTENTION_ROUTES[attentionTab], label: "View queue" } : undefined}
      /> : <QueuePanel
        title="My queue" hint="assigned to you"
        tabs={WORK_TABS} selected={workTab} onSelect={setWorkTab} tabsLabel="My work filter"
        query={work} canRead={canReadTickets} onOpen={setTicketId}
        emptyTitle={workTab === "all" ? "Nothing assigned to you" : "No tickets in this queue"}
        emptyNote="Work assigned to you appears here."
        footer={work.data ? `Showing ${work.data.results.length} of ${work.data.count}` : "Only your assigned tickets"}
        link={can("tickets.all.access") ? { to: "/tickets?owner=me", label: "View my tickets" } : undefined}
      />}
    </div>

    {/* ---------- distributions ---------- */}
    <div className="dash-row dash-row-2">
      <section className="dash-surface">
        <div className="dash-panel-header"><h2>By status</h2><span className="dash-hint">visible bugs</span></div>
        {charts.isLoading ? <QueueLoading /> : charts.isError ? <PanelError onRetry={() => void charts.refetch()} /> : <Distribution rows={statuses.map((row) => ({ ...row, label: shortStatus(row.code ?? "", row.label) }))} empty="No bug workflow data" />}
      </section>
      <section className="dash-surface">
        <div className="dash-panel-header"><h2>Top modules</h2><span className="dash-hint">where bugs concentrate</span></div>
        {charts.isLoading ? <QueueLoading /> : charts.isError ? <PanelError onRetry={() => void charts.refetch()} /> : <Distribution rows={modules} empty="No module data yet" />}
      </section>
    </div>

    {/* ---------- activity ---------- */}
    <div className="dash-row dash-row-1">
      <section className="dash-surface">
        <div className="dash-panel-header">
          <h2>Recent activity</h2>
          {canReadActivity ? <Link to="/updates/today" className="dash-hint dash-text-link">Daily updates <ArrowUpRight className="size-3" /></Link> : null}
        </div>
        {!canReadActivity ? <QuietState icon={ShieldCheck} title="Activity access required" description="Your role needs Daily Updates and ticket viewing access." />
          : activity.isLoading ? <QueueLoading />
          : activity.isError ? <PanelError onRetry={() => void activity.refetch()} />
          : !activity.data?.results.length ? <QuietState icon={Activity} title="No recent ticket activity" description="Assignments, fixes, closures and updates appear here." />
          : <ol className="dash-activity">{activity.data.results.map((row) => <li key={`${row.kind}-${row.row_id}`} className="dash-event">
            <span className="dash-event-icon">{row.category === "closed" ? <CheckCheck className="size-3.5" /> : row.category === "rectified" ? <ShieldCheck className="size-3.5" /> : <Activity className="size-3.5" />}</span>
            <div className="dash-event-copy">
              <p><button type="button" className="dash-text-link" onClick={() => setTicketId(row.ticket_uuid)}>{row.reference}</button></p>
              <p title={row.text}>{row.text}</p>
              <span>{row.actor_name || "System"}</span>
            </div>
            <time className="dash-event-time" dateTime={row.at} title={formatDate(row.at)}>{relativeTime(row.at)}</time>
          </li>)}</ol>}
      </section>
    </div>

    <p className="dash-page-note"><CalendarDays className="mr-1 inline size-3" />{longDate()} · Data is scoped to your permissions. No sample figures.</p>
    {ticketId ? <Suspense fallback={null}><TicketDetailDialog open ticketId={ticketId} onOpenChange={(open) => { if (!open) setTicketId(null); }} showVerifyClose={can("tickets.ticket.verify_close")} /></Suspense> : null}
  </div>;
}

/* ===================== pieces ===================== */

function Signal({ label, value, icon: Icon, color, to }: { label: string; value: number; icon: LucideIcon; color: string; to?: string }) {
  const display = useCountUp(value, 700);
  const style = { "--sig-color": color } as CSSProperties;
  const body = <>
    <span className="dash-sig-icon"><Icon className="size-[19px]" aria-hidden /></span>
    <span className="min-w-0">
      <span className="dash-sig-value tnum block" aria-label={`${value} ${label}`}>{display.toLocaleString()}</span>
      <span className="dash-sig-label block">{label}</span>
    </span>
  </>;
  return to ? <Link to={to} className="dash-sig" style={style}>{body}</Link> : <div className="dash-sig" style={style}>{body}</div>;
}

function Metric({ label, value, icon: Icon, color, note, to, suffix, decimals = 0 }: { label: string; value: number; icon: LucideIcon; color: string; note: string; to?: string; suffix?: string; decimals?: number }) {
  const display = useCountUp(Math.round(value * 10 ** decimals), 750) / 10 ** decimals;
  const style = { "--stat-color": color } as CSSProperties;
  const body = <>
    <span className="dash-metric-top"><Icon aria-hidden />{label}</span>
    <p className="dash-metric-value tnum" aria-label={`${value} ${label}`}>{display.toFixed(decimals)}{suffix}</p>
    <span className="dash-metric-note">{note}{to ? <ArrowUpRight className="size-3" aria-hidden /> : null}</span>
  </>;
  return to ? <Link to={to} className="dash-metric" style={style}>{body}</Link> : <div className="dash-metric" style={style}>{body}</div>;
}

type QueueQuery = { isLoading: boolean; isError: boolean; data?: { results: SupportTicketRow[]; count: number }; refetch: () => unknown };

function QueuePanel<T extends string>({ title, hint, tabs, selected, onSelect, tabsLabel, query, canRead, onOpen, overdue, emptyTitle, emptyNote, footer, link }: {
  title: string; hint: string;
  tabs: { key: T; label: string }[]; selected: T; onSelect: (key: T) => void; tabsLabel: string;
  query: QueueQuery; canRead: boolean; onOpen: (id: string) => void; overdue?: boolean;
  emptyTitle: string; emptyNote: string; footer: string; link?: { to: string; label: string };
}) {
  return <section className="dash-surface">
    <div className="dash-panel-header"><h2>{title}</h2><span className="dash-hint">{hint}</span></div>
    <div className="dash-tabs" role="group" aria-label={tabsLabel}>
      {tabs.map((tab) => <button type="button" key={tab.key} aria-pressed={selected === tab.key} onClick={() => onSelect(tab.key)}>{tab.label}</button>)}
    </div>
    <div className="dash-queue">
      {!canRead ? <QuietState icon={ShieldCheck} title="Ticket access required" description="Ask your administrator for access to this queue." />
        : query.isLoading ? <QueueLoading />
        : query.isError ? <PanelError onRetry={() => void query.refetch()} />
        : query.data?.results.length ? query.data.results.map((row) => <TicketRow key={row.id} row={row} onOpen={onOpen} overdue={overdue} />)
        : <QuietState icon={CheckCircle2} title={emptyTitle} description={emptyNote} />}
    </div>
    <div className="dash-panel-footer">
      <span>{footer}</span>
      {link ? <Link to={link.to} className="dash-text-link">{link.label} <ArrowRight className="size-3" /></Link> : null}
    </div>
  </section>;
}

function TicketRow({ row, onOpen, overdue }: { row: SupportTicketRow; onOpen: (id: string) => void; overdue?: boolean }) {
  const Icon = row.ticket_type === "BUG" ? Bug : row.ticket_type === "ACCESS_REQUEST" ? KeyRound : ClipboardList;
  const status = row.effective_status || row.status;
  const style = { "--type-color": TYPE_COLOR[row.ticket_type] ?? "var(--dash-violet)" } as CSSProperties;
  return <button type="button" className="dash-ticket-row" style={style} onClick={() => onOpen(row.id)} aria-label={`Open ${row.reference}: ${row.title}`}>
    <span className="dash-ticket-icon"><Icon className="size-[15px]" aria-hidden /></span>
    <span className="dash-ticket-copy">
      <strong title={row.title}>{row.title}</strong>
      <span className="dash-ticket-meta">
        <span className="dash-ticket-ref">{row.reference}</span><span aria-hidden>·</span>
        <span>{row.ticket_type === "BUG" ? "Bug" : row.ticket_type === "SERVICE_REQUEST" ? "Service" : row.ticket_type === "ACCESS_REQUEST" ? "Access" : "Unclassified"}</span>
      </span>
    </span>
    {overdue && row.overdue_days
      ? <span className="dash-ticket-overdue"><Clock3 className="mr-1 inline size-2.5" />{row.overdue_days}d late</span>
      : <span className="dash-ticket-badge" data-status={status}>{status === "TESTING" ? "Rectified" : status.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase())}</span>}
  </button>;
}

function Distribution({ rows, empty }: { rows: ChartDatum[]; empty: string }) {
  const max = Math.max(...rows.map((row) => row.count), 1);
  return rows.length ? <ul className="dash-bars">{rows.map((row, i) => <li key={`${row.code || row.label}-${i}`}>
    <div className="dash-bar-label"><span title={row.label}>{row.label}</span><strong>{row.count.toLocaleString()}</strong></div>
    <div className="dash-bar-track"><div className="dash-bar-fill" style={{ width: `${row.count / max * 100}%`, background: row.color || COLORS[i % COLORS.length] }} /></div>
  </li>)}</ul> : <QuietState icon={Layers} title={empty} description="This fills in when there is data to show." />;
}

function QuietState({ icon: Icon = Inbox, title, description }: { icon?: LucideIcon; title: string; description: string }) {
  return <div className="dash-empty"><Icon aria-hidden /><strong>{title}</strong><p>{description}</p></div>;
}
function PanelError({ onRetry }: { onRetry: () => void }) { return <ErrorState onRetry={onRetry} className="py-8" />; }
function ChartLoading() { return <div className="py-2"><Skeleton className="h-[212px] w-full rounded-xl" /></div>; }
function QueueLoading() { return <div className="flex flex-col gap-4 py-3">{Array.from({ length: 4 }, (_, i) => <div key={i} className="flex items-center gap-3"><Skeleton className="size-7 rounded-lg" /><div className="flex-1"><Skeleton className="h-3 w-4/5" /><Skeleton className="mt-2 h-2 w-2/5" /></div></div>)}</div>; }
