import React, { useEffect, useState } from 'react';
import { apiClient } from '../services/apiClient';

interface PredictionResult {
  prediction: string;
  prediction_class: number;
  confidence: number;
  inference_latency_ms: number;
  model_version: string;
  request_id: string;
}

interface PredictionFormProps {
  modelId?: string;
  modelVersion?: string;
  preprocessingVersion?: string;
}

export const PredictionForm: React.FC<PredictionFormProps> = ({
  modelId,
  modelVersion,
  preprocessingVersion,
}) => {
  const [resolvedModel, setResolvedModel] = useState({ modelId, modelVersion, preprocessingVersion });
  const [result, setResult] = useState<PredictionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [modelInfoLoading, setModelInfoLoading] = useState(!(modelId && modelVersion && preprocessingVersion));
  const [metadataRetry, setMetadataRetry] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (modelId && modelVersion && preprocessingVersion) return undefined;

    setModelInfoLoading(true);
    setError(null);
    apiClient.getModelInfo()
      .then((info) => {
        if (cancelled) return;
        setResolvedModel({
          modelId: modelId || info.model_id || info.model_name,
          modelVersion: modelVersion || info.model_version,
          preprocessingVersion: preprocessingVersion || info.preprocessing_version,
        });
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load active model metadata');
      })
      .finally(() => {
        if (!cancelled) setModelInfoLoading(false);
      });

    return () => { cancelled = true; };
  }, [modelId, modelVersion, preprocessingVersion, metadataRetry]);

  const activeModelId = modelId || resolvedModel.modelId;
  const activeModelVersion = modelVersion || resolvedModel.modelVersion;
  const activePreprocessingVersion = preprocessingVersion || resolvedModel.preprocessingVersion;
  const canPredict = Boolean(activeModelId && activeModelVersion && activePreprocessingVersion);

  // Real KDDTest+ source row 6, with the ground-truth label excluded.
  const features = {
    duration: 0,
    protocol_type: 'tcp',
    service: 'http',
    flag: 'SF',
    src_bytes: 267,
    dst_bytes: 14515,
    land: 0,
    wrong_fragment: 0,
    urgent: 0,
    hot: 0,
    num_failed_logins: 0,
    logged_in: 1,
    num_compromised: 0,
    root_shell: 0,
    su_attempted: 0,
    num_root: 0,
    num_file_creations: 0,
    num_shells: 0,
    num_access_files: 0,
    num_outbound_cmds: 0,
    is_host_login: 0,
    is_guest_login: 0,
    count: 4,
    srv_count: 4,
    serror_rate: 0,
    srv_serror_rate: 0,
    rerror_rate: 0,
    srv_rerror_rate: 0,
    same_srv_rate: 1,
    diff_srv_rate: 0,
    srv_diff_host_rate: 0,
    dst_host_count: 155,
    dst_host_srv_count: 255,
    dst_host_same_srv_rate: 1,
    dst_host_diff_srv_rate: 0,
    dst_host_same_src_port_rate: 0.01,
    dst_host_srv_diff_host_rate: 0.03,
    dst_host_serror_rate: 0.01,
    dst_host_srv_serror_rate: 0,
    dst_host_rerror_rate: 0,
    dst_host_srv_rerror_rate: 0,
  };

  const handlePredict = async () => {
    try {
      setLoading(true);
      setError(null);
      setResult(null);

      if (!activeModelId || !activeModelVersion || !activePreprocessingVersion) {
        setError('Active model metadata is not available');
        return;
      }

      const response = await apiClient.predict({
        model_id: activeModelId,
        model_version: activeModelVersion,
        preprocessing_version: activePreprocessingVersion,
        input_features: features,
      });

      setResult({
        prediction: response.prediction,
        prediction_class: response.prediction_class,
        confidence: response.confidence,
        inference_latency_ms: response.inference_latency_ms,
        model_version: response.model_version,
        request_id: response.request_id,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Prediction failed');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-shell page-shell-tight">
      <div className="page-header-row align-start">
        <div>
          <p className="eyebrow">Inference &amp; Scoring</p>
          <h2>Network Intrusion Prediction</h2>
          <p className="page-description">
            Submit sample network telemetry to test real-time intrusion detection models and benchmark inference latency.
          </p>
        </div>
        {canPredict && (
          <div className="header-meta-badge">
            <span className="meta-badge-label">Active Model:</span>
            <span className="meta-badge-value mono">{activeModelVersion}</span>
          </div>
        )}
      </div>

      <div className="panel-section prediction-form-section">
        <div className="section-head">
          <div>
            <h3>Sample Connection Telemetry</h3>
            <p className="section-description">
              Benchmark record extracted from the NSL-KDD test holdout (KDDTest+ row 6). Ground-truth label is excluded from submission.
            </p>
          </div>
        </div>

        <div className="telemetry-features-grid">
          <div className="telemetry-feature-chip">
            <span className="feature-label">Protocol</span>
            <span className="feature-value">{features.protocol_type.toUpperCase()}</span>
          </div>
          <div className="telemetry-feature-chip">
            <span className="feature-label">Service</span>
            <span className="feature-value">{features.service}</span>
          </div>
          <div className="telemetry-feature-chip">
            <span className="feature-label">Status Flag</span>
            <span className="feature-value">{features.flag}</span>
          </div>
          <div className="telemetry-feature-chip">
            <span className="feature-label">Src Payload</span>
            <span className="feature-value">{features.src_bytes} B</span>
          </div>
          <div className="telemetry-feature-chip">
            <span className="feature-label">Dst Payload</span>
            <span className="feature-value">{features.dst_bytes.toLocaleString()} B</span>
          </div>
          <div className="telemetry-feature-chip">
            <span className="feature-label">Logged In</span>
            <span className="feature-value">{features.logged_in === 1 ? 'Yes' : 'No'}</span>
          </div>
          <div className="telemetry-feature-chip">
            <span className="feature-label">Connections</span>
            <span className="feature-value">{features.count} (same srv: 100%)</span>
          </div>
          <div className="telemetry-feature-chip">
            <span className="feature-label">Total Features</span>
            <span className="feature-value">41 attributes</span>
          </div>
        </div>

        <div className="prediction-actions-bar">
          <button
            onClick={handlePredict}
            disabled={loading || !canPredict}
            className="btn btn-primary"
          >
            {loading ? 'Predicting...' : canPredict ? 'Predict' : modelInfoLoading ? 'Loading model...' : 'Model unavailable'}
          </button>

          {modelInfoLoading && !canPredict && (
            <p role="status" aria-live="polite" className="status-note">
              Loading active model metadata...
            </p>
          )}

          {!canPredict && !modelInfoLoading && (
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => {
                setError(null);
                setModelInfoLoading(true);
                setMetadataRetry((attempt) => attempt + 1);
              }}
            >
              Retry model metadata
            </button>
          )}
        </div>

        {error && (
          <div className="error-box" role="alert">
            <strong>Error:</strong> {error}
          </div>
        )}
      </div>

      {result && (
        <div className="panel-section result-box">
          <div className="section-head">
            <h3>Inference Result</h3>
          </div>

          <div className={`result-banner ${result.prediction.toLowerCase()}`}>
            <div className="result-banner-icon" aria-hidden="true">
              {result.prediction.toLowerCase() === 'normal' ? '✓' : '⚠'}
            </div>
            <div className="result-banner-content">
              <h4>
                {result.prediction.toLowerCase() === 'normal'
                  ? 'BENIGN TRAFFIC (NORMAL)'
                  : 'NETWORK INTRUSION DETECTED (ATTACK)'}
              </h4>
              <p>
                {result.prediction.toLowerCase() === 'normal'
                  ? 'Connection patterns align with baseline legitimate network operations. No anomalous traffic characteristics detected.'
                  : 'Connection features matched signature patterns associated with unauthorized or malicious network activity.'}
              </p>
            </div>
          </div>

          <div className="prediction-metrics-grid">
            <div className="result-item">
              <label>Prediction</label>
              <span className={`prediction-badge prediction-${result.prediction.toLowerCase()}`}>
                {result.prediction.toUpperCase()}
              </span>
            </div>
            <div className="result-item">
              <label>Prediction Class</label>
              <span title="Binary target class: 0 = normal (benign traffic), 1 = attack (network intrusion)">
                <code>{result.prediction_class}</code> ({result.prediction_class === 0 ? 'normal' : 'attack'})
              </span>
            </div>
            <div className="result-item">
              <label>Confidence</label>
              <span className="confidence-value">
                {(result.confidence * 100).toFixed(1)}%
              </span>
              <div className="confidence-meter-track" aria-hidden="true">
                <div
                  className="confidence-meter-fill"
                  style={{ width: `${Math.min(100, Math.max(0, result.confidence * 100))}%` }}
                />
              </div>
            </div>
            <div className="result-item">
              <label>Inference Latency</label>
              <span>{result.inference_latency_ms.toFixed(2)} ms</span>
            </div>
            <div className="result-item">
              <label>Model Version</label>
              <span className="model-version-tag">{result.model_version}</span>
            </div>
          </div>

          <div className="result-item request-id-container">
            <label>Request ID</label>
            <span className="request-id">{result.request_id}</span>
          </div>
        </div>
      )}
    </div>
  );
};
