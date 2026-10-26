import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiClient } from '../services/apiClient';
import type {
  AlertRecord,
  DriftScore,
  ModelVersionRecord,
  MonitoringMetrics,
  PredictionHistoryItem,
  RetrainingJobRecord,
} from '../services/apiClient';
import {
  formatNumber,
  formatPercentage,
  formatTimestamp,
  normalizeStatus,
  SAFE_FALLBACK,
  safeValue,
} from '../utils/formatters';

export { formatNumber, formatPercentage as formatPercent, formatTimestamp } from '../utils/formatters';

interface MetricCardProps {
  label: string;
  value: string;
  note: string;
  tone?: 'neutral' | 'positive' | 'warning';
}

interface StatusBadgeProps {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}

interface TableColumn<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
}

type DashboardSection = 'metrics' | 'drift' | 'alerts' | 'models' | 'retraining' | 'predictions';
type SectionErrors = Partial<Record<DashboardSection, string>>;

const EMPTY_VALUE = SAFE_FALLBACK;
const READ_LIMIT = 10;
export const DEFAULT_DASHBOARD_REFRESH_INTERVAL_MS = 30_000;
export const MIN_DASHBOARD_REFRESH_INTERVAL_MS = 5_000;

export function getDashboardRefreshIntervalMs(rawValue?: string) {
  const configuredValue = rawValue ?? import.meta.env.VITE_DASHBOARD_REFRESH_INTERVAL_MS;
  const parsedValue = Number(configuredValue);
  if (!Number.isFinite(parsedValue) || parsedValue < MIN_DASHBOARD_REFRESH_INTERVAL_MS) {
    return DEFAULT_DASHBOARD_REFRESH_INTERVAL_MS;
  }
  return Math.floor(parsedValue);
}

function alertStatusTone(status: string | null | undefined): StatusBadgeProps['tone'] {
  const normalized = status?.toLowerCase();
  return normalized === 'resolved' || normalized === 'closed' ? 'success' : normalized === 'open' || normalized === 'active' ? 'warning' : 'neutral';
}

function retrainingStatus(row: RetrainingJobRecord) {
  if (row.promoted === true) return 'Promoted';
  if (row.promoted === false) return 'Not promoted';
  return EMPTY_VALUE;
}

function retrainingStage(row: RetrainingJobRecord) {
  return normalizeStatus(row.status || (row.promoted ? 'candidate_ready' : 'queued'));
}

function driftStatusTone(status: string | null | undefined, isAboveThreshold: boolean): StatusBadgeProps['tone'] {
  const normalized = status?.toLowerCase();
  if (normalized === 'insufficient_data') return 'neutral';
  if (normalized === 'drift' || normalized === 'drifting' || isAboveThreshold) return 'danger';
  if (normalized === 'warning') return 'warning';
  return 'success';
}

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') {
    const envelope = value as { data?: unknown; items?: unknown; results?: unknown };
    if (Array.isArray(envelope.data)) return envelope.data as T[];
    if (Array.isArray(envelope.items)) return envelope.items as T[];
    if (Array.isArray(envelope.results)) return envelope.results as T[];
  }
  return [];
}

function asMetrics(value: unknown): MonitoringMetrics | null {
  if (!value || typeof value !== 'object') return null;
  const envelope = value as { data?: unknown; metrics?: unknown };
  const candidate = envelope.data || envelope.metrics || value;
  return candidate && typeof candidate === 'object' ? candidate as MonitoringMetrics : null;
}

function getErrorMessage(error: unknown, section: string) {
  return error instanceof Error && error.message ? error.message : `Unable to load ${section}.`;
}

function getValidDriftPoints(history: DriftScore[]) {
  return history
    .map((item) => ({
      ...item,
      timestampValue: new Date(item.timestamp).getTime(),
      scoreValue: Number(item.score),
      thresholdValue: Number(item.threshold),
    }))
    .filter((item) => item.status !== 'insufficient_data' && Number.isFinite(item.timestampValue) && Number.isFinite(item.scoreValue) && Number.isFinite(item.thresholdValue))
    .sort((left, right) => left.timestampValue - right.timestampValue);
}

function MetricCard({ label, value, note, tone = 'neutral' }: MetricCardProps) {
  return (
    <article className={`dashboard-metric-card metric-${tone}`}>
      <div className="dashboard-card-kicker">{label}</div>
      <strong className="dashboard-metric-value">{value}</strong>
      <span className="dashboard-card-note">{note}</span>
    </article>
  );
}

function SectionCard({ title, eyebrow, children, className = '' }: { title: string; eyebrow?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`dashboard-section-card ${className}`}>
      <div className="dashboard-section-header">
        <div>
          {eyebrow && <p className="dashboard-section-eyebrow">{eyebrow}</p>}
          <h3>{title}</h3>
        </div>
      </div>
      {children}
    </section>
  );
}

function StatusBadge({ children, tone = 'neutral' }: StatusBadgeProps) {
  return <span className={`dashboard-status-badge badge-${tone}`}>{children}</span>;
}

function EmptyState({ message, description }: { message: string; description?: string }) {
  return (
    <div className="dashboard-empty-state" role="status">
      <span className="empty-state-icon">◌</span>
      <strong>{message}</strong>
      {description && <p className="dashboard-empty-description" style={{ fontSize: '0.825rem', color: 'var(--color-text-muted)', marginTop: '4px' }}>{description}</p>}
    </div>
  );
}

function DataTable<T>({ columns, rows, emptyMessage, emptyDescription }: { columns: TableColumn<T>[]; rows: T[]; emptyMessage: string; emptyDescription?: string }) {
  if (rows.length === 0) return <EmptyState message={emptyMessage} description={emptyDescription} />;

  return (
    <div className="dashboard-table-wrap">
      <table className="dashboard-table">
        <thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column.key}>{column.render(row)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function SectionState({ loading, error, onRetry, children }: { loading: boolean; error?: string; onRetry: () => void; children: ReactNode }) {
  if (loading) return <div className="dashboard-inline-loading" role="status" aria-live="polite">Loading section...</div>;
  if (error) {
    return <div className="dashboard-section-error" role="alert"><strong>Unable to load this section.</strong><span>{error}</span><button className="btn btn-secondary" type="button" onClick={onRetry}>Retry</button></div>;
  }
  return <>{children}</>;
}

function DriftPanel({ history, loading, error, onRetry }: { history: DriftScore[]; loading: boolean; error?: string; onRetry: () => void }) {
  const points = getValidDriftPoints(history);
  const latestRecord = history
    .filter((item) => Number.isFinite(new Date(item.timestamp).getTime()))
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())[0];
  const configuredThreshold = Number.isFinite(Number(latestRecord?.threshold))
    ? Number(latestRecord?.threshold)
    : 0.20;
  const latestHasScore = latestRecord?.status !== 'insufficient_data'
    && latestRecord !== undefined
    && Number.isFinite(Number(latestRecord.score));
  const latestExceedsThreshold = latestHasScore && Number(latestRecord.score) > configuredThreshold;

  const scoreDisplay = latestHasScore
    ? formatNumber(Number(latestRecord.score))
    : latestRecord?.status === 'insufficient_data'
      ? 'Awaiting 100 samples'
      : EMPTY_VALUE;

  return (
    <SectionCard title="Drift monitoring" eyebrow="Distribution health" className="drift-section">
      <SectionState loading={loading} error={error} onRetry={onRetry}>
        <div className="drift-summary-grid">
          <div><span>Latest drift score</span><strong>{scoreDisplay}</strong></div>
          <div><span>Drift threshold</span><strong>{formatNumber(configuredThreshold)}</strong></div>
          <div><span>Latest status</span><StatusBadge tone={latestRecord ? driftStatusTone(latestRecord.status, latestExceedsThreshold) : 'neutral'}>{latestRecord ? normalizeStatus(latestRecord.status) : 'No records'}</StatusBadge></div>
        </div>
        {history.length === 0 ? (
          <EmptyState message="No drift history available" />
        ) : points.length === 0 ? (
          <EmptyState
            message={history.some((record) => record.status === 'insufficient_data') ? 'Insufficient data to calculate a drift score' : 'No valid drift records available'}
            description={history.some((record) => record.status === 'insufficient_data') ? 'Population Stability Index (PSI) baseline requires 100 predictions to compute distribution drift. Configured threshold is 0.20.' : undefined}
          />
        ) : (
          <div className="drift-chart" aria-label="Drift history chart showing score and configured threshold over time">
            <h4 className="sr-only">Drift score and threshold over time</h4>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={points} margin={{ top: 10, right: 18, left: 8, bottom: 8 }}>
                <CartesianGrid stroke="var(--color-chart-grid)" strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" tickFormatter={formatTimestamp} stroke="var(--color-chart-axis)" tick={{ fontSize: 11 }} />
                <YAxis label={{ value: 'Drift score', angle: -90, position: 'insideLeft', fill: 'var(--color-chart-axis)', fontSize: 11 }} stroke="var(--color-chart-axis)" tick={{ fontSize: 11 }} />
                <Tooltip
                  labelFormatter={(label) => formatTimestamp(String(label))}
                  contentStyle={{
                    background: 'var(--color-chart-tooltip)',
                    border: '1px solid var(--color-chart-tooltip-border)',
                    color: 'var(--color-text-primary)',
                  }}
                />
                <Legend />
                <Line type="monotone" dataKey="scoreValue" name="Drift score" stroke="var(--color-chart-series-1)" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                <Line type="monotone" dataKey="thresholdValue" name="Threshold" stroke="var(--color-chart-series-2)" strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
            <p className="chart-accessible-summary">{points.length} valid drift readings from {formatTimestamp(points[0].timestamp)} to {formatTimestamp(points[points.length - 1].timestamp)}. Drift score is shown against the configured threshold.</p>
          </div>
        )}
        <p className="chart-caption">Drift history</p>
      </SectionState>
    </SectionCard>
  );
}

function AlertsPanel({ rows, loading, error, onRetry }: { rows: AlertRecord[]; loading: boolean; error?: string; onRetry: () => void }) {
  return (
    <SectionCard title="Alerts" eyebrow="Operational signals">
      <SectionState loading={loading} error={error} onRetry={onRetry}>
        <DataTable columns={[
          { key: 'message', label: 'Alert message', render: (row) => safeValue(row.message) },
          { key: 'model', label: 'Model ID', render: (row) => safeValue(row.model_id) },
          { key: 'status', label: 'Status', render: (row) => <StatusBadge tone={alertStatusTone(row.status)}>{normalizeStatus(row.status)}</StatusBadge> },
          { key: 'timestamp', label: 'Timestamp', render: (row) => formatTimestamp(row.timestamp) },
        ]} rows={rows} emptyMessage="No alerts available" emptyDescription="Alerts trigger when drift score exceeds the 0.20 PSI threshold or an operational rule is violated." />
      </SectionState>
    </SectionCard>
  );
}

function ModelsPanel({ rows, activeModel, loading, error, onRetry }: { rows: ModelVersionRecord[]; activeModel?: ModelVersionRecord; loading: boolean; error?: string; onRetry: () => void }) {
  return (
    <SectionCard title="Model versions" eyebrow="Registry history">
      <SectionState loading={loading} error={error} onRetry={onRetry}>
        <DataTable columns={[
          { key: 'model', label: 'Model ID', render: (row) => safeValue(row.model_id) },
          { key: 'version', label: 'Model version', render: (row) => safeValue(row.model_version) },
          { key: 'f1', label: 'F1 score', render: (row) => formatPercentage(row.f1) },
          { key: 'accuracy', label: 'Accuracy', render: (row) => formatPercentage(row.accuracy) },
          { key: 'active', label: 'Active status', render: (row) => <StatusBadge tone={activeModel?.id === row.id ? 'success' : 'neutral'}>{activeModel?.id === row.id ? 'Active model' : 'Inactive'}</StatusBadge> },
          { key: 'timestamp', label: 'Timestamp', render: (row) => formatTimestamp(row.timestamp) },
        ]} rows={rows} emptyMessage="No model versions available" />
      </SectionState>
    </SectionCard>
  );
}

function RetrainingPanel({ rows, loading, error, onRetry }: { rows: RetrainingJobRecord[]; loading: boolean; error?: string; onRetry: () => void }) {
  return (
    <SectionCard title="Retraining" eyebrow="Candidate lifecycle">
      <SectionState loading={loading} error={error} onRetry={onRetry}>
        <DataTable columns={[
          { key: 'job', label: 'Job ID', render: (row) => formatNumber(row.id) },
          { key: 'model', label: 'Model ID', render: (row) => safeValue(row.model_id) },
          { key: 'stage', label: 'Current stage', render: (row) => <StatusBadge>{retrainingStage(row)}</StatusBadge> },
          { key: 'reason', label: 'Trigger reason', render: (row) => normalizeStatus(row.trigger_reason || row.triggered_by) },
          { key: 'old', label: 'Old version', render: (row) => safeValue(row.old_model_version) },
          { key: 'new', label: 'New version', render: (row) => safeValue(row.new_model_version) },
          { key: 'started', label: 'Started', render: (row) => formatTimestamp(row.start_time) },
          { key: 'updated', label: 'Last updated', render: (row) => formatTimestamp(row.updated_at) },
          { key: 'samples', label: 'Verified labels / evaluation', render: (row) => `${formatNumber(row.sample_count)} / ${formatNumber(row.evaluation_sample_count)} (min ${formatNumber(row.min_samples)})` },
          { key: 'ended', label: 'Ended', render: (row) => formatTimestamp(row.end_time) },
          { key: 'promoted', label: 'Promotion status', render: (row) => <StatusBadge tone={row.promoted ? 'success' : 'neutral'}>{retrainingStatus(row)}</StatusBadge> },
          { key: 'candidate-f1', label: 'Candidate F1', render: (row) => formatPercentage(row.candidate_f1) },
          { key: 'incumbent-f1', label: 'Incumbent F1', render: (row) => formatPercentage(row.incumbent_f1) },
          { key: 'promotion-reason', label: 'Promotion detail', render: (row) => normalizeStatus(row.promotion_reason) },
          { key: 'reload', label: 'Reload status', render: (row) => <StatusBadge>{row.reload_status ? normalizeStatus(row.reload_status) : 'Not available'}</StatusBadge> },
        ]} rows={rows} emptyMessage="No retraining jobs available" emptyDescription="Retraining triggers upon sustained distribution drift (PSI > 0.20) or operator initiation." />
      </SectionState>
      {rows.some((row) => row.error_message) && (
        <ul className="dashboard-table-note">
          {rows.filter((row) => row.error_message).map((row) => (
            <li key={row.id}>Job {row.id}: {row.error_message}</li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function PredictionsPanel({
  rows,
  loading,
  error,
  onRetry,
  onLabelPrediction,
  updatingPredictionId,
}: {
  rows: PredictionHistoryItem[];
  loading: boolean;
  error?: string;
  onRetry: () => void;
  onLabelPrediction?: (id: number, label: 'normal' | 'attack') => Promise<void>;
  updatingPredictionId?: number | null;
}) {
  return (
    <SectionCard title="Recent predictions" eyebrow="Inference activity">
      <SectionState loading={loading} error={error} onRetry={onRetry}>
        <DataTable columns={[
          { key: 'id', label: 'Prediction ID', render: (row) => formatNumber(row.id) },
          { key: 'request', label: 'Request ID', render: (row) => safeValue(row.request_id) },
          { key: 'version', label: 'Model version', render: (row) => safeValue(row.model_version) },
          { key: 'predicted', label: 'Predicted label', render: (row) => safeValue(row.prediction) },
          {
            key: 'class',
            label: 'Prediction class',
            render: (row) => (
              <span
                className="prediction-class-cell"
                title={`Binary target class ${row.prediction_class}: ${row.prediction_class === 0 ? 'normal (benign traffic)' : row.prediction_class === 1 ? 'attack (intrusion)' : 'unknown'}`}
              >
                <code>{formatNumber(row.prediction_class)}</code>{' '}
                <span className="class-label-tag" style={{ fontSize: '0.825em', opacity: 0.85 }}>
                  ({row.prediction_class === 0 ? 'normal' : row.prediction_class === 1 ? 'attack' : 'N/A'})
                </span>
              </span>
            ),
          },
          { key: 'confidence', label: 'Confidence', render: (row) => formatPercentage(row.confidence) },
          { key: 'latency', label: 'Inference latency (ms)', render: (row) => formatNumber(row.inference_latency_ms) },
          {
            key: 'actual',
            label: 'Actual label',
            render: (row) => {
              if (row.actual_label) {
                return (
                  <span className={`status-badge ${row.actual_label.toLowerCase()}`}>
                    {row.actual_label.toUpperCase()}
                  </span>
                );
              }
              if (onLabelPrediction) {
                return (
                  <div className="table-action-group" role="group" aria-label={`Label prediction ${row.id}`}>
                    <button
                      type="button"
                      className="btn-table-action action-normal"
                      disabled={updatingPredictionId === row.id}
                      onClick={() => void onLabelPrediction(row.id, 'normal')}
                      title="Label as normal (benign traffic)"
                      aria-label={`Label prediction ${row.id} as normal`}
                    >
                      {updatingPredictionId === row.id ? '...' : 'Normal'}
                    </button>
                    <button
                      type="button"
                      className="btn-table-action action-attack"
                      disabled={updatingPredictionId === row.id}
                      onClick={() => void onLabelPrediction(row.id, 'attack')}
                      title="Label as attack (network intrusion)"
                      aria-label={`Label prediction ${row.id} as attack`}
                    >
                      {updatingPredictionId === row.id ? '...' : 'Attack'}
                    </button>
                  </div>
                );
              }
              return safeValue(row.actual_label);
            },
          },
          { key: 'timestamp', label: 'Timestamp', render: (row) => formatTimestamp(row.timestamp) },
        ]} rows={rows} emptyMessage="No predictions available" />
        <p className="dashboard-table-note" style={{ marginTop: '10px', fontSize: '0.825rem', color: 'var(--color-text-muted)' }}>
          ℹ <strong>Class mapping legend:</strong> <code>0 = normal</code> (benign network traffic), <code>1 = attack</code> (network intrusion). In NSL-KDD binary classification, 0 is the negative baseline class and 1 is the positive attack class.
        </p>
      </SectionState>
    </SectionCard>
  );
}

export function Dashboard() {
  const [metrics, setMetrics] = useState<MonitoringMetrics | null>(null);
  const [driftHistory, setDriftHistory] = useState<DriftScore[]>([]);
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [models, setModels] = useState<ModelVersionRecord[]>([]);
  const [retrainingJobs, setRetrainingJobs] = useState<RetrainingJobRecord[]>([]);
  const [predictions, setPredictions] = useState<PredictionHistoryItem[]>([]);
  const [updatingPredictionId, setUpdatingPredictionId] = useState<number | null>(null);
  const [loading, setLoading] = useState<Record<DashboardSection, boolean>>({ metrics: true, drift: true, alerts: true, models: true, retraining: true, predictions: true });
  const [errors, setErrors] = useState<SectionErrors>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSuccessfulRefresh, setLastSuccessfulRefresh] = useState<string | null>(null);
  const refreshInFlight = useRef(false);
  const mounted = useRef(false);

  const refreshIntervalMs = getDashboardRefreshIntervalMs();
  const loadDashboard = useCallback(async (initialLoad = false) => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    if (initialLoad) {
      setLoading({ metrics: true, drift: true, alerts: true, models: true, retraining: true, predictions: true });
    } else {
      setIsRefreshing(true);
    }

    try {
      const results = await Promise.allSettled([
        apiClient.getMetrics(),
        apiClient.getDriftHistory({ limit: READ_LIMIT }),
        apiClient.getAlerts({ limit: READ_LIMIT }),
        apiClient.getModels(),
        apiClient.getRetrainingJobs(),
        apiClient.getPredictionHistory({ limit: READ_LIMIT }),
      ]);
      if (!mounted.current) return;

      const sections: DashboardSection[] = ['metrics', 'drift', 'alerts', 'models', 'retraining', 'predictions'];
      const nextErrors: SectionErrors = {};
      const nextLoading = { metrics: false, drift: false, alerts: false, models: false, retraining: false, predictions: false };
      results.forEach((result, index) => {
        if (result.status === 'rejected') nextErrors[sections[index]] = getErrorMessage(result.reason, sections[index]);
      });
      if (results[0].status === 'fulfilled') setMetrics(asMetrics(results[0].value));
      if (results[1].status === 'fulfilled') setDriftHistory(asArray<DriftScore>(results[1].value));
      if (results[2].status === 'fulfilled') setAlerts(asArray<AlertRecord>(results[2].value));
      if (results[3].status === 'fulfilled') setModels(asArray<ModelVersionRecord>(results[3].value));
      if (results[4].status === 'fulfilled') setRetrainingJobs(asArray<RetrainingJobRecord>(results[4].value));
      if (results[5].status === 'fulfilled') setPredictions(asArray<PredictionHistoryItem>(results[5].value));
      setErrors(nextErrors);
      setLoading(nextLoading);
      if (results.every((result) => result.status === 'fulfilled')) {
        setLastSuccessfulRefresh(new Date().toISOString());
      }
    } finally {
      refreshInFlight.current = false;
      if (mounted.current) setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void loadDashboard(true);
    const interval = window.setInterval(() => {
      void loadDashboard(false);
    }, refreshIntervalMs);
    return () => {
      mounted.current = false;
      window.clearInterval(interval);
    };
  }, [loadDashboard, refreshIntervalMs]);

  const retry = () => { void loadDashboard(false); };
  const metricCards: MetricCardProps[] = [
    { label: 'Total Predictions', value: formatNumber(metrics?.total_prediction_count), note: 'Recorded predictions' },
    { label: 'Labeled Predictions', value: formatNumber(metrics?.labeled_prediction_count), note: 'Available for evaluation' },
    { label: 'Accuracy', value: formatPercentage(metrics?.accuracy), note: normalizeStatus(metrics?.metrics_status), tone: 'positive' },
    { label: 'Precision', value: formatPercentage(metrics?.precision), note: 'Attack classification', tone: 'positive' },
    { label: 'Recall', value: formatPercentage(metrics?.recall), note: 'Attack classification', tone: 'warning' },
    { label: 'F1 Score', value: formatPercentage(metrics?.f1), note: 'Balanced classification' },
  ];
  const activeModel = models.find((model) => model.is_active);
  const activeModelId = activeModel?.model_id || metrics?.model_id || null;
  const visibleDriftHistory = activeModelId ? driftHistory.filter((row) => row.model_id === activeModelId) : driftHistory;
  const visibleAlerts = activeModelId ? alerts.filter((row) => row.model_id === activeModelId) : alerts;
  const visiblePredictions = activeModelId ? predictions.filter((row) => row.model_id === activeModelId) : predictions;

  const handleLabelPrediction = async (id: number, label: 'normal' | 'attack') => {
    try {
      setUpdatingPredictionId(id);
      await apiClient.labelPrediction(id, label);
      await loadDashboard(false);
    } catch (err) {
      console.error('Failed to submit ground-truth label:', err);
    } finally {
      setUpdatingPredictionId(null);
    }
  };

  return (
    <div className="dashboard-page">
      <div className="dashboard-page-heading">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>ML Model Performance Monitoring Platform</h1>
          <p className="dashboard-intro">A focused view of model quality, drift, alerts, and operational history.</p>
        </div>
        <div className="dashboard-refresh-controls">
          <button className="btn btn-secondary dashboard-refresh" type="button" onClick={retry} disabled={Object.values(loading).some(Boolean) || isRefreshing}>
            {isRefreshing || Object.values(loading).some(Boolean) ? 'Refreshing...' : 'Refresh dashboard'}
          </button>
          <div className="dashboard-refresh-status" aria-live="polite">
            <span>Automatic refresh <strong>On · every {Math.round(refreshIntervalMs / 1000)}s</strong></span>
            <span>Last successful refresh <strong>{formatTimestamp(lastSuccessfulRefresh)}</strong></span>
          </div>
        </div>
      </div>

      {loading.metrics ? <div className="dashboard-loading-bar">Loading monitoring metrics...</div> : errors.metrics ? <div className="dashboard-section-error"><strong>Metrics unavailable.</strong><span>{errors.metrics}</span><button className="btn btn-secondary" type="button" onClick={retry}>Retry</button></div> : (
        <section className="dashboard-metrics-grid" aria-label="Model performance metrics">
          {metricCards.map((metric) => <MetricCard key={metric.label} {...metric} />)}
        </section>
      )}

      <div className="dashboard-primary-grid">
        <DriftPanel history={visibleDriftHistory} loading={loading.drift} error={errors.drift} onRetry={retry} />
        <SectionCard title="Current model" eyebrow="Serving metadata" className="model-summary-section">
          <SectionState loading={loading.models} error={errors.models} onRetry={retry}>
            <div className="model-summary-list">
              <div><span>Model ID</span><strong>{activeModel?.model_id || metrics?.model_id || EMPTY_VALUE}</strong></div>
              <div><span>Model version</span><strong>{activeModel?.model_version || metrics?.model_version || EMPTY_VALUE}</strong></div>
              <div><span>Service status</span><StatusBadge tone={activeModel ? 'success' : 'neutral'}>{activeModel ? 'Active' : EMPTY_VALUE}</StatusBadge></div>
            </div>
          </SectionState>
        </SectionCard>
      </div>

      <div className="dashboard-section-stack">
        <AlertsPanel rows={visibleAlerts} loading={loading.alerts} error={errors.alerts} onRetry={retry} />
        <ModelsPanel rows={models} activeModel={activeModel} loading={loading.models} error={errors.models} onRetry={retry} />
        <RetrainingPanel rows={retrainingJobs} loading={loading.retraining} error={errors.retraining} onRetry={retry} />
        <PredictionsPanel
          rows={visiblePredictions}
          loading={loading.predictions}
          error={errors.predictions}
          onRetry={retry}
          onLabelPrediction={handleLabelPrediction}
          updatingPredictionId={updatingPredictionId}
        />
      </div>
    </div>
  );
}
