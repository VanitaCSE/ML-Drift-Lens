import React, { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../services/apiClient';

interface SystemStatusData {
  healthStatus?: {
    status?: string;
    healthy?: boolean;
    service?: string;
    message?: string;
    database_connected?: boolean;
    ml_service_healthy?: boolean;
  } | null;
  readinessStatus?: {
    ready?: boolean;
    model_loaded?: boolean;
    message?: string;
  } | null;
  modelInfo?: {
    model_version?: string;
    model_type?: string;
    model_name?: string;
    model_id?: string;
    num_features?: number;
  } | null;
  healthError?: string | null;
  readinessError?: string | null;
  modelInfoError?: string | null;
  lastCheck?: string;
}

export const SystemStatus: React.FC = () => {
  const [status, setStatus] = useState<SystemStatusData>({});
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    let healthResult = null;
    let readinessResult = null;
    let modelInfoResult = null;
    let healthErr: string | null = null;
    let readinessErr: string | null = null;
    let modelInfoErr: string | null = null;

    try {
      healthResult = await apiClient.getHealth();
    } catch (err) {
      healthErr = err instanceof Error ? err.message : 'Backend health check failed';
    }

    try {
      readinessResult = await apiClient.getReadiness();
    } catch (err) {
      readinessErr = err instanceof Error ? err.message : 'ML service readiness check failed';
    }

    try {
      modelInfoResult = await apiClient.getModelInfo();
    } catch (err) {
      modelInfoErr = err instanceof Error ? err.message : 'Model info retrieval failed';
    }

    setStatus({
      healthStatus: healthResult,
      readinessStatus: readinessResult,
      modelInfo: modelInfoResult,
      healthError: healthErr,
      readinessError: readinessErr,
      modelInfoError: modelInfoErr,
      lastCheck: new Date().toLocaleTimeString(),
    });

    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchStatus();
    const interval = setInterval(() => {
      void fetchStatus();
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const backendAlive = Boolean(status.healthStatus);
  const isHealthy = status.healthStatus?.status === 'healthy' || status.healthStatus?.healthy === true;
  const databaseConnected = status.healthStatus?.database_connected;
  const mlHealthy = status.healthStatus?.ml_service_healthy;
  const isReady = status.readinessStatus?.ready ?? false;
  const modelLoaded = status.readinessStatus?.model_loaded ?? false;

  return (
    <div className="page-shell page-shell-tight">
      <div className="page-header-row align-start">
        <div>
          <p className="eyebrow">Infrastructure &amp; Health</p>
          <h2>System Status</h2>
          <p className="page-description">
            Live operational telemetry across core services, database storage, inference engine, and active model runtime.
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

      <div className="panel-section">
        <div className="section-head">
          <h3>Component Health</h3>
        </div>

        {loading && !status.lastCheck && (
          <div className="loading-block" role="status" aria-live="polite">
            Checking system status...
          </div>
        )}

        <div className="status-list compact">
          <div className="status-row">
            <span>Backend API</span>
            <strong className={backendAlive ? (isHealthy ? 'status-success' : 'status-warning') : 'status-danger'}>
              {!backendAlive ? 'Unavailable' : isHealthy ? 'Healthy' : 'Degraded'}
            </strong>
          </div>
          <div className="status-row">
            <span>Database (PostgreSQL)</span>
            <strong className={databaseConnected === true ? 'status-success' : 'status-danger'}>
              {databaseConnected === true ? 'Connected' : databaseConnected === false ? 'Disconnected' : 'Unavailable'}
            </strong>
          </div>
          <div className="status-row">
            <span>FastAPI ML Service</span>
            <strong className={isReady || mlHealthy ? 'status-success' : 'status-danger'}>
              {isReady || mlHealthy ? 'Ready' : 'Unavailable'}
            </strong>
          </div>
          <div className="status-row">
            <span>Model In-Memory</span>
            <strong className={modelLoaded ? 'status-success' : 'status-danger'}>
              {modelLoaded ? 'Loaded' : 'Unavailable'}
            </strong>
          </div>
        </div>
      </div>

      <div className="panel-section">
        <div className="section-head">
          <h3>System Runtime Details</h3>
        </div>

        <div className="detail-grid compact-grid">
          <div className="detail-item">
            <span>Inference Routing</span>
            <strong>Managed by backend</strong>
          </div>
          <div className="detail-item">
            <span>Model Version</span>
            <strong className="mono-pill">{status.modelInfo?.model_version || 'N/A'}</strong>
          </div>
          <div className="detail-item">
            <span>Model Algorithm</span>
            <strong>{status.modelInfo?.model_type ? status.modelInfo.model_type.toUpperCase() : 'N/A'}</strong>
          </div>
          <div className="detail-item">
            <span>Last Health Check</span>
            <strong>{status.lastCheck || 'Checking...'}</strong>
          </div>
        </div>

        {(status.healthError || status.readinessError || status.modelInfoError || status.healthStatus?.message || status.readinessStatus?.message) && (
          <div className="info-panel" role="status" style={{ marginTop: '16px' }}>
            {status.healthStatus?.message && <div>{status.healthStatus.message}</div>}
            {status.healthError && <div className="error-message">Backend: {status.healthError}</div>}
            {status.readinessStatus?.message && <div>{status.readinessStatus.message}</div>}
            {status.readinessError && <div className="error-message">Readiness: {status.readinessError}</div>}
            {status.modelInfoError && <div className="error-message">Model: {status.modelInfoError}</div>}
          </div>
        )}
      </div>
    </div>
  );
};
