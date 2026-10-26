import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../services/apiClient';
import type { DriftScore } from '../services/apiClient';

const PAGE_SIZE = 20;

function formatScore(value: number, status: string) {
  if (status === 'insufficient_data') return 'Awaiting min 100 samples';
  if (!Number.isFinite(value)) return 'Not available';
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatThreshold(value: number) {
  if (Number.isFinite(value)) return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return '0.2000';
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
                    <td>{formatThreshold(record.threshold)}</td>
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

      {!loading && !error && (
        <div className="panel-section" style={{ marginTop: '20px' }}>
          <div className="section-head">
            <h3>Drift Methodology &amp; PSI Baseline Protocol</h3>
            <span className="badge-pill subtle">10 Decile Frequency Bins</span>
          </div>
          <p className="page-description" style={{ marginBottom: '16px' }}>
            Continuous feature distribution tracking using Population Stability Index (PSI) computed against the training baseline (<code>KDDTrain+.txt</code>, 125,973 samples).
          </p>

          <div className="detail-grid compact-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginBottom: '16px' }}>
            <div className="detail-item" style={{ borderLeft: '3px solid var(--color-success, #16a34a)' }}>
              <span>Stable (No Drift)</span>
              <strong>PSI &lt; 0.10</strong>
              <small style={{ color: 'var(--color-text-muted)' }}>Production distribution closely matches baseline</small>
            </div>
            <div className="detail-item" style={{ borderLeft: '3px solid var(--color-warning, #f59e0b)' }}>
              <span>Moderate Drift</span>
              <strong>0.10 &le; PSI &lt; 0.20</strong>
              <small style={{ color: 'var(--color-text-muted)' }}>Distribution shift detected; flagged for review</small>
            </div>
            <div className="detail-item" style={{ borderLeft: '3px solid var(--color-danger, #ef4444)' }}>
              <span>Actionable Shift</span>
              <strong>PSI &ge; 0.20 (Threshold)</strong>
              <small style={{ color: 'var(--color-text-muted)' }}>Severe shift; triggers automated retraining</small>
            </div>
            <div className="detail-item">
              <span>Sample Requirement</span>
              <strong>Min 100 Observations</strong>
              <small style={{ color: 'var(--color-text-muted)' }}>Guarantees statistical power &amp; prevents bin collapse</small>
            </div>
          </div>

          <div className="table-caption-legend" style={{ fontSize: '0.825rem', color: 'var(--color-text-muted)', lineHeight: '1.5' }}>
            ℹ <strong>Monitored Continuous Telemetry:</strong> Traffic features evaluated across 10 decile probability bins include <code>src_bytes</code>, <code>dst_bytes</code>, <code>duration</code>, <code>count</code>, <code>srv_count</code>, <code>diff_srv_rate</code>, <code>same_srv_rate</code>, and <code>dst_host_srv_count</code>.
          </div>
        </div>
      )}
    </div>
  );
}
