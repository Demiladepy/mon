import {
  Clock3,
  Fingerprint,
  Gauge,
  ShieldCheck,
  UserCheck,
  Users,
} from "lucide-react";
import { formatNaira, maskAccount, useResource } from "../api.js";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  SectionHeader,
  StatusPill,
} from "../components.js";
import type { Policy } from "../types.js";

export function PolicyPage() {
  const policy = useResource<Policy>("/api/policy");

  if (policy.loading && !policy.data) return <LoadingState />;
  if (policy.error && !policy.data) {
    return <ErrorState message={policy.error} retry={policy.refresh} />;
  }
  if (!policy.data) return null;

  const rules = [
    {
      icon: Gauge,
      title: "Per-transaction cap",
      value: formatNaira(policy.data.maxPerTxnKobo),
      description: "Requests above this amount are denied.",
    },
    {
      icon: Clock3,
      title: "Daily aggregate cap",
      value: formatNaira(policy.data.maxPerDayKobo),
      description: "Computed from successful payouts in the ledger.",
    },
    {
      icon: UserCheck,
      title: "Human approval threshold",
      value: formatNaira(policy.data.approvalThresholdKobo),
      description: "Valid requests at or above this amount wait for review.",
    },
    {
      icon: Fingerprint,
      title: "Velocity window",
      value: `${policy.data.velocity.maxPayouts} payouts`,
      description: `Maximum within ${policy.data.velocity.windowMinutes} minutes per agent.`,
    },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Server-side control"
        title="Policy"
        description="The effective rules enforced after validation and before any Monnify disbursement."
        action={<StatusPill status="active" />}
      />

      <div className="policy-banner">
        <ShieldCheck size={24} />
        <div>
          <strong>Models cannot modify these rules</strong>
          <p>
            Tool arguments containing overrides or limit changes are rejected
            before evaluation and recorded as tamper attempts.
          </p>
        </div>
      </div>

      <section className="content-section">
        <SectionHeader title="Payment controls" />
        <div className="rule-grid">
          {rules.map(({ icon: Icon, title, value, description }) => (
            <article className="rule-card" key={title}>
              <span>
                <Icon size={19} />
              </span>
              <div>
                <small>{title}</small>
                <strong>{value}</strong>
                <p>{description}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="content-section">
        <SectionHeader
          title="Allowlisted beneficiaries"
          action={
            <span className="count-label">
              {policy.data.beneficiaryAllowlist.length}
            </span>
          }
        />
        {policy.data.beneficiaryAllowlist.length === 0 ? (
          <EmptyState
            icon={<Users size={22} />}
            title="No beneficiaries allowlisted"
            description="Every beneficiary will require a human approval until one is configured."
          />
        ) : (
          <div className="beneficiary-list">
            {policy.data.beneficiaryAllowlist.map((beneficiary) => (
              <article
                key={`${beneficiary.bankCode}:${beneficiary.accountNumber}`}
              >
                <span className="beneficiary-avatar">
                  {beneficiary.name.charAt(0).toUpperCase()}
                </span>
                <div>
                  <strong>{beneficiary.name}</strong>
                  <small>
                    Bank {beneficiary.bankCode} ·{" "}
                    {maskAccount(beneficiary.accountNumber)}
                  </small>
                </div>
                <StatusPill status="allowlisted" />
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
