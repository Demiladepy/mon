import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  CircleAlert,
  FileCheck2,
  Fingerprint,
  RefreshCw,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { useMemo, useState } from "react";
import { formatDate, useResource } from "../api.js";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusPill,
} from "../components.js";
import type { Activity as ActivityRecord } from "../types.js";

const eventMeta: Record<
  string,
  { label: string; group: string; icon: typeof Activity }
> = {
  COLLECTION_RECEIVED: {
    label: "Collection received",
    group: "Collections",
    icon: ArrowDownLeft,
  },
  RESERVED_ACCOUNT_CREATED: {
    label: "Reserved account created",
    group: "Collections",
    icon: WalletCards,
  },
  PAYOUT_EXECUTED: {
    label: "Payout executed",
    group: "Payouts",
    icon: ArrowUpRight,
  },
  INTENT_RECEIVED: {
    label: "Intent received",
    group: "Payouts",
    icon: Fingerprint,
  },
  POLICY_ALLOWED: {
    label: "Policy allowed",
    group: "Policy",
    icon: ShieldCheck,
  },
  POLICY_DENIED: {
    label: "Policy denied",
    group: "Policy",
    icon: CircleAlert,
  },
  POLICY_TAMPER_ATTEMPT: {
    label: "Policy tamper rejected",
    group: "Policy",
    icon: ShieldCheck,
  },
  APPROVAL_REQUIRED: {
    label: "Approval required",
    group: "Approvals",
    icon: FileCheck2,
  },
  APPROVAL_APPROVED: {
    label: "Approval granted",
    group: "Approvals",
    icon: FileCheck2,
  },
  APPROVAL_DENIED: {
    label: "Approval denied",
    group: "Approvals",
    icon: FileCheck2,
  },
};

export function ActivityPage() {
  const activity = useResource<ActivityRecord[]>("/api/activity");
  const [filter, setFilter] = useState("All");
  const filters = ["All", "Collections", "Payouts", "Policy", "Approvals"];
  const rows = useMemo(
    () =>
      (activity.data ?? []).filter(
        (event) =>
          filter === "All" || eventMeta[event.event_type]?.group === filter,
      ),
    [activity.data, filter],
  );

  if (activity.loading && !activity.data) return <LoadingState />;
  if (activity.error && !activity.data) {
    return <ErrorState message={activity.error} retry={activity.refresh} />;
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Append-only ledger"
        title="Activity"
        description="A chronological record of agent intents, policy decisions, provider actions, and human approvals."
        action={
          <button className="button button-secondary" onClick={activity.refresh}>
            <RefreshCw size={16} /> Refresh
          </button>
        }
      />

      <div className="filter-bar" role="group" aria-label="Filter activity">
        {filters.map((option) => (
          <button
            key={option}
            className={filter === option ? "active" : undefined}
            onClick={() => setFilter(option)}
          >
            {option}
          </button>
        ))}
      </div>

      <section className="content-section activity-page-section">
        {rows.length === 0 ? (
          <EmptyState
            icon={<Activity size={22} />}
            title={filter === "All" ? "No activity yet" : `No ${filter.toLowerCase()} activity`}
            description="New verified operations will be recorded here without requiring a refresh."
          />
        ) : (
          <div className="audit-list">
            {rows.map((event) => {
              const meta = eventMeta[event.event_type] ?? {
                label: event.event_type
                  .toLowerCase()
                  .replaceAll("_", " ")
                  .replace(/^\w/, (character) => character.toUpperCase()),
                group: "System",
                icon: Activity,
              };
              const Icon = meta.icon;
              return (
                <article className="audit-row" key={event.id}>
                  <span className="audit-icon">
                    <Icon size={17} />
                  </span>
                  <div className="audit-copy">
                    <strong>{meta.label}</strong>
                    <span>
                      {event.idempotency_key
                        ? `Reference ${event.idempotency_key}`
                        : meta.group}
                    </span>
                  </div>
                  <StatusPill status={meta.group} />
                  <time>{formatDate(event.created_at)}</time>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
