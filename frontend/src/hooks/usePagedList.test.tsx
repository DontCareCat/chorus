// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePagedList } from "./usePagedList";

const source = (n: number) => {
  const rows = Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
  const fetch = vi.fn(async (offset: number, limit: number) => ({ total: rows.length, items: rows.slice(offset, offset + limit) }));
  return { rows, fetch };
};

describe("usePagedList", () => {
  it("loads one page, adds the next ones, and reloads what was loaded in chunks of at most 500", async () => {
    const s = source(1200);
    const { result } = renderHook(() => usePagedList(s.fetch, [], 300));
    await waitFor(() => expect(result.current.data?.items).toHaveLength(300));
    for (const n of [600, 900]) {
      act(() => result.current.loadMore());
      await waitFor(() => expect(result.current.data?.items).toHaveLength(n));
    }
    expect(result.current.hasMore).toBe(true);
    s.fetch.mockClear();
    act(() => result.current.reload());
    await waitFor(() => expect(s.fetch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(s.fetch.mock.calls).toEqual([[0, 500], [500, 400]]);
    expect(result.current.data?.items.map((r) => r.id)).toEqual(s.rows.slice(0, 900).map((r) => r.id));
  });
  it("never shows a row twice when a new one pushed the pages along", async () => {
    const s = source(150);
    const { result } = renderHook(() => usePagedList(s.fetch, [], 100));
    await waitFor(() => expect(result.current.data?.items).toHaveLength(100));
    s.rows.unshift({ id: 999 }); // a word added at the top: row 100 is now on page two as well
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loadingMore).toBe(false));
    const ids = result.current.data!.items.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(150);
  });
  it("starts again from the first page when the filters change, ignoring the old answer", async () => {
    let q = "a";
    const fetch = vi.fn(async (offset: number, limit: number) => ({ total: 300, items: Array.from({ length: limit }, (_, i) => ({ id: offset + i + (q === "a" ? 0 : 1000) })) }));
    const { result, rerender } = renderHook(({ filter }) => usePagedList(fetch, [filter], 100), { initialProps: { filter: "a" } });
    await waitFor(() => expect(result.current.data?.items).toHaveLength(100));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.data?.items).toHaveLength(200));
    q = "b";
    rerender({ filter: "b" });
    await waitFor(() => expect(result.current.data?.items[0]?.id).toBe(1000));
    expect(result.current.data?.items).toHaveLength(100);
  });
});
