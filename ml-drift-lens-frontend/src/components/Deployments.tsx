import React, { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../services/apiClient';
import type {
  HealthStatus,
  ModelInfo,
  ReadinessStatus,
  DeploymentStatusResponse,
  DeploymentPrerequisite,
} from '../services/apiClient';

const DEFAULT_PREREQUISITES: DeploymentPrerequisite[] = [
  {
    key: 'render_staging_client',
    label: 'Render Staging Client',
    status: 'unconfigured',
    badge: 'Unconfigured (Disabled)',
    reason: 'Missing RENDER_API_KEY, RENDER_STAGING_SERVICE_ID, or RENDER_TARGET_ENVIRONMENT is not set to staging.',
  },
  {
    key: 'remote_durable_store',
    label: 'Remote Durable Store',
    status: 'unconfigured',
    badge: 'Unconfigured (Local Filesystem Only)',
    reason: 'No remote durable object storage provider (e.g. S3, Cloudflare R2, GCS) configured. Model artifacts remain bound to local container storage.',
  },
  {
    key: 'independent_live_verifier',
    label: 'Independent Live Verifier',
    status: 'unconfigured',
    badge: 'Unconfigured (Local Probes Only)',
    reason: 'No independent post-deployment verification probe configured to validate live serving model SHA-256 checksum and version against registry.',
  },
  {
    key: 'operator_authorization',
    label: 'Operator Authorization',
    status: 'blocked',
    badge: 'Policy Blocked (403)',
    reason: 'Operator authorization policy is unconfigured; deployment and retraining actions fail closed with HTTP 403 (authorization_policy_unconfigured).',
  },
];

function getStatusClass(status: string): string {
  switch (status) {
    case 'verified':
      return 'status-success';
    case 'configured_unverified':
      return 'status-warning';
    case 'failed':
    case 'blocked':
    case 'unconfigured':
    default:
      return 'status-danger';
  }
}

export const Deployments: React.FC = () => {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [readiness, setReadiness] = useState<ReadinessStatus | null>(null);
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [deploymentStatus, setDeploymentStatus] = useState<DeploymentStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [healthRes, readinessRes, info, deployRes] = await Promise.all([
        apiClient.getHealth(),
        apiClient.getReadiness().catch(() => null),
        apiClient.getModelInfo().catch(() => null),
        apiClient.getDeploymentStatus().catch(() => null),
      ]);
      setHealth(healthRes);
      setReadiness(readinessRes);
      setModelInfo(info);
      setDeploymentStatus(deployRes);
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
  const prereqList: DeploymentPrerequisite[] = deploymentStatus?.prerequisites
    ? Object.values(deploymentStatus.prerequisites)
    : DEFAULT_PREREQUISITES;

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
            <div className="section-head">
              <h3>Cloud & Staging Integration Prerequisites</h3>
            </div>
            <div className="detail-grid compact-grid">
              {prereqList.map((prereq) => (
                <div key={prereq.key} className="detail-item">
                  <span>{prereq.label}</span>
                  <strong className={getStatusClass(prereq.status)}>{prereq.badge}</strong>
                  <p className="status-note" style={{ marginTop: '4px', fontSize: '0.82rem' }}>
                    {prereq.reason}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="panel-section">
            <div className="section-head action-head">
              <div>
                <h3>Staging Redeployment Control</h3>
                <p className="page-description">
                  {deploymentStatus?.redeployment_block_reason ||
                    'Automated cloud redeployment is permanently disabled until all required cloud infrastructure prerequisites are fulfilled.'}
                </p>
              </div>
              <button
                className="btn btn-secondary"
                type="button"
                disabled
                title={
                  deploymentStatus?.redeployment_block_reason ||
                  'Redeploy action is disabled because cloud deployment prerequisites are unconfigured.'
                }
              >
                Redeploy to Staging (Disabled)
              </button>
            </div>
          </div>

          <div className="info-panel" role="status">
            <div>
              <strong>Deployment Architecture Note:</strong> Local candidate promotion stages artifacts on the local filesystem and reloads the local FastAPI service. Cloud redeployment requires:
              <ul style={{ margin: '8px 0 0 20px', padding: 0 }}>
                <li>A configured Render staging service ID and API key (<code>RENDER_STAGING_SERVICE_ID</code>, <code>RENDER_API_KEY</code>)</li>
                <li>A durable remote artifact store (e.g. S3/GCS bucket) replacing local volume storage</li>
                <li>An independent post-deploy polling worker and live model version/checksum verifier</li>
                <li>An approved operator authorization policy for deployment actions</li>
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
