import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  FileCheck2,
  Plus,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { formatDate, formatNaira, useResource } from "../api.js";
import {
  EmptyState,
  ErrorState,
  InlineLink,
  LoadingState,
  PageHeader,
  SectionHeader,
  StatusPill,
} from "../components.js";
import type { DashboardData } from "../types.js";

export function OverviewPage() {
  const { data, error, loading, refresh } =
    useResource<DashboardData>("/api/dashboard");

  if (loading && !data) return <LoadingState />;
  if (error && !data) return <ErrorState message={error} retry={refresh} />;
  if (!data) return null;

  const walletBody = data.wallet.responseBody;
  const walletKobo =
    walletBody?.availableBalanceKobo ??
    Math.round((walletBody?.availableBalance ?? 0) * 100);
  const recentMovement = [
    ...data.collections.map((collection) => ({
      id: collection.transaction_reference,
      type: "Collection",
      counterparty: collection.customer_name || collection.account_reference,
      amountKobo: collection.amount_kobo,
      date: collection.paid_at || collection.created_at,
      status: collection.status,
      direction: "in" as const,
    })),
    ...data.payouts.map((payout) => ({
      id: payout.idempotencyKey,
      type: "Payout",
      counterparty:
        payout.intent.expectedBeneficiaryName ||
        payout.intent.beneficiaryAccount ||
        "Beneficiary",
      amountKobo: payout.amountKobo,
      date: payout.createdAt,
      status: payout.status,
      direction: "out" as const,
    })),
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Workspace overview"
        title="Cash operations"
        description="A current view of money received, payouts requested, and decisions waiting for you."
        action={
          <span className="environment-badge">
            {data.dryRun ? "Dry-run environment" : "Monnify sandbox"}
          </span>
        }
      />

      <section className="overview-balance">
        <div>
          <span>Available balance</span>
          <strong>{formatNaira(walletKobo)}</strong>
          <small>
            {walletBody?.accountNumber
              ? `Wallet ••••${walletBody.accountNumber.slice(-4)}`
              : "Monnify disbursement wallet"}
          </small>
        </div>
        <div className="overview-actions">
          <NavLink to="/payouts?new=1" className="button button-light">
            <ArrowUpRight size={17} /> Send payout
          </NavLink>
          <NavLink to="/collections?new=1" className="button button-blue-muted">
            <Plus size={17} /> Add collection account
          </NavLink>
        </div>
        <span className="balance-watermark" aria-hidden="true">
          <ShieldCheck />
        </span>
      </section>

      <section className="metric-row" aria-label="Today’s totals">
        <div>
          <span>Collected today</span>
          <strong>{formatNaira(data.metrics.collectedTodayKobo)}</strong>
          <small>{data.collections.length} recent records</small>
        </div>
        <div>
          <span>Paid today</span>
          <strong>{formatNaira(data.metrics.paidTodayKobo)}</strong>
          <small>{data.payouts.length} recent requests</small>
        </div>
        <div>
          <span>Awaiting approval</span>
          <strong>{data.approvals.length}</strong>
          <small>
            {data.approvals.length
              ? "Requires a human decision"
              : "No action required"}
          </small>
        </div>
      </section>

      <div className="overview-grid">
        <section className="content-section">
          <SectionHeader
            title="Recent money movement"
            action={<InlineLink to="/activity">View all</InlineLink>}
          />
          {recentMovement.length === 0 ? (
            <EmptyState
              icon={<Banknote size={22} />}
              title="No money movement yet"
              description="Collections and payouts will appear here after the first real operation."
              action={
                <NavLink to="/collections?new=1" className="button button-primary">
                  Create collection account
                </NavLink>
              }
            />
          ) : (
            <div className="movement-list">
              {recentMovement.map((movement) => (
                <article className="movement-row" key={movement.id}>
                  <span
                    className={`movement-icon movement-${movement.direction}`}
                  >
                    {movement.direction === "in" ? (
                      <ArrowDownLeft size={17} />
                    ) : (
                      <ArrowUpRight size={17} />
                    )}
                  </span>
                  <div>
                    <strong>{movement.counterparty}</strong>
                    <small>
                      {movement.type} · {formatDate(movement.date)}
                    </small>
                  </div>
                  <div className="movement-value">
                    <strong>
                      {movement.direction === "in" ? "+" : "−"}
                      {formatNaira(movement.amountKobo)}
                    </strong>
                    <StatusPill status={movement.status} />
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <aside className="attention-panel">
          <SectionHeader title="Needs attention" />
          {data.approvals.length === 0 ? (
            <EmptyState
              icon={<FileCheck2 size={22} />}
              title="You’re caught up"
              description="Payouts outside automatic policy will wait here."
            />
          ) : (
            <>
              <strong className="attention-count">{data.approvals.length}</strong>
              <p>
                {data.approvals.length === 1
                  ? "Payout is waiting for your decision."
                  : "Payouts are waiting for your decision."}
              </p>
              <NavLink to="/approvals" className="button button-primary">
                Review approvals
              </NavLink>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
