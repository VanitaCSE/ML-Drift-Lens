import React, { useState, useEffect } from 'react';
import { apiClient } from '../services/apiClient';
import type { PredictionHistoryItem } from '../services/apiClient';

const PAGE_SIZE = 10;

export const PredictionHistory: React.FC = () => {
  const [predictions, setPredictions] = useState<PredictionHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filterPrediction, setFilterPrediction] = useState<'all' | 'normal' | 'attack'>('all');
  const [filterLabel, setFilterLabel] = useState<'all' | 'labeled' | 'unlabeled'>('all');

  const handleLabel = async (id: number, label: 'normal' | 'attack') => {
    try {
      setUpdatingId(id);
      setActionError(null);
      const updated = await apiClient.labelPrediction(id, label);
      setPredictions((prev) =>
        prev.map((item) => (item.id === id ? { ...item, actual_label: updated.actual_label || label } : item))
      );
      setEditingId(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update prediction label');
    } finally {
      setUpdatingId(null);
    }
  };

  const fetchPredictions = async () => {
    try {
      setLoading(true);
      const history = await apiClient.getPredictionHistory({
        limit: PAGE_SIZE + 1,
        offset: page * PAGE_SIZE,
      });
      setPredictions(history.slice(0, PAGE_SIZE));
      setHasNextPage(history.length > PAGE_SIZE);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load prediction history');
      setPredictions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPredictions();
  }, [page]);

  const refresh = () => {
    if (page === 0) {
      void fetchPredictions();
    } else {
      setPage(0);
    }
  };

  const filteredPredictions = predictions.filter((item) => {
    if (filterPrediction === 'normal' && item.prediction.toLowerCase() !== 'normal') return false;
    if (filterPrediction === 'attack' && item.prediction.toLowerCase() !== 'attack') return false;
    if (filterLabel === 'labeled' && !item.actual_label) return false;
    if (filterLabel === 'unlabeled' && Boolean(item.actual_label)) return false;
    return true;
  });

  const verifiedCount = predictions.filter((p) => Boolean(p.actual_label)).length;
  const latencies = predictions
    .map((p) => p.inference_latency_ms)
    .filter((ms): ms is number => typeof ms === 'number' && Number.isFinite(ms))
    .sort((a, b) => a - b);
  const medianLatency = latencies.length > 0
    ? latencies[Math.floor(latencies.length / 2)].toFixed(1)
    : null;

  return (
    <div className="page-shell page-shell-tight">
      <div className="page-header-row align-start">
        <div>
          <p className="eyebrow">Audit &amp; Telemetry</p>
          <h2>Prediction History</h2>
          <p className="page-description">
            Audit log of real-time inference requests, model classifications, confidence scores, and latency benchmarks.
          </p>
        </div>
        <button className="btn btn-secondary" onClick={refresh} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div className="panel-section">
        <div className="section-head">
          <h3>Recent Predictions</h3>
        </div>

        {loading && (
          <div className="loading-block" role="status" aria-live="polite">
            Loading prediction history...
          </div>
        )}

        {!loading && error && (
          <div className="error-panel" role="alert">
            <strong>Unable to load prediction history.</strong>
            <span>Please verify that the backend service is running.</span>
            <small>{error}</small>
            <button className="btn btn-secondary" type="button" onClick={() => void fetchPredictions()}>
              Retry prediction history
            </button>
          </div>
        )}

        {!loading && !error && predictions.length === 0 && (
          <div className="empty-panel" role="status">
            <div className="empty-icon">◌</div>
            <strong>No predictions yet.</strong>
            <span>Run a prediction to see results here.</span>
          </div>
        )}

        {!loading && !error && predictions.length > 0 && (
          <>
            {actionError && (
              <div className="error-panel" role="alert" style={{ marginBottom: '12px' }}>
                <strong>Label update failed.</strong>
                <span>{actionError}</span>
              </div>
            )}

            <div className="history-telemetry-banner" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '16px' }}>
              <div className="stat-card" style={{ padding: '12px 16px', background: 'var(--color-bg-subtle, #f8fafc)', borderRadius: '8px', border: '1px solid var(--color-border, #e2e8f0)' }}>
                <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--color-text-muted, #64748b)', fontWeight: 600 }}>Page Records</span>
                <strong style={{ display: 'block', fontSize: '1.25rem', marginTop: '4px' }}>{predictions.length} inferences</strong>
              </div>
              <div className="stat-card" style={{ padding: '12px 16px', background: 'var(--color-bg-subtle, #f8fafc)', borderRadius: '8px', border: '1px solid var(--color-border, #e2e8f0)' }}>
                <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--color-text-muted, #64748b)', fontWeight: 600 }}>Ground Truth Labeled</span>
                <strong style={{ display: 'block', fontSize: '1.25rem', marginTop: '4px' }}>{verifiedCount} / {predictions.length} verified</strong>
              </div>
              <div className="stat-card" style={{ padding: '12px 16px', background: 'var(--color-bg-subtle, #f8fafc)', borderRadius: '8px', border: '1px solid var(--color-border, #e2e8f0)' }}>
                <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--color-text-muted, #64748b)', fontWeight: 600 }}>Median Latency</span>
                <strong style={{ display: 'block', fontSize: '1.25rem', marginTop: '4px' }}>{medianLatency ? `${medianLatency} ms` : 'N/A'}</strong>
              </div>
            </div>

            <div className="history-filter-bar" style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', marginBottom: '14px', padding: '10px 14px', background: 'var(--color-bg-subtle, #f8fafc)', borderRadius: '8px', border: '1px solid var(--color-border, #e2e8f0)' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-muted, #64748b)' }}>Filters:</span>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted, #64748b)' }}>Class:</span>
                {(['all', 'normal', 'attack'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`btn-mode ${filterPrediction === mode ? 'active' : ''}`}
                    style={{ padding: '3px 10px', fontSize: '0.75rem', borderRadius: '4px', textTransform: 'capitalize' }}
                    onClick={() => setFilterPrediction(mode)}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginLeft: '12px' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted, #64748b)' }}>Ground Truth:</span>
                {(['all', 'labeled', 'unlabeled'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`btn-mode ${filterLabel === mode ? 'active' : ''}`}
                    style={{ padding: '3px 10px', fontSize: '0.75rem', borderRadius: '4px', textTransform: 'capitalize' }}
                    onClick={() => setFilterLabel(mode)}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              {(filterPrediction !== 'all' || filterLabel !== 'all') && (
                <button
                  type="button"
                  className="btn-table-change"
                  style={{ marginLeft: 'auto', fontSize: '0.75rem' }}
                  onClick={() => {
                    setFilterPrediction('all');
                    setFilterLabel('all');
                  }}
                >
                  Reset filters
                </button>
              )}
            </div>

            {filteredPredictions.length === 0 ? (
              <div className="empty-panel" role="status" style={{ padding: '24px 16px' }}>
                <strong>No predictions match the active filter criteria.</strong>
                <span>Try clearing the filters to view all page records.</span>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table" aria-label="Prediction history table">
                  <thead>
                    <tr>
                      <th scope="col">Timestamp</th>
                      <th scope="col">Prediction</th>
                      <th scope="col">Class</th>
                      <th scope="col" className="numeric-col">Confidence</th>
                      <th scope="col" className="numeric-col">Inference Latency</th>
                      <th scope="col">Model Version</th>
                      <th scope="col">Actual Label</th>
                      <th scope="col">Request ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPredictions.map((pred) => (
                    <tr key={pred.id}>
                      <td className="timestamp-cell">{new Date(pred.timestamp).toLocaleString()}</td>
                      <td>
                        <span className={`status-badge ${pred.prediction.toLowerCase()}`}>
                          {pred.prediction.toUpperCase()}
                        </span>
                      </td>
                      <td>
                        <span
                          title={`Binary target class ${pred.prediction_class}: ${pred.prediction_class === 0 ? 'normal (benign traffic)' : pred.prediction_class === 1 ? 'attack (intrusion)' : 'unknown'}`}
                        >
                          <code>{pred.prediction_class}</code>{' '}
                          <small style={{ color: 'var(--color-text-muted)', fontSize: '0.8em' }}>
                            ({pred.prediction_class === 0 ? 'normal' : pred.prediction_class === 1 ? 'attack' : 'N/A'})
                          </small>
                        </span>
                      </td>
                      <td className="numeric-cell">{(pred.confidence * 100).toFixed(2)}%</td>
                      <td className="numeric-cell">{pred.inference_latency_ms == null ? 'N/A' : `${pred.inference_latency_ms.toFixed(2)} ms`}</td>
                      <td><span className="mono-pill">{pred.model_version || 'N/A'}</span></td>
                      <td>
                        {pred.actual_label && editingId !== pred.id ? (
                          <div className="table-action-group">
                            <span className={`status-badge ${pred.actual_label.toLowerCase()}`}>
                              {pred.actual_label.toUpperCase()}
                            </span>
                            <button
                              type="button"
                              className="btn-table-change"
                              onClick={() => setEditingId(pred.id)}
                              title="Correct actual ground-truth label"
                              aria-label={`Change label for prediction ${pred.id}`}
                            >
                              edit
                            </button>
                          </div>
                        ) : (
                          <div className="table-action-group" role="group" aria-label={`Label prediction ${pred.id}`}>
                            <button
                              type="button"
                              className="btn-table-action action-normal"
                              disabled={updatingId === pred.id}
                              onClick={() => void handleLabel(pred.id, 'normal')}
                              title="Label as normal (benign traffic)"
                              aria-label={`Label prediction ${pred.id} as normal`}
                            >
                              {updatingId === pred.id ? '...' : 'Normal'}
                            </button>
                            <button
                              type="button"
                              className="btn-table-action action-attack"
                              disabled={updatingId === pred.id}
                              onClick={() => void handleLabel(pred.id, 'attack')}
                              title="Label as attack (network intrusion)"
                              aria-label={`Label prediction ${pred.id} as attack`}
                            >
                              {updatingId === pred.id ? '...' : 'Attack'}
                            </button>
                            {editingId === pred.id && (
                              <button
                                type="button"
                                className="btn-table-change"
                                onClick={() => setEditingId(null)}
                                aria-label="Cancel editing"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="request-id">{pred.request_id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
            <p className="table-caption-legend" style={{ marginTop: '12px', fontSize: '0.825rem', color: 'var(--color-text-muted)' }}>
              ℹ <strong>Class mapping legend:</strong> <code>0 = normal</code> (benign network traffic), <code>1 = attack</code> (network intrusion). In NSL-KDD binary classification, 0 is the negative baseline class and 1 is the positive attack class.
            </p>
            <div className="pagination-controls" aria-label="Prediction history pagination">
              <button className="btn btn-secondary" onClick={() => setPage((current) => current - 1)} disabled={loading || page === 0}>
                Previous
              </button>
              <span>Page {page + 1}</span>
              <button className="btn btn-secondary" onClick={() => setPage((current) => current + 1)} disabled={loading || !hasNextPage}>
                Next
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
