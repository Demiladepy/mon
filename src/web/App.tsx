import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  Check,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  Clock3,
  FileCheck2,
  Fingerprint,
  LayoutDashboard,
  Menu,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import {
  FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";

type Intent = {
  amountKobo?: number;
  beneficiaryAccount?: string;
  expectedBeneficiaryName?: string;
  reason?: string;
};

type Approval = {
  idempotency_key: string;
  amount_kobo: number;
  intent: Intent;
  reasons: string[];
  created_at: string;
};

type Collection = {
  transaction_reference: string;
  amount_kobo: number;
  account_reference: string;
  customer_name?: string;
  status: string;
  paid_at?: string;
  created_at: string;
};

type Activity = {
  id: number;
  event_type: string;
  idempotency_key?: string;
  created_at: string;
  details: Record<string, unknown>;
};

type ReservedAccount = {
  account_reference: string;
  account_name: string;
  customer_name: string;
  account_number?: string;
  bank_name?: string;
};

type DashboardData = {
  dryRun: boolean;
  generatedAt: string;
  wallet: {
    responseBody?: {
      availableBalanceKobo?: number;
      availableBalance?: number;
    };
  };
  metrics: {
    collectedTodayKobo: number;
    paidTodayKobo: number;
  };
  collections: Collection[];
  approvals: Approval[];
  accounts: ReservedAccount[];
  activity: Activity[];
};

type ActionMode = "collect" | "pay" | null;

const naira = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function formatNaira(kobo = 0): string {
  return naira.format(kobo / 100);
}

function formatTime(value?: string): string {
  if (!value) return "Just now";
  const date = new Date(value.includes("T") ? value : `${value}Z`);
  if (Number.isNaN(date.valueOf())) return "Just now";
  return new Intl.DateTimeFormat("en-NG", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function Logo() {
  return (
    <div className="brand" aria-label="Rein">
      <span className="brand-mark" aria-hidden="true">
        <span />
        <span />
      </span>
      <span>rein</span>
    </div>
  );
}

function IconButton({
  label,
  children,
  onClick,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button className="icon-button" aria-label={label} onClick={onClick}>
      {children}
    </button>
  );
}

function Skeleton() {
  return (
    <main className="loading-shell" aria-label="Loading operations dashboard">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-hero" />
      <div className="skeleton-row">
        <div className="skeleton" />
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
    </main>
  );
}

function StatusBadge({
  tone,
  children,
}: {
  tone: "success" | "warning" | "danger" | "neutral";
  children: ReactNode;
}) {
  return <span className={`status status-${tone}`}>{children}</span>;
}

const activityContent: Record<
  string,
  { label: string; description: string; tone: string; icon: ReactNode }
> = {
  COLLECTION_RECEIVED: {
    label: "Collection settled",
    description: "Incoming payment reconciled through a reserved account.",
    tone: "blue",
    icon: <ArrowDownLeft size={17} />,
  },
  PAYOUT_EXECUTED: {
    label: "Supplier paid",
    description: "Name inquiry passed and payout completed.",
    tone: "green",
    icon: <ArrowUpRight size={17} />,
  },
  POLICY_DENIED: {
    label: "Instruction blocked",
    description: "The requested payment failed deterministic policy checks.",
    tone: "red",
    icon: <ShieldCheck size={17} />,
  },
  APPROVAL_REQUIRED: {
    label: "Approval requested",
    description: "A valid payment is waiting for a human decision.",
    tone: "amber",
    icon: <Clock3 size={17} />,
  },
  RESERVED_ACCOUNT_CREATED: {
    label: "Collection account opened",
    description: "A dedicated Monnify account is ready to receive funds.",
    tone: "ink",
    icon: <WalletCards size={17} />,
  },
  POLICY_TAMPER_ATTEMPT: {
    label: "Override rejected",
    description: "Untrusted policy fields were stopped at the boundary.",
    tone: "red",
    icon: <Fingerprint size={17} />,
  },
};

function ActionWorkspace({
  mode,
  onClose,
  onComplete,
}: {
  mode: Exclude<ActionMode, null>;
  onClose: () => void;
  onComplete: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "danger";
    text: string;
  } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    const form = new FormData(event.currentTarget);
    const timestamp = Date.now();
    const endpoint = mode === "collect" ? "/api/accounts" : "/api/payouts";
    const body =
      mode === "collect"
        ? {
            accountReference: `customer-${timestamp}`,
            accountName: String(form.get("accountName")),
            customerName: String(form.get("customerName")),
            customerEmail: String(form.get("customerEmail")),
            nin: String(form.get("nin")),
            idempotencyKey: `account-${timestamp}`,
          }
        : {
            amountKobo: Math.round(Number(form.get("amountNaira")) * 100),
            beneficiaryAccount: String(form.get("beneficiaryAccount")),
            beneficiaryBankCode: String(form.get("beneficiaryBankCode")),
            expectedBeneficiaryName: String(
              form.get("expectedBeneficiaryName"),
            ),
            category: "supplier",
            reason: String(form.get("reason")),
            idempotencyKey: `payout-${timestamp}`,
          };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as {
        status?: string;
        errors?: string[];
      };
      if (!response.ok) {
        throw new Error(result.errors?.join(" ") || "Request was rejected.");
      }
      setFeedback({
        tone: "success",
        text:
          mode === "collect"
            ? "Collection account created."
            : result.status === "PENDING_APPROVAL"
              ? "Payment sent for approval."
              : `Payment ${result.status?.toLowerCase() ?? "processed"}.`,
      });
      await onComplete();
    } catch (error) {
      setFeedback({ tone: "danger", text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="action-workspace" aria-labelledby="action-title">
      <div className="action-heading">
        <div>
          <span className="eyebrow">
            {mode === "collect" ? "Monnify collections" : "Protected payout"}
          </span>
          <h2 id="action-title">
            {mode === "collect"
              ? "Open a customer collection account"
              : "Pay a supplier"}
          </h2>
        </div>
        <IconButton label="Close action" onClick={onClose}>
          <X size={20} />
        </IconButton>
      </div>

      <form className="action-form" onSubmit={submit}>
        {mode === "collect" ? (
          <>
            <label>
              Customer name
              <input
                name="customerName"
                defaultValue="Aderonke Stores"
                required
              />
            </label>
            <label>
              Account display name
              <input
                name="accountName"
                defaultValue="Aderonke Stores Collection"
                required
              />
            </label>
            <label>
              Customer email
              <input
                type="email"
                name="customerEmail"
                defaultValue="accounts@aderonke.example"
                required
              />
            </label>
            <label>
              NIN
              <input
                name="nin"
                inputMode="numeric"
                pattern="\d{11}"
                defaultValue="12345678901"
                required
                aria-describedby="nin-help"
              />
              <small id="nin-help">
                Sent to Monnify for account creation. Never written to audit.
              </small>
            </label>
          </>
        ) : (
          <>
            <label>
              Amount
              <span className="money-input">
                <span>₦</span>
                <input
                  name="amountNaira"
                  inputMode="decimal"
                  defaultValue="8500"
                  required
                />
              </span>
            </label>
            <label>
              Beneficiary name
              <input
                name="expectedBeneficiaryName"
                defaultValue="Musa Ibrahim"
                required
              />
            </label>
            <label>
              Account number
              <input
                name="beneficiaryAccount"
                inputMode="numeric"
                pattern="\d{10}"
                defaultValue="0123456789"
                required
              />
            </label>
            <label>
              Bank code
              <input
                name="beneficiaryBankCode"
                inputMode="numeric"
                defaultValue="058"
                required
              />
            </label>
            <label className="form-wide">
              Reason
              <input
                name="reason"
                defaultValue="Today's flour delivery"
                required
              />
            </label>
          </>
        )}
        <div className="form-submit form-wide">
          <p>
            {mode === "collect"
              ? "Creates a dedicated reserved account on Monnify."
              : "Name inquiry and policy checks run before money can move."}
          </p>
          <button className="button button-primary" disabled={busy}>
            {busy ? (
              <>
                <RefreshCw className="spin" size={17} /> Processing
              </>
            ) : (
              <>
                {mode === "collect" ? (
                  <Plus size={17} />
                ) : (
                  <Send size={17} />
                )}
                {mode === "collect" ? "Create account" : "Review & pay"}
              </>
            )}
          </button>
        </div>
        {feedback && (
          <p
            className={`form-feedback feedback-${feedback.tone} form-wide`}
            role="status"
          >
            {feedback.tone === "success" ? (
              <CircleCheck size={17} />
            ) : (
              <X size={17} />
            )}
            {feedback.text}
          </p>
        )}
      </form>
    </section>
  );
}

export function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionMode, setActionMode] = useState<ActionMode>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/dashboard");
      if (!response.ok) throw new Error("Operations data is unavailable.");
      setData((await response.json()) as DashboardData);
      setError(null);
    } catch (loadError) {
      setError((loadError as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function resolveApproval(
    idempotencyKey: string,
    action: "approve" | "deny",
  ) {
    setApprovalBusy(idempotencyKey);
    try {
      const response = await fetch(
        `/api/approvals/${encodeURIComponent(idempotencyKey)}/${action}`,
        { method: "POST" },
      );
      if (!response.ok) throw new Error("Approval state changed. Refreshing.");
      await refresh();
    } catch (approvalError) {
      setError((approvalError as Error).message);
      await refresh();
    } finally {
      setApprovalBusy(null);
    }
  }

  const walletKobo = data?.wallet.responseBody?.availableBalanceKobo
    ? data.wallet.responseBody.availableBalanceKobo
    : Math.round(
        (data?.wallet.responseBody?.availableBalance ?? 0) * 100,
      );
  const latestCollection = data?.collections[0];
  const latestAccount = data?.accounts[0];

  return (
    <div className="app-shell">
      <header className="topbar">
        <Logo />
        <nav className="topbar-nav" aria-label="Product">
          <a href="#operations">Operations</a>
          <a href="#money-path">Money path</a>
          <a href="#foundation">How it works</a>
        </nav>
        <div className="topbar-actions">
          <span className="rail-status">
            <span aria-hidden="true" />
            Monnify rail active
          </span>
          <IconButton
            label={mobileNavOpen ? "Close menu" : "Open menu"}
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
          </IconButton>
          <span className="avatar" aria-label="Demo business">
            AO
          </span>
        </div>
        {mobileNavOpen && (
          <nav className="mobile-menu" aria-label="Mobile product">
            <a href="#operations" onClick={() => setMobileNavOpen(false)}>
              Operations
            </a>
            <a href="#money-path" onClick={() => setMobileNavOpen(false)}>
              Money path
            </a>
            <a href="#foundation" onClick={() => setMobileNavOpen(false)}>
              How it works
            </a>
          </nav>
        )}
      </header>

      <aside className="sidebar" aria-label="Workspace">
        <nav>
          <a className="active" href="#operations">
            <LayoutDashboard size={18} /> Overview
          </a>
          <a href="#money-path">
            <Banknote size={18} /> Cash flow
          </a>
          <a href="#approvals">
            <FileCheck2 size={18} /> Approvals
            {!!data?.approvals.length && (
              <span className="nav-count">{data.approvals.length}</span>
            )}
          </a>
          <a href="#activity">
            <Clock3 size={18} /> Activity
          </a>
        </nav>
        <div className="sidebar-foot">
          <a href="#foundation">
            <Settings2 size={18} /> Policy
          </a>
          <div className="agent-state">
            <span className="agent-orbit">
              <Sparkles size={15} />
            </span>
            <div>
              <strong>Ops assistant</strong>
              <span>Within policy</span>
            </div>
          </div>
        </div>
      </aside>

      <main id="main-content">
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button onClick={() => void refresh()}>Try again</button>
          </div>
        )}
        {!data ? (
          <Skeleton />
        ) : (
          <>
            <section className="page-intro reveal" id="operations">
              <div>
                <span className="eyebrow">Tuesday · Cash operations</span>
                <h1>Your business is moving.</h1>
                <p>
                  Collections are reconciled, supplier payments are handled,
                  and anything unusual waits for you.
                </p>
              </div>
              <button
                className="refresh-button"
                onClick={() => void refresh()}
                aria-label="Refresh operations"
              >
                <RefreshCw size={16} />
                Updated {formatTime(data.generatedAt)}
              </button>
            </section>

            <section className="balance-stage reveal reveal-delay-1">
              <div className="balance-copy">
                <span>Available to operate</span>
                <strong>{formatNaira(walletKobo)}</strong>
                <small>
                  {data.dryRun ? "Protected demo wallet" : "Monnify wallet"} ·
                  NGN
                </small>
              </div>
              <div className="balance-actions">
                <button
                  className="button button-light"
                  onClick={() => setActionMode("pay")}
                >
                  <Send size={17} /> Pay supplier
                </button>
                <button
                  className="button button-blue-quiet"
                  onClick={() => setActionMode("collect")}
                >
                  <Plus size={17} /> Collection account
                </button>
              </div>
              <div className="balance-grid" aria-hidden="true" />
            </section>

            {actionMode && (
              <ActionWorkspace
                mode={actionMode}
                onClose={() => setActionMode(null)}
                onComplete={refresh}
              />
            )}

            <section className="metric-strip reveal reveal-delay-2">
              <div>
                <span>Collected today</span>
                <strong>{formatNaira(data.metrics.collectedTodayKobo)}</strong>
                <small>
                  <ArrowUpRight size={14} /> Reconciled automatically
                </small>
              </div>
              <div>
                <span>Paid to suppliers</span>
                <strong>{formatNaira(data.metrics.paidTodayKobo)}</strong>
                <small>{data.activity.filter((a) => a.event_type === "PAYOUT_EXECUTED").length} completed payouts</small>
              </div>
              <div>
                <span>Needs your attention</span>
                <strong>{data.approvals.length}</strong>
                <small>
                  {data.approvals.length
                    ? "Payment above auto-approval limit"
                    : "Nothing waiting"}
                </small>
              </div>
            </section>

            <section
              className="money-path-section reveal"
              id="money-path"
              aria-labelledby="money-path-title"
            >
              <div className="section-heading">
                <div>
                  <span className="eyebrow">One continuous rail</span>
                  <h2 id="money-path-title">From customer to supplier</h2>
                </div>
                <span className="path-reference">
                  {latestCollection?.transaction_reference ??
                    "Waiting for first collection"}
                </span>
              </div>
              <div className="money-path">
                <div className="path-node complete">
                  <span className="path-icon">
                    <ArrowDownLeft size={18} />
                  </span>
                  <div>
                    <small>01 · Collected</small>
                    <strong>
                      {formatNaira(latestCollection?.amount_kobo ?? 0)}
                    </strong>
                    <span>
                      {latestCollection?.customer_name ?? "Customer payment"}
                    </span>
                  </div>
                </div>
                <div className="path-connector complete">
                  <span />
                </div>
                <div className="path-node complete">
                  <span className="path-icon">
                    <Sparkles size={18} />
                  </span>
                  <div>
                    <small>02 · Assigned</small>
                    <strong>Invoice understood</strong>
                    <span>Ops assistant formed typed intent</span>
                  </div>
                </div>
                <div className="path-connector complete">
                  <span />
                </div>
                <div className="path-node complete">
                  <span className="path-icon">
                    <Fingerprint size={18} />
                  </span>
                  <div>
                    <small>03 · Verified</small>
                    <strong>Musa Ibrahim</strong>
                    <span>Monnify name inquiry matched</span>
                  </div>
                </div>
                <div className="path-connector complete">
                  <span />
                </div>
                <div className="path-node complete">
                  <span className="path-icon">
                    <Check size={18} />
                  </span>
                  <div>
                    <small>04 · Paid</small>
                    <strong>{formatNaira(850_000)}</strong>
                    <span>Policy allowed · settled</span>
                  </div>
                </div>
              </div>
            </section>

            <div className="operations-grid">
              <section
                className="activity-section"
                id="activity"
                aria-labelledby="activity-title"
              >
                <div className="section-heading compact">
                  <div>
                    <span className="eyebrow">Live ledger</span>
                    <h2 id="activity-title">Recent operations</h2>
                  </div>
                  <button className="text-button" onClick={() => void refresh()}>
                    Refresh <RefreshCw size={14} />
                  </button>
                </div>
                <div className="activity-list">
                  {data.activity.slice(0, 8).map((item) => {
                    const content =
                      activityContent[item.event_type] ??
                      ({
                        label: item.event_type
                          .toLowerCase()
                          .replaceAll("_", " "),
                        description: "Recorded in the append-only ledger.",
                        tone: "ink",
                        icon: <CircleDashed size={17} />,
                      } as const);
                    return (
                      <article className="activity-row" key={item.id}>
                        <span
                          className={`activity-icon activity-${content.tone}`}
                          aria-hidden="true"
                        >
                          {content.icon}
                        </span>
                        <div>
                          <strong>{content.label}</strong>
                          <p>{content.description}</p>
                        </div>
                        <time>{formatTime(item.created_at)}</time>
                      </article>
                    );
                  })}
                </div>
              </section>

              <aside
                className="approval-section"
                id="approvals"
                aria-labelledby="approval-title"
              >
                <div className="section-heading compact">
                  <div>
                    <span className="eyebrow">Human checkpoint</span>
                    <h2 id="approval-title">Waiting for you</h2>
                  </div>
                  <StatusBadge
                    tone={data.approvals.length ? "warning" : "neutral"}
                  >
                    {data.approvals.length}
                  </StatusBadge>
                </div>
                {data.approvals.length ? (
                  data.approvals.map((approval) => (
                    <article
                      className="approval-item"
                      key={approval.idempotency_key}
                    >
                      <div className="approval-amount">
                        <div>
                          <span>Supplier payment</span>
                          <strong>
                            {formatNaira(
                              approval.intent.amountKobo ??
                                approval.amount_kobo,
                            )}
                          </strong>
                        </div>
                        <StatusBadge tone="warning">Review</StatusBadge>
                      </div>
                      <dl>
                        <div>
                          <dt>To</dt>
                          <dd>
                            {approval.intent.expectedBeneficiaryName ??
                              "Supplier"}
                          </dd>
                        </div>
                        <div>
                          <dt>For</dt>
                          <dd>{approval.intent.reason ?? "Supplier order"}</dd>
                        </div>
                        <div>
                          <dt>Check</dt>
                          <dd>Name inquiry passed</dd>
                        </div>
                      </dl>
                      <p className="approval-reason">
                        <ShieldCheck size={16} />
                        {approval.reasons[0] ??
                          "Amount requires your approval."}
                      </p>
                      <div className="approval-actions">
                        <button
                          className="button button-primary"
                          disabled={
                            approvalBusy === approval.idempotency_key
                          }
                          onClick={() =>
                            void resolveApproval(
                              approval.idempotency_key,
                              "approve",
                            )
                          }
                        >
                          <Check size={16} /> Approve
                        </button>
                        <button
                          className="button button-quiet"
                          disabled={
                            approvalBusy === approval.idempotency_key
                          }
                          onClick={() =>
                            void resolveApproval(
                              approval.idempotency_key,
                              "deny",
                            )
                          }
                        >
                          Deny
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="approval-empty">
                    <span>
                      <Check size={22} />
                    </span>
                    <strong>Everything is handled</strong>
                    <p>New exceptions will wait here for your decision.</p>
                  </div>
                )}
              </aside>
            </div>

            <section className="account-ribbon">
              <div>
                <span className="account-symbol">
                  <WalletCards size={20} />
                </span>
                <div>
                  <span className="eyebrow">Newest collection account</span>
                  <strong>
                    {latestAccount?.account_name ?? "No account created"}
                  </strong>
                </div>
              </div>
              <div className="account-details">
                <span>
                  {latestAccount?.bank_name ?? "Moniepoint Microfinance Bank"}
                </span>
                <strong>
                  {latestAccount?.account_number ?? "•••• •••• ••"}
                </strong>
              </div>
              <button
                className="text-button"
                onClick={() => setActionMode("collect")}
              >
                Add another <ChevronRight size={15} />
              </button>
            </section>

            <section className="foundation" id="foundation">
              <div className="foundation-copy">
                <span className="eyebrow">Built on Monnify</span>
                <h2>Useful automation. Financial certainty.</h2>
                <p>
                  Rein gives your operations assistant room to work while the
                  payment rail keeps every decision typed, checked, and
                  accountable.
                </p>
                <a href="#money-path" className="foundation-link">
                  Follow a payment end to end <ArrowRight size={16} />
                </a>
              </div>
              <div className="foundation-stack">
                <div>
                  <span>1</span>
                  <div>
                    <strong>Dedicated collections</strong>
                    <p>
                      Reserved accounts turn every incoming transfer into a
                      reconciled business event.
                    </p>
                  </div>
                  <WalletCards size={20} />
                </div>
                <div>
                  <span>2</span>
                  <div>
                    <strong>Verified payouts</strong>
                    <p>
                      Monnify name inquiry confirms the person before
                      disbursement.
                    </p>
                  </div>
                  <Users size={20} />
                </div>
                <div>
                  <span>3</span>
                  <div>
                    <strong>Deterministic control</strong>
                    <p>
                      Server-side caps, allowlists, approvals, and idempotency
                      stay outside the model.
                    </p>
                  </div>
                  <ShieldCheck size={20} />
                </div>
              </div>
            </section>
          </>
        )}
      </main>

      <nav className="mobile-tabbar" aria-label="Mobile workspace">
        <a className="active" href="#operations">
          <LayoutDashboard size={19} />
          <span>Overview</span>
        </a>
        <a href="#money-path">
          <Banknote size={19} />
          <span>Cash flow</span>
        </a>
        <a href="#approvals">
          <FileCheck2 size={19} />
          <span>Approvals</span>
          {!!data?.approvals.length && <i>{data.approvals.length}</i>}
        </a>
      </nav>
    </div>
  );
}
