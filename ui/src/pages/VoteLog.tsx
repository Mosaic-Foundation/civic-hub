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

  // Receipt search state
  const [searchInput, setSearchInput] = useState(initialReceipt);
  const [searchResult, setSearchResult] = useState<ReceiptVerifyResponse | null>(null);
  const [searching, setSearching] = useState(false);

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

  // Auto-verify if receipt is in URL
  useEffect(() => {
    if (initialReceipt && id && voteLog?.available) {
      handleSearch(initialReceipt);
    }
  }, [voteLog?.available]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSearch(receiptId?: string) {
    const receipt = receiptId ?? searchInput.trim();
    if (!receipt || !id) return;

    setSearching(true);
    setSearchResult(null);
    try {
      const result = await verifyReceipt(id, receipt);
      setSearchResult(result);
    } catch (err) {
      setSearchResult({
        found: false,
        message: err instanceof Error ? err.message : "Verification failed",
      });
    } finally {
      setSearching(false);
    }
  }

  if (loading) return <p className="detail-page">Loading...</p>;
  if (error) return <p className="detail-page error">Error: {error}</p>;
  if (!process || !id) return (
    <div className="page detail-page">
      <p>Not found.</p>
    </div>
  );

  const isAvailable = voteLog?.available ?? false;

  return (
    <div className="page detail-page">

      <h1>Vote Log</h1>
      <p className="vote-log-subtitle">{process.title}</p>

      {/* Receipt Lookup */}
      <section className="vote-log-section">
        <h2>Find your receipt</h2>

        {!isAvailable ? (
          <p className="vote-log-unavailable">
            Vote log will be available after voting ends.
          </p>
        ) : (
          <>
            <div className="receipt-search">
              <input
                type="text"
                className="receipt-search-input"
                placeholder="Enter your receipt ID"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSearch();
                }}
              />
              <button
                className="receipt-search-button"
                onClick={() => handleSearch()}
                disabled={searching || !searchInput.trim()}
              >
                {searching ? "Searching..." : "Search"}
              </button>
            </div>

            {searchResult && (
              <div
                className={`receipt-result ${searchResult.found ? "receipt-found" : "receipt-not-found"}`}
              >
                {searchResult.found ? (
                  <>
                    <p className="receipt-result-title">Receipt found</p>
                    <p className="receipt-result-choice">
                      Vote: {formatChoice(searchResult.choice!)}
                    </p>
                  </>
                ) : (
                  <p className="receipt-result-title">
                    {searchResult.message ??
                      "Receipt not found. Check your receipt and try again."}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {/* Public Vote Log */}
      <section className="vote-log-section">
        <h2>Public Vote Log</h2>

        {!isAvailable ? (
          <p className="vote-log-unavailable">
            Vote log will be available after voting ends.
          </p>
        ) : voteLog && voteLog.log.length > 0 ? (
          <>
            <p className="vote-log-count">{voteLog.total_votes} votes recorded</p>
            <div className="vote-log-table">
              <div className="vote-log-header">
                <span>Receipt</span>
                <span>Vote</span>
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
                  <span className="vote-log-receipt">{entry.receipt_id}</span>
                  <span className="vote-log-choice">{formatChoice(entry.choice)}</span>
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
