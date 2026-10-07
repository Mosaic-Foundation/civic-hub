// Split a long id list into requests of `size` ids: a long `in.(...)` filter can pass the URL limit and the row cap.
export async function inChunks<I, T>(
  ids: readonly I[],
  fetch: (chunk: I[]) => PromiseLike<T[]>,
  size = 200,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) {
    out.push(...(await fetch(ids.slice(i, i + size))));
  }
  return out;
}
