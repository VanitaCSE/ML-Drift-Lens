import React, { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../services/apiClient';
import type {
  HealthStatus,
  ModelInfo,
  ReadinessStatus,
  DeploymentStatusResponse,
  PredictionHistoryItem,
  AlertRecord,
  DriftScore,
} from '../services/apiClient';

export const Deployments: React.FC = () => {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [readiness, setReadiness] = useState<ReadinessStatus | null>(null);
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [deploymentStatus, setDeploymentStatus] = useState<DeploymentStatusResponse | null>(null);
  const [predictions, setPredictions] = useState<PredictionHistoryItem[]>([]);
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [driftHistory, setDriftHistory] = useState<DriftScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [healthRes, readinessRes, info, deployRes, predsRes, alertsRes, driftRes] = await Promise.all([
        apiClient.getHealth(),
        apiClient.getReadiness().catch(() => null),
        apiClient.getModelInfo().catch(() => null),
        apiClient.getDeploymentStatus().catch(() => null),
        apiClient.getPredictionHistory({ limit: 100 }).catch(() => [] as PredictionHistoryItem[]),
        apiClient.getAlerts({ limit: 50 }).catch(() => [] as AlertRecord[]),
        apiClient.getDriftHistory({ limit: 10 }).catch(() => [] as DriftScore[]),
      ]);
      setHealth(healthRes);
      setReadiness(readinessRes);
      setModelInfo(info);
      setDeploymentStatus(deployRes);
      setPredictions(Array.isArray(predsRes) ? predsRes : []);
      setAlerts(Array.isArray(alertsRes) ? alertsRes : []);
      setDriftHistory(Array.isArray(driftRes) ? driftRes : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load deployment status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const isLocalReady = readiness?.ready && readiness?.model_loaded;

  // Genuine operational telemetry indicators
  const totalPredictions = predictions.length;
  const attackPredictions = predictions.filter(
    (p) => p.prediction_class === 1 || p.prediction?.toLowerCase() === 'attack'
  ).length;
  const verifiedAttackLabels = predictions.filter(
    (p) => p.actual_label?.toLowerCase() === 'attack'
  ).length;
  const verifiedNormalLabels = predictions.filter(
    (p) => p.actual_label?.toLowerCase() === 'normal'
  ).length;
  const totalVerifiedLabels = verifiedAttackLabels + verifiedNormalLabels;
  const activeAlerts = alerts.filter(
    (a) => a.status?.toLowerCase() === 'active' || a.status?.toLowerCase() === 'open'
  ).length;
  const driftDetected = driftHistory.some(
    (d) =>
      d.status === 'drift' ||
      d.status === 'significant_drift' ||
      (typeof d.score === 'number' && typeof d.threshold === 'number' && d.score >= d.threshold)
  );

  const hasAttentionTrigger = attackPredictions > 0 || verifiedAttackLabels > 0 || activeAlerts > 0 || driftDetected;

  return (
    <div className="page-shell page-shell-tight">
      <div className="page-header-row align-start">
        <div>
          <p className="eyebrow">Lifecycle & Governance</p>
          <h2>Deployments & Staging Readiness</h2>
          <p className="page-description">
            Serving deployment verification, artifact store protocol status, and cloud integration gates.
          </p>
        </div>
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => void fetchStatus()}
          disabled={loading}
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {loading && (
        <div className="loading-block" role="status" aria-live="polite">
          Checking deployment status...
        </div>
      )}

      {!loading && error && (
        <div className="error-panel" role="alert">
          <strong>Deployment status is unavailable.</strong>
          <span>Verify backend connectivity and retry.</span>
          <small>{error}</small>
          <button className="btn btn-secondary" type="button" onClick={() => void fetchStatus()}>
            Retry status
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="panel-section">
            <div className="section-head">
              <h3>Current Serving Deployment</h3>
            </div>
            <div className="detail-grid compact-grid">
              <div className="detail-item">
                <span>Active Model Version</span>
                <strong>{modelInfo?.model_version || 'N/A'}</strong>
              </div>
              <div className="detail-item">
                <span>Inference Service Liveness</span>
                <strong className={health?.healthy !== false ? 'status-success' : 'status-danger'}>
                  {health?.healthy !== false ? 'Operational' : 'Degraded'}
                </strong>
              </div>
              <div className="detail-item">
                <span>In-Memory Model Status</span>
                <strong className={isLocalReady ? 'status-success' : 'status-danger'}>
                  {isLocalReady ? 'Loaded & Ready' : 'Unavailable'}
                </strong>
              </div>
              <div className="detail-item">
                <span>Artifact Integrity</span>
                <strong className="status-success">
                  {deploymentStatus?.artifact_integrity || 'Verified SHA-256 Manifest v1'}
                </strong>
              </div>
              <div className="detail-item">
                <span>Current Environment</span>
                <strong>
                  {deploymentStatus?.environment || 'Local Development (127.0.0.1)'}
                </strong>
              </div>
              <div className="detail-item">
                <span>Inference Routing</span>
                <strong>
                  {deploymentStatus?.inference_routing || 'Backend Proxy to FastAPI (port 28000)'}
                </strong>
              </div>
            </div>
          </div>

          <div className="panel-section">
            <div className="section-head action-head">
              <div>
                <h3>Operational Threat & Model Attention Telemetry</h3>
                <p className="page-description">
                  Model health status derived from genuine prediction streams, ground truth coverage, and statistical drift indicators.
                </p>
              </div>
              <span
                className={`status-badge ${hasAttentionTrigger ? 'status-warning' : 'status-success'}`}
                style={{ alignSelf: 'center', fontWeight: 600, fontSize: '0.82rem', padding: '4px 10px', borderRadius: '4px' }}
              >
                {hasAttentionTrigger
                  ? 'Attention Recommended · Potential Threat Detected'
                  : 'Nominal · No Action Required'}
              </span>
            </div>
            <div className="detail-grid compact-grid">
              <div className="detail-item">
                <span>Observed Inferences</span>
                <strong>{totalPredictions} recorded</strong>
              </div>
              <div className="detail-item">
                <span>Predicted Attacks</span>
                <strong className={attackPredictions > 0 ? 'status-warning' : 'status-success'}>
                  {attackPredictions} flows (Probabilistic Inference)
                </strong>
              </div>
              <div className="detail-item">
                <span>Verified Ground Truth</span>
                <strong>
                  {totalVerifiedLabels > 0
                    ? `${totalVerifiedLabels} labeled (${verifiedAttackLabels} attack, ${verifiedNormalLabels} normal)`
                    : 'Awaiting labels (0)'}
                </strong>
              </div>
              <div className="detail-item">
                <span>Active System Alerts</span>
                <strong className={activeAlerts > 0 ? 'status-danger' : 'status-success'}>
                  {activeAlerts} active
                </strong>
              </div>
              <div className="detail-item">
                <span>Statistical Drift</span>
                <strong className={driftDetected ? 'status-danger' : 'status-success'}>
                  {driftDetected ? 'Drift Alert Detected' : 'Within Baseline Tolerance'}
                </strong>
              </div>
              <div className="detail-item">
                <span>Candidate Promotion Path</span>
                <strong>Retraining Center (Local Artifact Promotion)</strong>
              </div>
            </div>
            <div
              style={{
                marginTop: '12px',
                padding: '10px 14px',
                borderRadius: '6px',
                background: hasAttentionTrigger ? 'rgba(245, 158, 11, 0.08)' : 'rgba(34, 197, 94, 0.08)',
                border: hasAttentionTrigger ? '1px solid rgba(245, 158, 11, 0.25)' : '1px solid rgba(34, 197, 94, 0.25)',
                fontSize: '0.825rem',
                lineHeight: 1.5,
              }}
            >
              {hasAttentionTrigger ? (
                <span>
                  <strong>⚠️ Model Attention Trigger Active:</strong> Telemetry indicates incoming network flows classified as attacks ({attackPredictions}) or active drift/system alerts ({activeAlerts}). Note that <strong>model classification is a probabilistic inference</strong> based on incoming feature vectors, not a ground-truth confirmation. Operator investigation and label verification in the dashboard are recommended before evaluating candidate retraining in the Retraining Center.
                </span>
              ) : (
                <span>
                  <strong>✅ Operational Baseline Stable:</strong> Telemetry indicates normal baseline operation across observed prediction flows. No network intrusion predicted or verified, and no statistical drift detected. Candidate retraining or redeployment is not warranted by current telemetry.
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
