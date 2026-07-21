import {
  ArrowUpRight,
  Banknote,
  CircleCheck,
  RefreshCw,
  Send,
  X,
} from "lucide-react";
import { FormEvent, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, formatDate, formatNaira, maskAccount, useResource } from "../api.js";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  SectionHeader,
  StatusPill,
} from "../components.js";
import type { Payout } from "../types.js";

export function PayoutsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [formOpen, setFormOpen] = useState(searchParams.get("new") === "1");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    status: string;
    decision: { effect: string; reasons: string[] };
  } | null>(null);
  const payouts = useResource<Payout[]>("/api/payouts");

  function closeForm() {
    setFormOpen(false);
    searchParams.delete("new");
    setSearchParams(searchParams, { replace: true });
  }

  async function submitPayout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    setResult(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await api<{
        status: string;
        decision: { effect: string; reasons: string[] };
      }>("/api/payouts", {
        method: "POST",
        body: JSON.stringify({
          amountKobo: Math.round(Number(form.get("amountNaira")) * 100),
          beneficiaryAccount: String(form.get("beneficiaryAccount")),
          beneficiaryBankCode: String(form.get("beneficiaryBankCode")),
          expectedBeneficiaryName: String(
            form.get("expectedBeneficiaryName"),
          ),
          category: String(form.get("category")),
          reason: String(form.get("reason")),
          idempotencyKey: `payout-${crypto.randomUUID()}`,
        }),
      });
      setResult(response);
      event.currentTarget.reset();
      await payouts.refresh();
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (payouts.loading && !payouts.data) return <LoadingState />;
  if (payouts.error && !payouts.data) {
    return <ErrorState message={payouts.error} retry={payouts.refresh} />;
  }

  const rows = payouts.data ?? [];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Protected disbursements"
        title="Payouts"
        description="Every request is name-checked and evaluated against server-side policy before execution."
        action={
          <button
            className="button button-primary"
            onClick={() => setFormOpen((open) => !open)}
          >
            {formOpen ? <X size={17} /> : <Send size={17} />}
            {formOpen ? "Close" : "New payout"}
          </button>
        }
      />

      {formOpen && (
        <section className="form-panel" aria-labelledby="payout-form-title">
          <div className="form-panel-heading">
            <div>
              <span className="eyebrow">Typed payment intent</span>
              <h2 id="payout-form-title">Send a payout</h2>
            </div>
            <button className="icon-button" onClick={closeForm} aria-label="Close">
              <X size={19} />
            </button>
          </div>
          <form className="product-form" onSubmit={submitPayout}>
            <label>
              Amount (NGN)
              <input
                name="amountNaira"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                required
              />
            </label>
            <label>
              Expected beneficiary name
              <input name="expectedBeneficiaryName" required />
            </label>
            <label>
              Account number
              <input
                name="beneficiaryAccount"
                inputMode="numeric"
                pattern="\d{10}"
                required
              />
            </label>
            <label>
              Bank code
              <input
                name="beneficiaryBankCode"
                inputMode="numeric"
                pattern="\d{3,6}"
                required
              />
            </label>
            <label>
              Category
              <select name="category" defaultValue="supplier">
                <option value="supplier">Supplier</option>
                <option value="payroll">Payroll</option>
                <option value="utility">Utility</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Reason
              <input name="reason" maxLength={500} required />
            </label>
            <div className="form-footer form-span">
              <p>
                The resolved account name—not this form’s claim—is sent to
                Monnify.
              </p>
              <button className="button button-primary" disabled={busy}>
                {busy ? <RefreshCw className="spin" size={16} /> : <Send size={16} />}
                {busy ? "Evaluating…" : "Evaluate & send"}
              </button>
            </div>
            {formError && (
              <p className="form-message message-error form-span" role="alert">
                <X size={16} /> {formError}
              </p>
            )}
            {result && (
              <div
                className={`decision-message decision-${result.decision.effect.toLowerCase()} form-span`}
                role="status"
              >
                <CircleCheck size={18} />
                <div>
                  <strong>{result.status.replaceAll("_", " ")}</strong>
                  <p>{result.decision.reasons.join(" ")}</p>
                </div>
              </div>
            )}
          </form>
        </section>
      )}

      <section className="content-section">
        <SectionHeader title="Payout history" />
        {rows.length === 0 ? (
          <EmptyState
            icon={<Banknote size={22} />}
            title="No payouts yet"
            description="Your first payout request will show its provider status and complete policy decision here."
            action={
              <button
                className="button button-primary"
                onClick={() => setFormOpen(true)}
              >
                <ArrowUpRight size={16} /> Send payout
              </button>
            }
          />
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Beneficiary</th>
                  <th>Account</th>
                  <th>Category</th>
                  <th>Decision</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th className="numeric">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((payout) => (
                  <tr key={payout.idempotencyKey}>
                    <td>
                      <strong>
                        {payout.intent.expectedBeneficiaryName || "—"}
                      </strong>
                      <small>{payout.intent.reason || "No reason supplied"}</small>
                    </td>
                    <td>{maskAccount(payout.intent.beneficiaryAccount)}</td>
                    <td>{payout.intent.category || "—"}</td>
                    <td>
                      <StatusPill status={payout.effect} />
                    </td>
                    <td>
                      <StatusPill status={payout.status} />
                    </td>
                    <td>{formatDate(payout.createdAt)}</td>
                    <td className="numeric">
                      {formatNaira(payout.amountKobo)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
