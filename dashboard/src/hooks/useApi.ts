"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  accounts as accountsApi,
  metrics as metricsApi,
  proxies as proxiesApi,
  templates as templatesApi,
  alerts as alertsApi,
  settings as settingsApi,
  type Account,
  type AccountOverview,
  type MetricsEntry,
  type MetricsToday,
  type ProxyItem,
  type TemplateItem,
  type AlertItem,
  type AlertStats,
  type Settings,
} from "@/lib/api";

/* ── generic hook factory ── */

interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

function useApiFetch<T>(
  fetcher: () => Promise<T | null>,
  autoRefreshMs?: number,
): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const doFetch = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetcherRef.current();
      if (mountedRef.current) {
        setData(result);
        setLoading(false);
        setError(null);
      }
    } catch (e) {
      if (mountedRef.current) {
        setLoading(false);
        setError(e instanceof Error ? e.message : "fetch_error");
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    doFetch();

    let interval: ReturnType<typeof setInterval> | undefined;
    if (autoRefreshMs && autoRefreshMs > 0) {
      interval = setInterval(doFetch, autoRefreshMs);
    }

    return () => {
      mountedRef.current = false;
      if (interval) clearInterval(interval);
    };
  }, [doFetch, autoRefreshMs]);

  const refetch = useCallback(async () => {
    await doFetch();
  }, [doFetch]);

  return { data, loading, error, refetch };
}

/* ── exported hooks ── */

export function useAccounts(autoRefreshMs = 15000): UseApiResult<Account[]> {
  return useApiFetch(() => accountsApi.getAll(), autoRefreshMs);
}

export function useOverview(autoRefreshMs = 10000): UseApiResult<AccountOverview> {
  return useApiFetch(() => accountsApi.getOverview(), autoRefreshMs);
}

export function useMetrics(days = 7, accountId?: string): UseApiResult<MetricsEntry[]> {
  return useApiFetch(() => metricsApi.get(days, accountId), 30000);
}

export function useMetricsToday(autoRefreshMs = 10000): UseApiResult<MetricsToday> {
  return useApiFetch(() => metricsApi.getToday(), autoRefreshMs);
}

export function useProxies(autoRefreshMs = 20000): UseApiResult<ProxyItem[]> {
  return useApiFetch(() => proxiesApi.getAll(), autoRefreshMs);
}

export function useTemplates(autoRefreshMs = 30000): UseApiResult<TemplateItem[]> {
  return useApiFetch(() => templatesApi.getAll(), autoRefreshMs);
}

export function useAlerts(autoRefreshMs = 10000): UseApiResult<AlertItem[]> {
  return useApiFetch(() => alertsApi.getAll(), autoRefreshMs);
}

export function useAlertStats(autoRefreshMs = 10000): UseApiResult<AlertStats> {
  return useApiFetch(() => alertsApi.getStats(), autoRefreshMs);
}

export function useSettings(): UseApiResult<Settings> {
  return useApiFetch(() => settingsApi.get());
}
