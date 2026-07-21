import { Check, FileCheck2, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { api, formatDate, formatNaira, maskAccount, useResource } from "../api.js";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusPill,
} from "../components.js";
import type { Approval } from "../types.js";

export function ApprovalsPage() {
  const approvals = useResource<Approval[]>("/api/approvals");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function resolve(
    idempotencyKey: string,
    action: "approve" | "deny",
  ) {
    setBusy(idempotencyKey);
    setActionError(null);
    try {
      await api(`/api/approvals/${encodeURIComponent(idempotencyKey)}/${action}`, {
        method: "POST",
      });
      await approvals.refresh();
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (approvals.loading && !approvals.data) return <LoadingState />;
  if (approvals.error && !approvals.data) {
    return <ErrorState message={approvals.error} retry={approvals.refresh} />;
  }

  const rows = approvals.data ?? [];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Human-in-the-loop"
        title="Approvals"
        description="Review valid payment requests that policy deliberately held for a person."
        action={
          <button className="button button-secondary" onClick={approvals.refresh}>
            <RefreshCw size={16} /> Refresh
          </button>
        }
      />

      {actionError && (
        <p className="form-message message-error" role="alert">
          <X size={16} /> {actionError}
        </p>
      )}

      {rows.length === 0 ? (
        <section className="content-section">
          <EmptyState
            icon={<FileCheck2 size={22} />}
            title="No approvals waiting"
            description="When an otherwise valid request crosses an approval threshold or targets a new beneficiary, it will appear here."
          />
        </section>
      ) : (
        <div className="approval-grid">
          {rows.map((approval) => (
            <article
              className="approval-card"
              key={approval.idempotency_key}
            >
              <header>
                <div>
                  <span className="eyebrow">Payout request</span>
                  <strong>
                    {formatNaira(
                      approval.intent.amountKobo ?? approval.amount_kobo,
                    )}
                  </strong>
                </div>
                <StatusPill status="pending approval" />
              </header>
              <dl className="approval-details">
                <div>
                  <dt>Beneficiary</dt>
                  <dd>
                    {approval.intent.expectedBeneficiaryName || "Unknown"}
                  </dd>
                </div>
                <div>
                  <dt>Account</dt>
                  <dd>{maskAccount(approval.intent.beneficiaryAccount)}</dd>
                </div>
                <div>
                  <dt>Reason</dt>
                  <dd>{approval.intent.reason || "No reason supplied"}</dd>
                </div>
                <div>
                  <dt>Requested</dt>
                  <dd>{formatDate(approval.created_at)}</dd>
                </div>
              </dl>
              <div className="policy-explanation">
                <ShieldCheck size={18} />
                <div>
                  <strong>Why it stopped</strong>
                  {approval.reasons.map((reason) => (
                    <p key={reason}>{reason}</p>
                  ))}
                </div>
              </div>
              <footer>
                <button
                  className="button button-primary"
                  disabled={busy === approval.idempotency_key}
                  onClick={() =>
                    void resolve(approval.idempotency_key, "approve")
                  }
                >
                  {busy === approval.idempotency_key ? (
                    <RefreshCw className="spin" size={16} />
                  ) : (
                    <Check size={16} />
                  )}
                  Approve & send
                </button>
                <button
                  className="button button-danger-quiet"
                  disabled={busy === approval.idempotency_key}
                  onClick={() => void resolve(approval.idempotency_key, "deny")}
                >
                  <X size={16} /> Deny
                </button>
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
