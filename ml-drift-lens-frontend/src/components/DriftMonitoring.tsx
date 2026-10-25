import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../services/apiClient';
import type { DriftScore } from '../services/apiClient';

const PAGE_SIZE = 20;

function formatScore(value: number, status: string) {
  if (status === 'insufficient_data' || !Number.isFinite(value)) return 'Not available';
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatStatus(status: string) {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatTimestamp(timestamp: string) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleString();
}

export function DriftMonitoring() {
  const [records, setRecords] = useState<DriftScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);

  const loadRecords = useCallback(async () => {
    try {
      setLoading(true);
      const history = await apiClient.getDriftHistory({
        limit: PAGE_SIZE + 1,
        offset: page * PAGE_SIZE,
      });
      setRecords(history.slice(0, PAGE_SIZE));
      setHasNextPage(history.length > PAGE_SIZE);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load drift history');
      setRecords([]);
      setHasNextPage(false);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  return (
    <div className="page-shell page-shell-tight">
      <div className="page-header-row align-start">
        <div>
          <p className="eyebrow">Monitoring</p>
          <h2>Drift monitoring</h2>
          <p className="page-description">
            Persisted drift readings from the backend. Records marked insufficient data do not contain a measured score.
          </p>
        </div>
        <button className="btn btn-secondary" type="button" onClick={() => void loadRecords()} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {loading && <div className="loading-block" role="status" aria-live="polite">Loading drift history...</div>}

      {!loading && error && (
        <div className="error-panel" role="alert">
          <strong>Drift history is unavailable.</strong>
          <span>Verify the backend connection, then retry.</span>
          <small>{error}</small>
          <button className="btn btn-secondary" type="button" onClick={() => void loadRecords()}>Retry drift history</button>
        </div>
      )}

      {!loading && !error && records.length === 0 && (
        <div className="empty-panel" role="status">
          <strong>No drift records have been recorded.</strong>
          <span>This is an empty history, not a finding that drift is absent.</span>
        </div>
      )}

      {!loading && !error && records.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="data-table" aria-label="Persisted drift history">
              <thead>
                <tr>
                  <th scope="col">Recorded</th>
                  <th scope="col">Model ID</th>
                  <th scope="col">Metric</th>
                  <th scope="col">Drift score</th>
                  <th scope="col">Threshold</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id}>
                    <td>{formatTimestamp(record.timestamp)}</td>
                    <td>{record.model_id}</td>
                    <td>{record.metric_type}</td>
                    <td>{formatScore(record.score, record.status)}</td>
                    <td>{formatScore(record.threshold, record.status)}</td>
                    <td>{formatStatus(record.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination-controls" aria-label="Drift history pagination">
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => setPage((current) => current - 1)}
              disabled={loading || page === 0}
            >
              Previous
            </button>
            <span aria-live="polite">Page {page + 1}</span>
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => setPage((current) => current + 1)}
              disabled={loading || !hasNextPage}
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
