import React, { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../services/apiClient';
import type { ModelVersionRecord, RetrainingJobRecord } from '../services/apiClient';
import { formatNumber, formatPercentage, formatTimestamp, normalizeStatus, safeValue } from '../utils/formatters';

export const ModelEvaluation: React.FC = () => {
  const [models, setModels] = useState<ModelVersionRecord[]>([]);
  const [jobs, setJobs] = useState<RetrainingJobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [modelsList, jobsList] = await Promise.all([
        apiClient.getModels(),
        apiClient.getRetrainingJobs(),
      ]);
      setModels(modelsList);
      setJobs(jobsList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load evaluation data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const activeModel = models.find((m) => m.is_active);
  const latestEvaluatedJob = jobs.find(
    (j) => j.candidate_f1 !== null && j.candidate_f1 !== undefined,
  );

  const candidateF1 = latestEvaluatedJob?.candidate_f1 ?? null;
  const incumbentF1 = latestEvaluatedJob?.incumbent_f1 ?? activeModel?.f1 ?? null;
  const f1Delta = candidateF1 !== null && incumbentF1 !== null ? candidateF1 - incumbentF1 : null;
  const isSuperior = f1Delta !== null && f1Delta > 0;

  const candidateVersion = latestEvaluatedJob?.new_model_version
    || (jobs.length > 0 && jobs[0]?.new_model_version ? `${jobs[0].new_model_version} (Awaiting evaluation)` : null)
    || 'Awaiting candidate';
  const incumbentVersion = safeValue(activeModel?.model_version || latestEvaluatedJob?.old_model_version);

  return (
    <div className="page-shell page-shell-tight">
      <div className="page-header-row align-start">
        <div>
          <p className="eyebrow">Lifecycle & Governance</p>
          <h2>Model Evaluation & Comparison</h2>
          <p className="page-description">
            Head-to-head metric evaluation between candidate models and active incumbent on identical test holdouts.
          </p>
        </div>
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => void fetchData()}
          disabled={loading}
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {loading && (
        <div className="loading-block" role="status" aria-live="polite">
          Loading evaluation metrics...
        </div>
      )}

      {!loading && error && (
        <div className="error-panel" role="alert">
          <strong>Evaluation data is unavailable.</strong>
          <span>Verify backend connectivity and retry.</span>
          <small>{error}</small>
          <button className="btn btn-secondary" type="button" onClick={() => void fetchData()}>
            Retry evaluation
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="panel-section evaluation-comparison-panel">
            <div className="section-head">
              <h3>Latest Head-to-Head Comparison</h3>
              <span className="badge-pill subtle">Strict Holdout Split</span>
            </div>

            <div className="comparison-arena">
              {/* Incumbent Card */}
              <div className="comparison-card incumbent-card">
                <div className="comparison-card-header">
                  <span className="status-badge success">Active Incumbent</span>
                  <span className="comparison-card-meta">In Production</span>
                </div>
                <div className="comparison-card-body">
                  <span className="model-version-tag">{incumbentVersion}</span>
                  <div className="primary-metric-display">
                    <span className="metric-label">Incumbent F1 Score</span>
                    <strong className="metric-value">{formatPercentage(incumbentF1)}</strong>
                  </div>
                  <div className="sub-metrics-grid">
                    <div>
                      <span>Accuracy</span>
                      <strong>{formatPercentage(activeModel?.accuracy)}</strong>
                    </div>
                    <div>
                      <span>Precision</span>
                      <strong>{formatPercentage(activeModel?.precision)}</strong>
                    </div>
                    <div>
                      <span>Recall</span>
                      <strong>{formatPercentage(activeModel?.recall)}</strong>
                    </div>
                  </div>
                </div>
              </div>

              {/* Center Gate & Delta Pillar */}
              <div className="comparison-pillar">
                <div className="vs-badge">VS</div>
                <div className="delta-container">
                  <span className="delta-label">F1 Delta (Candidate - Incumbent)</span>
                  <strong className={`delta-value ${isSuperior ? 'status-success' : 'status-neutral'}`}>
                    {f1Delta !== null ? `${f1Delta > 0 ? '+' : ''}${(f1Delta * 100).toFixed(2)}%` : 'N/A'}
                  </strong>
                </div>
                <div className="eligibility-container">
                  <span className="eligibility-label">Promotion Eligibility</span>
                  <span className={`status-badge ${latestEvaluatedJob ? (latestEvaluatedJob.promoted ? 'success' : isSuperior ? 'info' : 'danger') : 'neutral'}`}>
                    {latestEvaluatedJob
                      ? (latestEvaluatedJob.promoted
                          ? 'Promoted (Superior F1)'
                          : isSuperior
                            ? 'Eligible for promotion'
                            : 'Rejected (F1 <= Incumbent)')
                      : 'No candidate under review'}
                  </span>
                </div>
              </div>

              {/* Candidate Card */}
              <div className="comparison-card candidate-card">
                <div className="comparison-card-header">
                  <span className={`status-badge ${candidateF1 !== null ? (isSuperior ? 'info' : 'neutral') : 'neutral'}`}>
                    {candidateF1 !== null ? 'Candidate Model' : 'No Candidate'}
                  </span>
                  <span className="comparison-card-meta">
                    {latestEvaluatedJob ? `Job #${latestEvaluatedJob.id}` : 'Pending trigger'}
                  </span>
                </div>
                <div className="comparison-card-body">
                  <span className="model-version-tag">{candidateVersion}</span>
                  <div className="primary-metric-display">
                    <span className="metric-label">Candidate F1 Score</span>
                    <strong className={`metric-value ${candidateF1 !== null ? '' : 'metric-muted'}`}>
                      {candidateF1 !== null ? formatPercentage(candidateF1) : 'Not evaluated'}
                    </strong>
                  </div>
                  <div className="sub-metrics-grid">
                    <div>
                      <span>Precision</span>
                      <strong>{candidateF1 !== null ? formatPercentage(latestEvaluatedJob?.candidate_precision) : 'Not evaluated'}</strong>
                    </div>
                    <div>
                      <span>Recall</span>
                      <strong>{candidateF1 !== null ? formatPercentage(latestEvaluatedJob?.candidate_recall) : 'Not evaluated'}</strong>
                    </div>
                    <div>
                      <span>Holdout Split</span>
                      <strong>{latestEvaluatedJob?.evaluation_sample_count ? `${latestEvaluatedJob.evaluation_sample_count} rows` : 'Not evaluated'}</strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Informative Guidance Callout when no candidate evaluated */}
            {candidateF1 === null && (
              <div className="evaluation-guidance-callout" role="note">
                <span className="guidance-icon" aria-hidden="true">ℹ</span>
                <div>
                  <strong>No candidate model currently pending promotion.</strong>
                  <span>
                    The active incumbent model is serving inference traffic. Trigger a retraining job or ingest labeled drift records to initiate candidate benchmarking.
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Safety Gates Section */}
          <div className="panel-section">
            <div className="section-head">
              <h3>Evaluation Protocol & Safety Gates</h3>
              <span className="badge-pill success">All 4 Gates Active</span>
            </div>
            <div className="safety-gates-grid">
              <div className="gate-card">
                <div className="gate-icon" aria-hidden="true">🛡️</div>
                <div className="gate-content">
                  <div className="gate-title-row">
                    <strong>Holdout Fairness</strong>
                    <span className="status-badge success">Enforced</span>
                  </div>
                  <p>Candidate and incumbent evaluated on identical test split</p>
                </div>
              </div>

              <div className="gate-card">
                <div className="gate-icon" aria-hidden="true">⚖️</div>
                <div className="gate-content">
                  <div className="gate-title-row">
                    <strong>Promotion Threshold</strong>
                    <span className="status-badge success">Enforced</span>
                  </div>
                  <p>Strict F1 superiority (candidate F1 &gt; incumbent F1)</p>
                </div>
              </div>

              <div className="gate-card">
                <div className="gate-icon" aria-hidden="true">🔒</div>
                <div className="gate-content">
                  <div className="gate-title-row">
                    <strong>Checksum Verification</strong>
                    <span className="status-badge success">Enforced</span>
                  </div>
                  <p>SHA-256 manifest v1 verified before reload</p>
                </div>
              </div>

              <div className="gate-card">
                <div className="gate-icon" aria-hidden="true">🔄</div>
                <div className="gate-content">
                  <div className="gate-title-row">
                    <strong>Fail-Safe Rollback</strong>
                    <span className="status-badge success">Enforced</span>
                  </div>
                  <p>Automatic rollback if FastAPI model reload fails</p>
                </div>
              </div>
            </div>
          </div>

          {/* Evaluation & Promotion History Table */}
          <div className="panel-section">
            <div className="section-head">
              <h3>Evaluation & Promotion History</h3>
              <span className="badge-pill subtle">{jobs.length} Records</span>
            </div>

            {jobs.length === 0 ? (
              <div className="empty-panel" role="status">
                <strong>No evaluation records available.</strong>
                <span>Retraining pipeline has not evaluated candidate models yet.</span>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table" aria-label="Candidate evaluation history table">
                  <thead>
                    <tr>
                      <th scope="col">Job ID</th>
                      <th scope="col">Candidate Version</th>
                      <th scope="col">Prior Incumbent</th>
                      <th scope="col">Candidate F1</th>
                      <th scope="col">Incumbent F1</th>
                      <th scope="col">Evaluation Split</th>
                      <th scope="col">Decision</th>
                      <th scope="col">Promotion Reason</th>
                      <th scope="col">Evaluated At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((job) => (
                      <tr key={job.id}>
                        <td><strong>#{job.id}</strong></td>
                        <td>
                          <span className="mono-tag">{safeValue(job.new_model_version || 'In preparation')}</span>
                        </td>
                        <td>
                          <span className="mono-tag subtle">{safeValue(job.old_model_version)}</span>
                        </td>
                        <td>
                          <strong className={job.candidate_f1 !== null ? '' : 'text-muted'}>
                            {job.candidate_f1 !== null
                              ? formatPercentage(job.candidate_f1)
                              : (job.status === 'deployed' || job.status === 'candidate_ready')
                                ? 'Not recorded (legacy)'
                                : 'Not evaluated'}
                          </strong>
                        </td>
                        <td>
                          <span className={job.incumbent_f1 !== null ? '' : 'text-muted'}>
                            {job.incumbent_f1 !== null ? formatPercentage(job.incumbent_f1) : 'Not recorded'}
                          </span>
                        </td>
                        <td>{job.evaluation_sample_count ? `${formatNumber(job.evaluation_sample_count)} holdout rows` : 'Not recorded'}</td>
                        <td>
                          <span className={`status-badge ${job.promoted ? 'success' : job.status === 'candidate_ready' ? 'warning' : job.status === 'deployed' ? 'info' : 'neutral'}`}>
                            {job.promoted ? 'Promoted' : normalizeStatus(job.status || 'not_promoted')}
                          </span>
                        </td>
                        <td>{normalizeStatus(job.promotion_reason || (job.promoted ? 'Legacy promotion' : 'Pending evaluation'))}</td>
                        <td>{formatTimestamp(job.updated_at || job.start_time)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
