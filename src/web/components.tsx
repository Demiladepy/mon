import {
  Activity,
  ArrowRight,
  Banknote,
  BookOpenCheck,
  CheckCircle2,
  CircleAlert,
  FileCheck2,
  LayoutDashboard,
  Menu,
  Plus,
  RefreshCw,
  ShieldCheck,
  WalletCards,
  X,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";

const navigation = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/collections", label: "Collections", icon: WalletCards },
  { to: "/payouts", label: "Payouts", icon: Banknote },
  { to: "/approvals", label: "Approvals", icon: FileCheck2 },
  { to: "/activity", label: "Activity", icon: Activity },
  { to: "/policy", label: "Policy", icon: BookOpenCheck },
] as const;

export function Logo() {
  return (
    <NavLink to="/" className="brand" aria-label="Rein overview">
      <span className="brand-mark" aria-hidden="true">
        <span />
        <span />
      </span>
      <span>rein</span>
    </NavLink>
  );
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="app-navigation" aria-label="Workspace">
      {navigation.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) => (isActive ? "active" : undefined)}
        >
          <Icon size={18} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="product-shell">
      <header className="product-topbar">
        <Logo />
        <div className="topbar-context">
          <span className="connection-dot" />
          Monnify API
        </div>
        <div className="topbar-actions">
          <NavLink to="/collections" className="button button-primary top-action">
            <Plus size={16} />
            New collection account
          </NavLink>
          <span className="profile-mark" aria-label="Rein workspace">
            R
          </span>
          <button
            className="icon-button mobile-menu-trigger"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </header>

      <aside className="product-sidebar">
        <Navigation />
        <div className="sidebar-trust">
          <span>
            <ShieldCheck size={17} />
          </span>
          <div>
            <strong>Policy enforcement</strong>
            <small>Active on every payout</small>
          </div>
        </div>
      </aside>

      {menuOpen && (
        <div className="mobile-navigation">
          <Navigation onNavigate={() => setMenuOpen(false)} />
        </div>
      )}

      <main id="main-content" className="product-main">
        <Outlet />
      </main>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action && <div className="page-header-action">{action}</div>}
    </header>
  );
}

export function LoadingState() {
  return (
    <div className="page-loading" aria-label="Loading">
      <span />
      <span />
      <span />
    </div>
  );
}

export function ErrorState({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}) {
  return (
    <div className="error-state" role="alert">
      <CircleAlert size={22} />
      <div>
        <strong>Couldn’t load this page</strong>
        <p>{message}</p>
      </div>
      <button className="button button-secondary" onClick={retry}>
        <RefreshCw size={16} /> Retry
      </button>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon ?? <CheckCircle2 size={22} />}</span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const normalized = status.toUpperCase();
  const tone = ["SUCCESS", "SUCCESSFUL", "PAID", "ALLOW"].includes(normalized)
    ? "success"
    : ["DENIED", "FAILED", "PROVIDER_ERROR"].includes(normalized)
      ? "danger"
      : ["PENDING_APPROVAL", "REQUIRE_APPROVAL", "PROCESSING"].includes(
            normalized,
          )
        ? "warning"
        : "neutral";
  return (
    <span className={`status-pill status-${tone}`}>
      <span aria-hidden="true" />
      {normalized.replaceAll("_", " ").toLowerCase()}
    </span>
  );
}

export function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-header">
      <h2>{title}</h2>
      {action}
    </div>
  );
}

export function InlineLink({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) {
  return (
    <NavLink className="inline-link" to={to}>
      {children} <ArrowRight size={15} />
    </NavLink>
  );
}
