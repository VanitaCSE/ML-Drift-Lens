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
                  {predictions.map((pred) => (
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
                      <td>{pred.actual_label || 'Unlabeled'}</td>
                      <td className="request-id">{pred.request_id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
