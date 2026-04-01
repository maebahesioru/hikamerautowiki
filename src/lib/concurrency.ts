/**
 * 配列を同時実行数を抑えて map する（結果の順序は入力と一致）
 */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const cap = Math.max(1, Math.min(Math.floor(concurrency), items.length));
  const out: R[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await mapper(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: cap }, () => worker()));
  return out;
}
