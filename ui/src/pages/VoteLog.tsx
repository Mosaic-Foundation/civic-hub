import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  getVoteLog,
  verifyReceipt,
  getProcessState,
  type VoteLogResponse,
  type ReceiptVerifyResponse,
  type ProcessState,
} from "../services/api";
import { useAction } from "../hooks/useAction";
import ReceiptCode from "../components/ReceiptCode";

function formatChoice(raw: string): string {
  if (raw.startsWith("[")) {
    try {
      const arr = JSON.parse(raw) as string[];
      return arr.join(", ");
    } catch { /* fall through */ }
  }
  return raw;
}

/** `#receipt=<id>` from the fragment, which the browser never sends to a server. */
function receiptFromHash(hash: string): string {
  const m = /(?:^#|&)receipt=([^&]*)/.exec(hash);
  if (!m) return "";
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return "";
  }
}

/**
 * What a checked code says, in the vote's mode (Actions slice, 2026-10-13):
 *   show the choice: "A ballot with this code was counted in <vote>, for <option>."
 *   counted only:    "A ballot with this code was counted in <vote>."
 */
function countedLine(result: ReceiptVerifyResponse, voteTitle: string): string {
  const vote = `“${result.title ?? voteTitle}”`;
  return result.choice !== undefined
    ? `A ballot with this code was counted in ${vote}, for ${formatChoice(result.choice)}.`
    : `A ballot with this code was counted in ${vote}.`;
}

/**
 * The vote log and the receipt check. The check page a receipt's QR code
 * opens: `/votes/:id/log#receipt=<code>` fills the code in (the fragment is
 * never sent to a server). Before the vote closes it says only that the vote
 * is still open.
 */
export default function VoteLog() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  // The receipt comes in the fragment (2026-10-10). Older links put it in
  // the query string; still read, then moved to the fragment so it is not
  // sent again on a reload.
  const legacyReceipt = searchParams.get("receipt") ?? "";
  const [initialReceipt] = useState(() => receiptFromHash(location.hash) || legacyReceipt);

  useEffect(() => {
    if (legacyReceipt) {
      navigate(`${location.pathname}#receipt=${encodeURIComponent(legacyReceipt)}`, { replace: true });
    }
  }, [legacyReceipt]); // eslint-disable-line react-hooks/exhaustive-deps

  const [process, setProcess] = useState<ProcessState | null>(null);
  const [voteLog, setVoteLog] = useState<VoteLogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The check
  const [searchInput, setSearchInput] = useState(initialReceipt);
  const [searchResult, setSearchResult] = useState<ReceiptVerifyResponse | null>(null);
  // The code the shown result is for. Check stays grey until the box holds
  // another code, so it's clear which code the answer belongs to (2026-10-13).
  const [checkedCode, setCheckedCode] = useState<string | null>(null);
  const check = useAction("The check didn't go through. Please try again.");

  useEffect(() => {
    if (!id) return;

    Promise.all([getProcessState(id), getVoteLog(id)])
      .then(([proc, log]) => {
        setProcess(proc);
        setVoteLog(log);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSearch(receiptId?: string) {
    const receipt = receiptId ?? searchInput.trim();
    if (!receipt || !id) return;
    // The answer replaces the last one when it arrives (and a refusal clears it).
    const result = await check.run(() => verifyReceipt(id, receipt));
    setSearchResult(result ?? null);
    // A refusal leaves Check live, to try again.
    setCheckedCode(result ? receipt : null);
  }
  const alreadyChecked = checkedCode !== null && searchInput.trim() === checkedCode;

  // A code from the link: check it once the log is available.
  useEffect(() => {
    if (initialReceipt && id && voteLog?.available) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- checks the code the link carried, once, when the log loads
      handleSearch(initialReceipt);
    }
  }, [voteLog?.available]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <p className="detail-page">Loading...</p>;
  if (error) return <p className="detail-page error">Error: {error}</p>;
  if (!process || !id) return (
    <div className="page detail-page">
      <p>Not found.</p>
    </div>
  );

  const isAvailable = voteLog?.available ?? false;
  const countedOnly = voteLog?.check_mode === "counted_only";

  return (
    <div className="page detail-page">

      <h1>Vote log</h1>
      <p className="vote-log-subtitle">{process.title}</p>

      {/* The receipt check */}
      <section className="vote-log-section">
        <h2>Check a receipt</h2>

        {!isAvailable ? (
          <p className="vote-log-unavailable">
            This vote is still open. Receipts can be checked once it closes.
          </p>
        ) : (
          <>
            <div className="receipt-search">
              <label htmlFor="receipt-code" className="visually-hidden">Receipt code</label>
              <input
                id="receipt-code"
                type="text"
                className="receipt-search-input"
                placeholder="Enter a receipt code"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !alreadyChecked) handleSearch();
                }}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                className="receipt-search-button"
                onClick={() => handleSearch()}
                disabled={check.busy || !searchInput.trim() || alreadyChecked}
                aria-busy={check.busy}
              >
                {check.busy ? "Checking…" : "Check"}
              </button>
            </div>

            {check.error && <p className="form-error" role="alert">{check.error}</p>}
            {searchResult && (
              <div
                className={`receipt-result ${searchResult.found ? "receipt-found" : "receipt-not-found"}`}
                role="status"
              >
                {searchResult.found ? (
                  <p className="receipt-result-title">{countedLine(searchResult, process.title)}</p>
                ) : (
                  <p className="receipt-result-title">
                    {searchResult.message ??
                      "No ballot with this code was found. Check the code and try again."}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {/* The public vote log */}
      <section className="vote-log-section">
        <h2>Public vote log</h2>

        {!isAvailable ? (
          <p className="vote-log-unavailable">
            The vote log is published once voting ends.
          </p>
        ) : voteLog && voteLog.log.length > 0 ? (
          <>
            <p className="vote-log-count">{voteLog.total_votes} votes recorded</p>
            {countedOnly && (
              <p className="form-hint">
                This vote shows only that each ballot was counted. The totals are on the vote's page.
              </p>
            )}
            <div className={`vote-log-table${countedOnly ? " vote-log-table-codes" : ""}`}>
              <div className="vote-log-header">
                <span>Receipt</span>
                {!countedOnly && <span>Vote</span>}
              </div>
              {voteLog.log.map((entry) => (
                <div
                  key={entry.receipt_id}
                  className={`vote-log-row ${
                    searchResult?.found && searchResult.receipt_id === entry.receipt_id
                      ? "vote-log-row-highlight"
                      : ""
                  }`}
                >
                  <ReceiptCode code={entry.receipt_id} className="vote-log-receipt" />
                  {!countedOnly && entry.choice !== undefined && (
                    <span className="vote-log-choice">{formatChoice(entry.choice)}</span>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="vote-log-empty">No votes recorded yet.</p>
        )}
      </section>
    </div>
  );
}
