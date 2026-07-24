// Paginated, fail-loud reads for any query that must return a COMPLETE set.
//
// Why this exists
// ---------------
// PostgREST silently caps every response at 1000 rows. No error is raised, so a
// partial result is byte-indistinguishable from a complete one. Any surface that
// renders a document, exports a file, or derives a number from "all the rows"
// will happily present the truncated set as fact. That is exactly how the
// season schedule PDF came to print "200 games" for a 260-game season and stop
// two weeks early with no indication anything was missing.
//
// The rule this module enforces: a read either returns EVERY row or it throws.
// It never returns a short array. Callers surface the throw; they must not
// fall back to a partial or empty list, because "no games found" and "we could
// not read the games" look identical to an admin and only one of them is safe
// to print.
//
// Two properties make the completeness guarantee real:
//
//   1. EXACT COUNT ON THE FIRST PAGE. Without a known target, paging has to
//      infer "end of data" from a short page — and a short page is also what a
//      server-side row cap looks like. The count tells the two apart. A read
//      that returns no count THROWS, because a completeness guarantee that
//      cannot be checked is not a guarantee.
//
//   2. CAP DISCOVERY. If a page comes back shorter than requested while the
//      count says more rows exist, the server capped us. The effective page
//      size drops to whatever the server actually allowed and paging continues,
//      so this helper stays correct even if PostgREST's `max-rows` is lowered
//      below our page size later. Guessing a page size "safely under the cap"
//      would silently truncate the day someone changes that setting.
//
// TERMINATION IS BY SHORT PAGE, NEVER BY REACHING THE COUNT. This is subtle and
// was gotten wrong in the first draft, which the harness caught: stopping once
// `rows.length >= count` drops every row inserted after the count was taken. The
// count is a snapshot; treating it as the definition of "done" turns a
// concurrent insert into silent data loss — the exact failure mode being fixed.
// So the count is used ONLY to distinguish a capped page from a final page. The
// price is one extra, empty request when the total is an exact multiple of the
// page size. That is a fair price.
//
// CALLERS MUST SUPPLY A TOTAL ORDER. Range-based paging over a non-unique sort
// key can drop or duplicate rows at page boundaries, because rows tied on the
// sort key have no guaranteed relative order between two separate queries. Every
// query passed here needs a unique tiebreak column (`id`) as its last `.order()`.
// This is not a nicety: SRALL Fall 2026 has three games at the identical
// timestamp straddling row 200, and which of them survived a cut was arbitrary.

/** The subset of a PostgREST response this helper needs. */
export type PagedResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
  count?: number | null;
};

export type PageRange = {
  /** Inclusive start row index. */
  from: number;
  /** Inclusive end row index. */
  to: number;
  /**
   * True only for the first page. Request `{ count: "exact" }` when set, so the
   * COUNT runs once per read rather than once per page.
   */
  exactCount: boolean;
};

export type FetchAllOptions = {
  /**
   * Rows per request. Defaults to 1000 — PostgREST's own cap, so the common
   * single-page case costs exactly one round trip. Cap discovery handles a
   * server configured lower.
   */
  pageSize?: number;
  /**
   * Hard ceiling. Exceeding it throws rather than paging forever into a server
   * component's memory. Hitting this is a DESIGN signal, not a number to raise:
   * a surface with this many rows needs server-side aggregation or a real
   * pagination UI, not a bigger array.
   */
  maxRows?: number;
};

const DEFAULT_PAGE_SIZE = 1000;
const DEFAULT_MAX_ROWS = 10000;

/**
 * Read every row matching a query, or throw.
 *
 * `label` names the read in error messages — it reaches the admin, so make it
 * describe the data ("season schedule games"), not the table.
 *
 * `buildPage` must return a fresh query for each call: supabase-js builders are
 * mutable, so a single builder cannot be re-ranged. Apply `.range(from, to)`
 * and, on the first page only, `{ count: "exact" }`.
 */
export async function fetchAllRows<T>(
  label: string,
  buildPage: (range: PageRange) => PromiseLike<PagedResult<T>>,
  options: FetchAllOptions = {},
): Promise<T[]> {
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  let pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  if (pageSize < 1) throw new Error(`fetchAllRows(${label}): pageSize must be >= 1`);

  const rows: T[] = [];
  let expectedTotal: number | null = null;
  let offset = 0;

  for (;;) {
    const isFirstPage = offset === 0;
    const requested = pageSize;
    const { data, error, count } = await buildPage({
      from: offset,
      to: offset + requested - 1,
      exactCount: isFirstPage,
    });

    // Fail loud. A read error must never degrade into an empty list — that
    // renders as "no games" and prints as a blank schedule.
    if (error) {
      throw new Error(`Could not load ${label}: ${error.message}`);
    }

    const page = data ?? [];
    rows.push(...page);

    if (isFirstPage) {
      // No count means completeness cannot be verified, and an unverifiable
      // read is exactly what this helper exists to prevent. Fail loud: this is
      // a caller bug (the builder forgot `{ count: "exact" }`) and catching it
      // on the first request is far better than truncating silently later.
      if (typeof count !== "number") {
        throw new Error(
          `Could not load ${label}: the read returned no exact row count, so ` +
            `completeness cannot be verified. The query builder must apply ` +
            `{ count: "exact" } when \`exactCount\` is set.`,
        );
      }
      expectedTotal = count;
    }

    if (rows.length > maxRows) {
      throw new Error(
        `Could not load ${label}: more than ${maxRows} rows. This surface needs ` +
          `server-side aggregation or paging rather than a larger limit.`,
      );
    }

    // Nothing came back — end of data. Reachable below `expectedTotal` when
    // rows were deleted between the count and this page; that is a benign race,
    // not a truncation, so it stops the loop without throwing.
    if (page.length === 0) break;

    if (page.length < requested) {
      // Short page: either genuinely the end, or a server-side cap below our
      // page size. The count is the only thing that tells them apart.
      const moreRowsExist =
        expectedTotal !== null && rows.length < expectedTotal;
      if (!moreRowsExist) break;
      // Cap discovered — adopt the server's real page size and keep going.
      pageSize = page.length;
    }

    offset = rows.length;
  }

  return rows;
}
