import type { CollectReport, Source, SourcePage, SourceType } from "./types";

type Params = Record<string, string | number | boolean | null | undefined>;

function query(params?: Params): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== null && value !== undefined && value !== "") search.set(key, String(value));
  }
  const value = search.toString();
  return value ? `?${value}` : "";
}

async function request<T>(path: string, init?: RequestInit & { params?: Params }): Promise<T> {
  const { params, ...rest } = init ?? {};
  const response = await fetch(`/api/v1${path}${query(params)}`, {
    ...rest,
    headers: { "Content-Type": "application/json", ...rest.headers },
  });
  if (!response.ok) {
    let detail = `请求失败（HTTP ${response.status}）`;
    try {
      const body = await response.json();
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // Keep the HTTP fallback when the proxy returns a non-JSON error.
    }
    throw new Error(detail);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  listSources: (params: Params) => request<SourcePage>("/sources", { params }),
  supportedSourceTypes: () => request<SourceType[]>("/sources/supported"),
  createSource: (url: string) =>
    request<Source>("/sources", { method: "POST", body: JSON.stringify({ url }) }),
  updateSource: (id: number, enabled: boolean) =>
    request<Source>(`/sources/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),
  deleteSource: (id: number) => request<void>(`/sources/${id}`, { method: "DELETE" }),
  resetSourceCursor: (id: number) =>
    request<void>(`/sources/${id}/reset-cursor`, { method: "POST" }),
  collectSource: (id: number) =>
    request<CollectReport>(`/sources/${id}/collect`, { method: "POST" }),
};
