import {
  Building2,
  CircleCheck,
  Plus,
  RefreshCw,
  WalletCards,
  X,
} from "lucide-react";
import { FormEvent, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  api,
  formatDate,
  formatNaira,
  maskAccount,
  useResource,
} from "../api.js";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  SectionHeader,
  StatusPill,
} from "../components.js";
import type { Collection, ReservedAccount } from "../types.js";

export function CollectionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [formOpen, setFormOpen] = useState(searchParams.get("new") === "1");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const accounts = useResource<ReservedAccount[]>("/api/accounts");
  const collections = useResource<Collection[]>("/api/collections");

  function closeForm() {
    setFormOpen(false);
    searchParams.delete("new");
    setSearchParams(searchParams, { replace: true });
  }

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    setSuccess(null);
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{
        status: string;
        result?: {
          responseBody?: { accountReference?: string };
        };
      }>("/api/accounts", {
        method: "POST",
        body: JSON.stringify({
          accountReference: String(form.get("accountReference")),
          accountName: String(form.get("accountName")),
          customerName: String(form.get("customerName")),
          customerEmail: String(form.get("customerEmail")),
          ...(form.get("identityType") === "bvn"
            ? { bvn: String(form.get("identityNumber")) }
            : { nin: String(form.get("identityNumber")) }),
          idempotencyKey: `account-${crypto.randomUUID()}`,
        }),
      });
      setSuccess(
        result.status === "SUCCESS"
          ? "Reserved account created successfully."
          : `Provider status: ${result.status}`,
      );
      event.currentTarget.reset();
      await accounts.refresh();
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (
    (accounts.loading && !accounts.data) ||
    (collections.loading && !collections.data)
  ) {
    return <LoadingState />;
  }
  if (accounts.error && !accounts.data) {
    return <ErrorState message={accounts.error} retry={accounts.refresh} />;
  }

  const accountRows = accounts.data ?? [];
  const collectionRows = collections.data ?? [];

  return (
    <div className="page">
      <PageHeader
        eyebrow="Monnify collections"
        title="Collections"
        description="Create dedicated reserved accounts and reconcile incoming customer transfers."
        action={
          <button
            className="button button-primary"
            onClick={() => setFormOpen((open) => !open)}
          >
            {formOpen ? <X size={17} /> : <Plus size={17} />}
            {formOpen ? "Close" : "New account"}
          </button>
        }
      />

      {formOpen && (
        <section className="form-panel" aria-labelledby="account-form-title">
          <div className="form-panel-heading">
            <div>
              <span className="eyebrow">Reserved account</span>
              <h2 id="account-form-title">Add a collection account</h2>
            </div>
            <button className="icon-button" onClick={closeForm} aria-label="Close">
              <X size={19} />
            </button>
          </div>
          <form className="product-form" onSubmit={createAccount}>
            <label>
              Account reference
              <input
                name="accountReference"
                placeholder="Unique reference from your system"
                minLength={8}
                required
              />
            </label>
            <label>
              Account display name
              <input
                name="accountName"
                placeholder="Name shown on the account"
                required
              />
            </label>
            <label>
              Customer name
              <input name="customerName" autoComplete="name" required />
            </label>
            <label>
              Customer email
              <input
                name="customerEmail"
                type="email"
                autoComplete="email"
                required
              />
            </label>
            <label>
              Identity type
              <select name="identityType" defaultValue="nin">
                <option value="nin">NIN</option>
                <option value="bvn">BVN</option>
              </select>
            </label>
            <label>
              Identity number
              <input
                name="identityNumber"
                inputMode="numeric"
                pattern="\d{11}"
                autoComplete="off"
                required
                aria-describedby="identity-help"
              />
              <small id="identity-help">
                Sent to Monnify only. Rein does not persist it.
              </small>
            </label>
            <div className="form-footer form-span">
              <p>
                Monnify creates the account after validating the supplied
                identity.
              </p>
              <button className="button button-primary" disabled={busy}>
                {busy ? <RefreshCw className="spin" size={16} /> : <Plus size={16} />}
                {busy ? "Creating…" : "Create account"}
              </button>
            </div>
            {formError && (
              <p className="form-message message-error form-span" role="alert">
                <X size={16} /> {formError}
              </p>
            )}
            {success && (
              <p className="form-message message-success form-span" role="status">
                <CircleCheck size={16} /> {success}
              </p>
            )}
          </form>
        </section>
      )}

      <section className="content-section">
        <SectionHeader title="Reserved accounts" />
        {accountRows.length === 0 ? (
          <EmptyState
            icon={<WalletCards size={22} />}
            title="No collection accounts"
            description="Create a reserved account to give each customer a dedicated payment destination."
            action={
              <button
                className="button button-primary"
                onClick={() => setFormOpen(true)}
              >
                <Plus size={16} /> Create account
              </button>
            }
          />
        ) : (
          <div className="resource-grid">
            {accountRows.map((account) => (
              <article
                className="account-card"
                key={account.account_reference}
              >
                <div className="account-card-top">
                  <span className="resource-icon">
                    <Building2 size={19} />
                  </span>
                  <StatusPill status="active" />
                </div>
                <strong>{account.account_name}</strong>
                <span>{account.customer_name}</span>
                <dl>
                  <div>
                    <dt>Bank</dt>
                    <dd>{account.bank_name || "Pending provider response"}</dd>
                  </div>
                  <div>
                    <dt>Account</dt>
                    <dd>{maskAccount(account.account_number)}</dd>
                  </div>
                </dl>
                <small>Created {formatDate(account.created_at)}</small>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="content-section">
        <SectionHeader title="Incoming payments" />
        {collectionRows.length === 0 ? (
          <EmptyState
            title="No collections received"
            description="Verified Monnify webhook events will appear here automatically."
          />
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Account reference</th>
                  <th>Reference</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th className="numeric">Amount</th>
                </tr>
              </thead>
              <tbody>
                {collectionRows.map((collection) => (
                  <tr key={collection.transaction_reference}>
                    <td>{collection.customer_name || "—"}</td>
                    <td>{collection.account_reference}</td>
                    <td className="reference-cell">
                      {collection.transaction_reference}
                    </td>
                    <td>{formatDate(collection.paid_at || collection.created_at)}</td>
                    <td>
                      <StatusPill status={collection.status} />
                    </td>
                    <td className="numeric amount-positive">
                      +{formatNaira(collection.amount_kobo)}
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
