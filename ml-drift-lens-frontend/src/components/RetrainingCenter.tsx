import React, { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../services/apiClient';
import type { RetrainingJobRecord } from '../services/apiClient';
import { formatNumber, formatPercentage, formatTimestamp, normalizeStatus, safeValue } from '../utils/formatters';

export const RetrainingCenter: React.FC = () => {
  const [jobs, setJobs] = useState<RetrainingJobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await apiClient.getRetrainingJobs();
      setJobs(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load retraining jobs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchJobs();
  }, [fetchJobs]);

  return (
    <div className="page-shell page-shell-tight">
      <div className="page-header-row align-start">
        <div>
          <p className="eyebrow">Lifecycle & Governance</p>
          <h2>Retraining Center</h2>
          <p className="page-description">
            Autonomous candidate retraining pipeline, label verification blockers, and promotion lifecycle.
          </p>
        </div>
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => void fetchJobs()}
          disabled={loading}
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {loading && (
        <div className="loading-block" role="status" aria-live="polite">
          Loading retraining jobs...
        </div>
      )}

      {!loading && error && (
        <div className="error-panel" role="alert">
          <strong>Retraining center is unavailable.</strong>
          <span>Verify backend connectivity and retry.</span>
          <small>{error}</small>
          <button className="btn btn-secondary" type="button" onClick={() => void fetchJobs()}>
            Retry retraining jobs
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="panel-section">
            <div className="section-head">
              <h3>Pipeline Governance & Gates</h3>
            </div>
            <div className="detail-grid compact-grid">
              <div className="detail-item">
                <span>Promotion Rule</span>
                <strong>Strict F1 Superiority (F1<sub>candidate</sub> &gt; F1<sub>incumbent</sub>)</strong>
              </div>
              <div className="detail-item">
                <span>Holdout Split</span>
                <strong>Identical evaluation split (min 30 samples)</strong>
              </div>
              <div className="detail-item">
                <span>Min Training Labels</span>
                <strong>150 verified samples minimum</strong>
              </div>
              <div className="detail-item">
                <span>Label Integrity</span>
                <strong>Verified source allowlist required</strong>
              </div>
              <div className="detail-item">
                <span>Candidate State</span>
                <strong>candidate_ready is not deployed</strong>
              </div>
              <div className="detail-item">
                <span>Worker Execution</span>
                <strong>PostgreSQL SKIP LOCKED leases</strong>
              </div>
            </div>
          </div>

          <div className="panel-section">
            <div className="section-head">
              <h3>Retraining Jobs Lifecycle</h3>
            </div>

            {jobs.length === 0 ? (
              <div className="empty-panel" role="status">
                <strong>No retraining jobs recorded.</strong>
                <span>Pipeline has not triggered candidate retraining yet.</span>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table" aria-label="Retraining jobs history table">
                  <thead>
                    <tr>
                      <th scope="col">Job ID</th>
                      <th scope="col">Model ID</th>
                      <th scope="col">Trigger Reason</th>
                      <th scope="col">Stage</th>
                      <th scope="col">Samples / Holdout</th>
                      <th scope="col">Versions</th>
                      <th scope="col">Candidate F1</th>
                      <th scope="col">Incumbent F1</th>
                      <th scope="col">Promotion Status</th>
                      <th scope="col">Started</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((job) => (
                      <tr key={job.id}>
                        <td><strong>#{job.id}</strong></td>
                        <td>{safeValue(job.model_id)}</td>
                        <td>{normalizeStatus(job.trigger_reason || job.triggered_by)}</td>
                        <td>
                          <span className={`status-badge ${job.status === 'candidate_ready' ? 'warning' : job.promoted ? 'success' : job.status === 'failed' ? 'danger' : 'neutral'}`}>
                            {normalizeStatus(job.status || (job.promoted ? 'candidate_ready' : 'queued'))}
                          </span>
                        </td>
                        <td>
                          {formatNumber(job.sample_count)} / {formatNumber(job.evaluation_sample_count)} (min {formatNumber(job.min_samples)})
                        </td>
                        <td>
                          {safeValue(job.old_model_version)} → {safeValue(job.new_model_version)}
                        </td>
                        <td>{formatPercentage(job.candidate_f1)}</td>
                        <td>{formatPercentage(job.incumbent_f1)}</td>
                        <td>
                          <span className={`status-badge ${job.promoted ? 'success' : 'neutral'}`}>
                            {job.promoted ? 'Promoted' : 'Not promoted'}
                          </span>
                        </td>
                        <td>{formatTimestamp(job.start_time)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {jobs.some((j) => j.status === 'waiting_for_labelled_data' || j.error_message) && (
            <div className="info-panel" role="status">
              {jobs.filter((j) => j.status === 'waiting_for_labelled_data').map((j) => (
                <div key={j.id}>
                  <strong>Job #{j.id} Waiting:</strong> Retraining worker paused in <code>waiting_for_labelled_data</code> because authoritative verified ground-truth labels are below the required threshold. Predicted labels are never used for training.
                </div>
              ))}
              {jobs.filter((j) => j.error_message).map((j) => (
                <div key={j.id} className="error-message">
                  <strong>Job #{j.id} Failure:</strong> {j.error_message}
                </div>
              ))}
            </div>
          )}

          <div className="info-panel" role="status">
            <div>
              <strong>Authorization Policy:</strong> Retraining enqueuing and promotion endpoints (<code>POST /api/retraining</code> and <code>POST /api/retraining/:id/promote</code>) fail closed with <code>403 authorization_policy_unconfigured</code> until privileged operator permissions are authorized.
            </div>
          </div>
        </>
      )}
    </div>
  );
};
