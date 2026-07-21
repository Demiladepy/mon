import { useCallback, useEffect, useState } from "react";

const AGENT_TOKEN_KEY = "rein_agent_token";
const APPROVER_TOKEN_KEY = "rein_approver_token";

/** Demo defaults match `.env.example`. Override via localStorage or headers. */
const DEMO_AGENT_TOKEN = "rein-demo-ops-token";
const DEMO_APPROVER_TOKEN = "rein-demo-approver-token";

export function getAgentToken(): string {
  return localStorage.getItem(AGENT_TOKEN_KEY) || DEMO_AGENT_TOKEN;
}

export function getApproverToken(): string {
  return localStorage.getItem(APPROVER_TOKEN_KEY) || DEMO_APPROVER_TOKEN;
}

export function setAgentToken(token: string): void {
  localStorage.setItem(AGENT_TOKEN_KEY, token);
}

export function setApproverToken(token: string): void {
  localStorage.setItem(APPROVER_TOKEN_KEY, token);
}

export async function api<T>(
  path: string,
  init?: RequestInit & { auth?: "agent" | "approver" | "none" },
): Promise<T> {
  const auth = init?.auth ?? (init?.method && init.method !== "GET" ? "agent" : "none");
  const headers: Record<string, string> = {
    ...(init?.body ? { "Content-Type": "application/json" } : {}),
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (auth === "agent") {
    headers["X-Rein-Agent-Token"] = getAgentToken();
  }
  if (auth === "approver") {
    headers["X-Rein-Approver-Token"] = getApproverToken();
  }

  const response = await fetch(path, {
    ...init,
    headers,
  });
  const body = (await response.json()) as T & {
    error?: string;
    errors?: string[];
  };
  if (!response.ok) {
    throw new Error(
      body.errors?.join(" ") ?? body.error ?? "The request could not be completed.",
    );
  }
  return body;
}

export function useResource<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (resourceError) {
      setError((resourceError as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, error, loading, refresh, setData };
}

export function formatNaira(kobo = 0): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(kobo / 100);
}

export function formatDate(value?: string): string {
  if (!value) return "—";
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.valueOf())) return "—";
  return new Intl.DateTimeFormat("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function maskAccount(value?: string): string {
  if (!value) return "—";
  return `••••••${value.slice(-4)}`;
}
