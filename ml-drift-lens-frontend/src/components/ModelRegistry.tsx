import React, { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../services/apiClient';
import type { ModelInfo, ModelVersionRecord } from '../services/apiClient';
import { formatNumber, formatPercentage, formatTimestamp, safeValue } from '../utils/formatters';

export const ModelRegistry: React.FC = () => {
  const [models, setModels] = useState<ModelVersionRecord[]>([]);
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRegistry = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [modelsList, info] = await Promise.all([
        apiClient.getModels(),
        apiClient.getModelInfo().catch(() => null),
      ]);
      setModels(modelsList);
      setModelInfo(info);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load model registry');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRegistry();
  }, [fetchRegistry]);

  const activeModel = models.find((m) => m.is_active);

  return (
    <div className="page-shell page-shell-tight">
      <div className="page-header-row align-start">
        <div>
          <p className="eyebrow">Lifecycle &amp; Governance</p>
          <h2>Model Registry</h2>
          <p className="page-description">
            Registered model versions, active serving state, and benchmark evaluation metrics.
          </p>
        </div>
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => void fetchRegistry()}
          disabled={loading}
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {loading && (
        <div className="loading-block" role="status" aria-live="polite">
          Loading model registry...
        </div>
      )}

      {!loading && error && (
        <div className="error-panel" role="alert">
          <strong>Model registry is unavailable.</strong>
          <span>Verify backend connectivity and retry.</span>
          <small>{error}</small>
          <button className="btn btn-secondary" type="button" onClick={() => void fetchRegistry()}>
            Retry registry
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="panel-section">
            <div className="section-head">
              <h3>Active Serving Model</h3>
            </div>
            <div className="detail-grid compact-grid">
              <div className="detail-item">
                <span>Model ID</span>
                <strong>{modelInfo?.model_id || modelInfo?.model_name || activeModel?.model_id || 'N/A'}</strong>
              </div>
              <div className="detail-item">
                <span>Active Version</span>
                <strong className="mono-pill">{modelInfo?.model_version || activeModel?.model_version || 'N/A'}</strong>
              </div>
              <div className="detail-item">
                <span>Algorithm</span>
                <strong>{modelInfo?.model_type ? modelInfo.model_type.toUpperCase() : 'XGBOOST'}</strong>
              </div>
              <div className="detail-item">
                <span>Feature Count</span>
                <strong>{formatNumber(modelInfo?.num_features || modelInfo?.feature_count || 41)} features</strong>
              </div>
              <div className="detail-item">
                <span>Dataset Contract</span>
                <strong>{modelInfo?.dataset || 'NSL-KDD Upstream'}</strong>
              </div>
              <div className="detail-item">
                <span>Serving Status</span>
                <strong className="status-success">Active &amp; Serving</strong>
              </div>
            </div>
          </div>

          <div className="panel-section">
            <div className="section-head">
              <h3>Registered Model Versions</h3>
            </div>

            {models.length === 0 ? (
              <div className="empty-panel" role="status">
                <strong>No registered model versions found.</strong>
                <span>Database contains no version history.</span>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table" aria-label="Registered model versions table">
                  <thead>
                    <tr>
                      <th scope="col">Model ID</th>
                      <th scope="col">Version</th>
                      <th scope="col">Status</th>
                      <th scope="col" className="numeric-col">F1 Score</th>
                      <th scope="col" className="numeric-col">Accuracy</th>
                      <th scope="col" className="numeric-col">Precision</th>
                      <th scope="col" className="numeric-col">Recall</th>
                      <th scope="col">Registered</th>
                      <th scope="col">MLflow Run ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {models.map((model) => (
                      <tr key={model.id}>
                        <td>{safeValue(model.model_id)}</td>
                        <td><strong className="mono-pill">{safeValue(model.model_version)}</strong></td>
                        <td>
                          <span className={`status-badge ${model.is_active ? 'success active' : 'neutral inactive'}`}>
                            {model.is_active ? 'Active Incumbent' : 'Inactive'}
                          </span>
                        </td>
                        <td className="numeric-cell">{formatPercentage(model.f1)}</td>
                        <td className="numeric-cell">{formatPercentage(model.accuracy)}</td>
                        <td className="numeric-cell">{formatPercentage(model.precision)}</td>
                        <td className="numeric-cell">{formatPercentage(model.recall)}</td>
                        <td className="timestamp-cell">{formatTimestamp(model.timestamp)}</td>
                        <td className="request-id"><span className="mono-pill">{safeValue(model.mlflow_run_id)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="info-panel" role="status">
            <div>
              <strong>Policy Notice:</strong> Model registration, active state assignment, and deletion are controlled strictly through automated promotion. Direct mutations are blocked pending authorization policy (<code>403 authorization_policy_unconfigured</code>).
            </div>
          </div>
        </>
      )}
    </div>
  );
};
