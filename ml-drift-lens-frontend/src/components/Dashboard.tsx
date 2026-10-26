import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  BenchmarkData,
  DemoScenarioData,
  DriftScore,
  ModelVersionRecord,
  MonitoringMetrics,
  PredictionHistoryItem,
  RetrainingJobRecord,
} from '../services/apiClient';
import { CANONICAL_BENCHMARK_DATA, DEFAULT_DEMO_SCENARIO } from '../services/benchmarkData';
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
  badge?: string;
  badgeTone?: 'production' | 'benchmark' | 'demo';
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
export type DataEnvironmentMode = 'production' | 'demo';

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
  return normalized === 'resolved' || normalized === 'closed'
    ? 'success'
    : normalized === 'open' || normalized === 'active'
      ? 'warning'
      : 'neutral';
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
  return candidate && typeof candidate === 'object' ? (candidate as MonitoringMetrics) : null;
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
    .filter(
      (item) =>
        item.status !== 'insufficient_data' &&
        Number.isFinite(item.timestampValue) &&
        Number.isFinite(item.scoreValue) &&
        Number.isFinite(item.thresholdValue),
    )
    .sort((left, right) => left.timestampValue - right.timestampValue);
}

function MetricCard({ label, value, note, tone = 'neutral', badge, badgeTone = 'production' }: MetricCardProps) {
  return (
    <article className={`dashboard-metric-card metric-${tone}`}>
      <div className="dashboard-card-top-row">
        <div className="dashboard-card-kicker">{label}</div>
        {badge && (
          <span className={`data-source-badge badge-${badgeTone} badge-sm`}>
            {badge}
          </span>
        )}
      </div>
      <strong className="dashboard-metric-value">{value}</strong>
      <span className="dashboard-card-note">{note}</span>
    </article>
  );
}

function SectionCard({
  title,
  eyebrow,
  badge,
  badgeTone = 'production',
  children,
  className = '',
  id,
}: {
  title: string;
  eyebrow?: string;
  badge?: string;
  badgeTone?: 'production' | 'benchmark' | 'demo';
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section className={`dashboard-section-card ${className}`} id={id}>
      <div className="dashboard-section-header">
        <div>
          {eyebrow && <p className="dashboard-section-eyebrow">{eyebrow}</p>}
          <h3>{title}</h3>
        </div>
        {badge && <span className={`data-source-badge badge-${badgeTone}`}>{badge}</span>}
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
      {description && (
        <p className="dashboard-empty-description" style={{ fontSize: '0.825rem', color: 'var(--color-text-muted)', marginTop: '4px' }}>
          {description}
        </p>
      )}
    </div>
  );
}

function DataTable<T>({
  columns,
  rows,
  emptyMessage,
  emptyDescription,
}: {
  columns: TableColumn<T>[];
  rows: T[];
  emptyMessage: string;
  emptyDescription?: string;
}) {
  if (rows.length === 0) return <EmptyState message={emptyMessage} description={emptyDescription} />;

  return (
    <div className="dashboard-table-wrap">
      <table className="dashboard-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={column.key}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectionState({
  loading,
  error,
  onRetry,
  children,
}: {
  loading: boolean;
  error?: string;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (loading) return <div className="dashboard-inline-loading" role="status" aria-live="polite">Loading section...</div>;
  if (error) {
    return (
      <div className="dashboard-section-error" role="alert">
        <strong>Unable to load this section.</strong>
        <span>{error}</span>
        <button className="btn btn-secondary" type="button" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }
  return <>{children}</>;
}

function DriftPanel({
  history,
  sampleCount,
  loading,
  error,
  badge,
  badgeTone,
  onRetry,
}: {
  history: DriftScore[];
  sampleCount: number;
  loading: boolean;
  error?: string;
  badge?: string;
  badgeTone?: 'production' | 'benchmark' | 'demo';
  onRetry: () => void;
}) {
  const points = getValidDriftPoints(history);
  const latestRecord = history
    .filter((item) => Number.isFinite(new Date(item.timestamp).getTime()))
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())[0];
  const configuredThreshold = Number.isFinite(Number(latestRecord?.threshold))
    ? Number(latestRecord?.threshold)
    : 0.2;
  const latestHasScore =
    latestRecord?.status !== 'insufficient_data' &&
    latestRecord !== undefined &&
    Number.isFinite(Number(latestRecord.score));
  const latestExceedsThreshold = latestHasScore && Number(latestRecord.score) > configuredThreshold;

  const scoreDisplay = latestHasScore
    ? formatNumber(Number(latestRecord.score))
    : latestRecord?.status === 'insufficient_data'
      ? 'Awaiting 100 samples'
      : EMPTY_VALUE;

  const readinessPercent = Math.min(100, Math.round((sampleCount / 100) * 100));

  return (
    <SectionCard title="Drift monitoring" eyebrow="Distribution health" badge={badge} badgeTone={badgeTone} className="drift-section">
      <SectionState loading={loading} error={error} onRetry={onRetry}>
        <div className="drift-summary-grid">
          <div>
            <span>Latest drift score</span>
            <strong>{scoreDisplay}</strong>
          </div>
          <div>
            <span>Drift threshold</span>
            <strong>{formatNumber(configuredThreshold)}</strong>
          </div>
          <div>
            <span>Latest status</span>
            <StatusBadge tone={latestRecord ? driftStatusTone(latestRecord.status, latestExceedsThreshold) : 'neutral'}>
              {latestRecord ? normalizeStatus(latestRecord.status) : 'No records'}
            </StatusBadge>
          </div>
        </div>

        {history.length === 0 ? (
          <EmptyState message="No drift history available" />
        ) : points.length === 0 ? (
          history.some((record) => record.status === 'insufficient_data') ? (
            <div style={{ marginTop: '16px' }}>
              <EmptyState
                message="Insufficient data to calculate a drift score"
                description="Population Stability Index (PSI) baseline requires 100 predictions to compute distribution drift. Configured threshold is 0.20."
              />
              <div className="readiness-meter-wrap" style={{ marginTop: '12px' }}>
                <div className="readiness-meter-labels">
                  <span>PSI Sample Window Readiness</span>
                  <strong>{sampleCount} / 100 observations ({readinessPercent}%)</strong>
                </div>
                <div className="readiness-meter-track">
                  <div
                    className="readiness-meter-fill"
                    style={{ width: `${Math.max(4, readinessPercent)}%` }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <EmptyState message="No valid drift records available" />
          )
        ) : (
          <div className="drift-chart" aria-label="Drift history chart showing score and configured threshold over time">
            <h4 className="sr-only">Drift score and threshold over time</h4>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={points} margin={{ top: 10, right: 18, left: 8, bottom: 8 }}>
                <CartesianGrid stroke="var(--color-chart-grid)" strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" tickFormatter={formatTimestamp} stroke="var(--color-chart-axis)" tick={{ fontSize: 11 }} />
                <YAxis
                  label={{ value: 'Drift score (PSI)', angle: -90, position: 'insideLeft', fill: 'var(--color-chart-axis)', fontSize: 11 }}
                  stroke="var(--color-chart-axis)"
                  tick={{ fontSize: 11 }}
                />
                <Tooltip
                  labelFormatter={(label) => formatTimestamp(String(label))}
                  contentStyle={{
                    background: 'var(--color-chart-tooltip)',
                    border: '1px solid var(--color-chart-tooltip-border)',
                    color: 'var(--color-text-primary)',
                  }}
                />
                <Legend />
                <Line type="monotone" dataKey="scoreValue" name="Observed PSI" stroke="var(--color-chart-series-1)" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                <Line type="monotone" dataKey="thresholdValue" name="PSI Threshold (0.20)" stroke="var(--color-chart-series-2)" strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
            <p className="chart-accessible-summary">
              {points.length} {points.length === 1 ? 'valid drift reading' : 'valid drift readings'} from {formatTimestamp(points[0].timestamp)} to {formatTimestamp(points[points.length - 1].timestamp)}. Drift score is shown against the configured threshold.
            </p>
          </div>
        )}
        <p className="chart-caption">Population Stability Index (PSI) baseline tracking</p>
      </SectionState>
    </SectionCard>
  );
}

function AlertsPanel({
  rows,
  loading,
  error,
  badge,
  badgeTone,
  onRetry,
}: {
  rows: AlertRecord[];
  loading: boolean;
  error?: string;
  badge?: string;
  badgeTone?: 'production' | 'benchmark' | 'demo';
  onRetry: () => void;
}) {
  return (
    <SectionCard title="Alerts" eyebrow="Operational signals" badge={badge} badgeTone={badgeTone}>
      <SectionState loading={loading} error={error} onRetry={onRetry}>
        <DataTable
          columns={[
            { key: 'message', label: 'Alert message', render: (row) => safeValue(row.message) },
            { key: 'model', label: 'Model ID', render: (row) => safeValue(row.model_id) },
            { key: 'status', label: 'Status', render: (row) => <StatusBadge tone={alertStatusTone(row.status)}>{normalizeStatus(row.status)}</StatusBadge> },
            { key: 'timestamp', label: 'Timestamp', render: (row) => formatTimestamp(row.timestamp) },
          ]}
          rows={rows}
          emptyMessage="No alerts available"
          emptyDescription="Alerts trigger automatically when observed PSI drift exceeds the configured 0.20 threshold."
        />
      </SectionState>
    </SectionCard>
  );
}

function ModelsPanel({
  rows,
  activeModel,
  loading,
  error,
  badge,
  badgeTone,
  onRetry,
}: {
  rows: ModelVersionRecord[];
  activeModel?: ModelVersionRecord;
  loading: boolean;
  error?: string;
  badge?: string;
  badgeTone?: 'production' | 'benchmark' | 'demo';
  onRetry: () => void;
}) {
  return (
    <SectionCard title="Model versions" eyebrow="Registry history" badge={badge} badgeTone={badgeTone}>
      <SectionState loading={loading} error={error} onRetry={onRetry}>
        <DataTable
          columns={[
            { key: 'model', label: 'Model ID', render: (row) => safeValue(row.model_id) },
            { key: 'version', label: 'Model version', render: (row) => safeValue(row.model_version) },
            { key: 'f1', label: 'F1 score', render: (row) => formatPercentage(row.f1) },
            { key: 'accuracy', label: 'Accuracy', render: (row) => formatPercentage(row.accuracy) },
            {
              key: 'active',
              label: 'Active status',
              render: (row) => (
                <StatusBadge tone={activeModel?.id === row.id ? 'success' : 'neutral'}>
                  {activeModel?.id === row.id ? 'Active model' : 'Inactive'}
                </StatusBadge>
              ),
            },
            { key: 'timestamp', label: 'Timestamp', render: (row) => formatTimestamp(row.timestamp) },
          ]}
          rows={rows}
          emptyMessage="No model versions available"
        />
      </SectionState>
    </SectionCard>
  );
}

function RetrainingPanel({
  rows,
  loading,
  error,
  badge,
  badgeTone,
  onRetry,
}: {
  rows: RetrainingJobRecord[];
  loading: boolean;
  error?: string;
  badge?: string;
  badgeTone?: 'production' | 'benchmark' | 'demo';
  onRetry: () => void;
}) {
  return (
    <SectionCard title="Retraining" eyebrow="Candidate lifecycle" badge={badge} badgeTone={badgeTone}>
      <SectionState loading={loading} error={error} onRetry={onRetry}>
        <DataTable
          columns={[
            { key: 'job', label: 'Job ID', render: (row) => formatNumber(row.id) },
            { key: 'model', label: 'Model ID', render: (row) => safeValue(row.model_id) },
            { key: 'stage', label: 'Current stage', render: (row) => <StatusBadge>{retrainingStage(row)}</StatusBadge> },
            { key: 'reason', label: 'Trigger reason', render: (row) => normalizeStatus(row.trigger_reason || row.triggered_by) },
            { key: 'old', label: 'Old version', render: (row) => safeValue(row.old_model_version) },
            { key: 'new', label: 'New version', render: (row) => safeValue(row.new_model_version) },
            { key: 'started', label: 'Started', render: (row) => formatTimestamp(row.start_time) },
            { key: 'updated', label: 'Last updated', render: (row) => formatTimestamp(row.updated_at) },
            {
              key: 'samples',
              label: 'Verified labels / evaluation',
              render: (row) => `${formatNumber(row.sample_count)} / ${formatNumber(row.evaluation_sample_count)} (min ${formatNumber(row.min_samples)})`,
            },
            { key: 'promoted', label: 'Promotion status', render: (row) => <StatusBadge tone={row.promoted ? 'success' : 'neutral'}>{retrainingStatus(row)}</StatusBadge> },
            { key: 'candidate-f1', label: 'Candidate F1', render: (row) => formatPercentage(row.candidate_f1) },
            { key: 'incumbent-f1', label: 'Incumbent F1', render: (row) => formatPercentage(row.incumbent_f1) },
            { key: 'promotion-reason', label: 'Promotion detail', render: (row) => normalizeStatus(row.promotion_reason) },
            { key: 'reload', label: 'Reload status', render: (row) => <StatusBadge>{row.reload_status ? normalizeStatus(row.reload_status) : 'Not available'}</StatusBadge> },
          ]}
          rows={rows}
          emptyMessage="No retraining jobs available"
          emptyDescription="Retraining is queued when sustained PSI drift (> 0.20) is confirmed or initiated by authorized operators."
        />
      </SectionState>
    </SectionCard>
  );
}

function PredictionsPanel({
  rows,
  loading,
  error,
  badge,
  badgeTone,
  isDemo,
  onRetry,
  onLabelPrediction,
  updatingPredictionId,
}: {
  rows: PredictionHistoryItem[];
  loading: boolean;
  error?: string;
  badge?: string;
  badgeTone?: 'production' | 'benchmark' | 'demo';
  isDemo?: boolean;
  onRetry: () => void;
  onLabelPrediction?: (id: number, label: 'normal' | 'attack') => Promise<void>;
  updatingPredictionId?: number | null;
}) {
  return (
    <SectionCard title="Recent predictions" eyebrow="Inference activity" badge={badge} badgeTone={badgeTone} id="recent-predictions">
      <SectionState loading={loading} error={error} onRetry={onRetry}>
        {isDemo && (
          <div
            className="demo-inference-notice"
            role="status"
            style={{
              marginBottom: '12px',
              padding: '10px 14px',
              borderRadius: '6px',
              background: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.25)',
              fontSize: '0.825rem',
              color: 'var(--color-text, #e2e8f0)',
              lineHeight: 1.45,
            }}
          >
            <strong>🔶 Synthetic Demonstration Inferences:</strong> The 4 records below (<code>sim-req-901</code> to <code>sim-req-904</code>) are synthetic examples demonstrating normal and attack traffic patterns with simulated latency and confidence scores. They do not represent genuine production network traffic or database records.
          </div>
        )}
        <DataTable
          columns={[
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
                  title={`Binary target class ${row.prediction_class}: ${row.prediction_class === 0 ? 'normal (benign network flow)' : row.prediction_class === 1 ? 'attack (network intrusion)' : 'unknown'}`}
                >
                  <code>{formatNumber(row.prediction_class)}</code>{' '}
                  <span className="class-label-tag" style={{ fontSize: '0.825em', opacity: 0.85 }}>
                    ({row.prediction_class === 0 ? 'normal' : row.prediction_class === 1 ? 'attack' : 'N/A'})
                  </span>
                </span>
              ),
            },
            { key: 'confidence', label: 'Confidence', render: (row) => formatPercentage(row.confidence) },
            { key: 'latency', label: 'Latency (ms)', render: (row) => formatNumber(row.inference_latency_ms) },
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
          ]}
          rows={rows}
          emptyMessage="No predictions available"
        />
        <p className="dashboard-table-note" style={{ marginTop: '10px', fontSize: '0.825rem', color: 'var(--color-text-muted)' }}>
          ℹ <strong>Class mapping legend:</strong> <code>0 = normal</code> (benign network flow), <code>1 = attack</code> (network intrusion). In NSL-KDD binary classification, 0 is the negative baseline class and 1 is the positive attack class.
        </p>
      </SectionState>
    </SectionCard>
  );
}

export function Dashboard() {
  const [dataMode, setDataMode] = useState<DataEnvironmentMode>('production');
  const [metrics, setMetrics] = useState<MonitoringMetrics | null>(null);
  const [driftHistory, setDriftHistory] = useState<DriftScore[]>([]);
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [models, setModels] = useState<ModelVersionRecord[]>([]);
  const [retrainingJobs, setRetrainingJobs] = useState<RetrainingJobRecord[]>([]);
  const [predictions, setPredictions] = useState<PredictionHistoryItem[]>([]);
  const [benchmark, setBenchmark] = useState<BenchmarkData>(CANONICAL_BENCHMARK_DATA);
  const [demoScenario, setDemoScenario] = useState<DemoScenarioData>(DEFAULT_DEMO_SCENARIO);
  const [updatingPredictionId, setUpdatingPredictionId] = useState<number | null>(null);
  const [loading, setLoading] = useState<Record<DashboardSection, boolean>>({
    metrics: true,
    drift: true,
    alerts: true,
    models: true,
    retraining: true,
    predictions: true,
  });
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
        apiClient.getBenchmarkData(),
        apiClient.getDemoScenario(),
      ]);
      if (!mounted.current) return;

      const sections: DashboardSection[] = ['metrics', 'drift', 'alerts', 'models', 'retraining', 'predictions'];
      const nextErrors: SectionErrors = {};
      const nextLoading = { metrics: false, drift: false, alerts: false, models: false, retraining: false, predictions: false };
      results.slice(0, 6).forEach((result, index) => {
        if (result.status === 'rejected') nextErrors[sections[index]] = getErrorMessage(result.reason, sections[index]);
      });
      if (results[0].status === 'fulfilled') setMetrics(asMetrics(results[0].value));
      if (results[1].status === 'fulfilled') setDriftHistory(asArray<DriftScore>(results[1].value));
      if (results[2].status === 'fulfilled') setAlerts(asArray<AlertRecord>(results[2].value));
      if (results[3].status === 'fulfilled') setModels(asArray<ModelVersionRecord>(results[3].value));
      if (results[4].status === 'fulfilled') setRetrainingJobs(asArray<RetrainingJobRecord>(results[4].value));
      if (results[5].status === 'fulfilled') setPredictions(asArray<PredictionHistoryItem>(results[5].value));
      if (results[6].status === 'fulfilled' && results[6].value) setBenchmark(results[6].value);
      if (results[7].status === 'fulfilled' && results[7].value) setDemoScenario(results[7].value);

      setErrors(nextErrors);
      setLoading(nextLoading);
      if (results.slice(0, 6).every((result) => result.status === 'fulfilled')) {
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

  const retry = () => {
    void loadDashboard(false);
  };

  const activeModel = models.find((model) => model.is_active);
  const activeModelId = activeModel?.model_id || metrics?.model_id || null;
  const visibleDriftHistory = activeModelId ? driftHistory.filter((row) => row.model_id === activeModelId) : driftHistory;
  const visibleAlerts = activeModelId ? alerts.filter((row) => row.model_id === activeModelId) : alerts;
  const visiblePredictions = activeModelId ? predictions.filter((row) => row.model_id === activeModelId) : predictions;

  // Switched data views based on environment mode
  const isDemo = dataMode === 'demo';
  const displayMetrics = isDemo ? demoScenario.metrics : metrics;
  const displayDriftHistory = isDemo ? demoScenario.drift_history : visibleDriftHistory;
  const displayAlerts = isDemo ? demoScenario.alerts : visibleAlerts;
  const displayRetraining = isDemo ? demoScenario.retraining_jobs : retrainingJobs;
  const displayPredictions = isDemo
    ? [
        {
          id: 901,
          model_id: 'nsl-kdd-baseline',
          model_version: 'nsl-kdd-validation-20260928',
          preprocessing_version: 'preprocessing-v1',
          input_features: '{}',
          prediction: 'attack',
          prediction_class: 1,
          confidence: 0.985,
          inference_latency_ms: 3.8,
          request_id: 'sim-req-901',
          timestamp: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
          actual_label: 'attack',
        },
        {
          id: 902,
          model_id: 'nsl-kdd-baseline',
          model_version: 'nsl-kdd-validation-20260928',
          preprocessing_version: 'preprocessing-v1',
          input_features: '{}',
          prediction: 'normal',
          prediction_class: 0,
          confidence: 0.992,
          inference_latency_ms: 4.1,
          request_id: 'sim-req-902',
          timestamp: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
          actual_label: 'normal',
        },
        {
          id: 903,
          model_id: 'nsl-kdd-baseline',
          model_version: 'nsl-kdd-validation-20260928',
          preprocessing_version: 'preprocessing-v1',
          input_features: '{}',
          prediction: 'attack',
          prediction_class: 1,
          confidence: 0.941,
          inference_latency_ms: 5.2,
          request_id: 'sim-req-903',
          timestamp: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
          actual_label: 'attack',
        },
        {
          id: 904,
          model_id: 'nsl-kdd-baseline',
          model_version: 'nsl-kdd-validation-20260928',
          preprocessing_version: 'preprocessing-v1',
          input_features: '{}',
          prediction: 'normal',
          prediction_class: 0,
          confidence: 0.978,
          inference_latency_ms: 4.0,
          request_id: 'sim-req-904',
          timestamp: new Date(Date.now() - 1 * 60 * 1000).toISOString(),
          actual_label: 'normal',
        },
      ]
    : visiblePredictions;

  // Latency and class distribution statistics
  const latencyStats = useMemo(() => {
    if (isDemo) {
      return {
        min: demoScenario.latency_distribution.min_ms,
        median: demoScenario.latency_distribution.median_ms,
        p95: demoScenario.latency_distribution.p95_ms,
        max: demoScenario.latency_distribution.max_ms,
      };
    }
    const latencies = visiblePredictions
      .map((item) => Number(item.inference_latency_ms))
      .filter((ms) => Number.isFinite(ms) && ms > 0)
      .sort((a, b) => a - b);
    if (latencies.length === 0) return { min: null, median: null, p95: null, max: null };
    return {
      min: latencies[0],
      median: latencies[Math.floor(latencies.length * 0.5)],
      p95: latencies[Math.floor(latencies.length * 0.95)] || latencies[latencies.length - 1],
      max: latencies[latencies.length - 1],
    };
  }, [isDemo, demoScenario, visiblePredictions]);

  const classDist = useMemo(() => {
    if (isDemo) {
      return {
        total: demoScenario.class_distribution.total,
        normalCount: demoScenario.class_distribution.normal_count,
        attackCount: demoScenario.class_distribution.attack_count,
        normalPct: demoScenario.class_distribution.normal_pct,
        attackPct: demoScenario.class_distribution.attack_pct,
      };
    }
    const total = visiblePredictions.length;
    if (total === 0) return { total: 0, normalCount: 0, attackCount: 0, normalPct: 50, attackPct: 50 };
    const normalCount = visiblePredictions.filter(
      (p) => p.prediction_class === 0 || p.prediction?.toLowerCase() === 'normal',
    ).length;
    const attackCount = total - normalCount;
    return {
      total,
      normalCount,
      attackCount,
      normalPct: Math.round((normalCount / total) * 100),
      attackPct: Math.round((attackCount / total) * 100),
    };
  }, [isDemo, demoScenario, visiblePredictions]);

  const metricCards: MetricCardProps[] = [
    {
      label: 'Total Predictions',
      value: formatNumber(displayMetrics?.total_prediction_count),
      note: isDemo ? 'Simulated stream total' : 'Recorded in database',
      badge: isDemo ? 'Simulated' : undefined,
      badgeTone: isDemo ? 'demo' : undefined,
    },
    {
      label: 'Labeled Predictions',
      value: formatNumber(displayMetrics?.labeled_prediction_count),
      note: isDemo ? '500 verified holdouts' : 'Available for evaluation',
      badge: isDemo ? 'Simulated' : undefined,
      badgeTone: isDemo ? 'demo' : undefined,
    },
    {
      label: 'Accuracy',
      value:
        displayMetrics?.accuracy !== null && displayMetrics?.accuracy !== undefined
          ? formatPercentage(displayMetrics.accuracy)
          : 'Awaiting labels',
      note: isDemo ? 'Canonical test holdout' : normalizeStatus(displayMetrics?.metrics_status),
      tone: 'positive',
      badge: isDemo ? 'Benchmark' : undefined,
      badgeTone: isDemo ? 'benchmark' : undefined,
    },
    {
      label: 'Precision',
      value:
        displayMetrics?.precision !== null && displayMetrics?.precision !== undefined
          ? formatPercentage(displayMetrics.precision)
          : 'Awaiting labels',
      note: 'Attack classification',
      tone: 'positive',
      badge: isDemo ? 'Benchmark' : undefined,
      badgeTone: isDemo ? 'benchmark' : undefined,
    },
    {
      label: 'Recall',
      value:
        displayMetrics?.recall !== null && displayMetrics?.recall !== undefined
          ? formatPercentage(displayMetrics.recall)
          : 'Awaiting labels',
      note: 'Attack classification',
      tone: 'warning',
      badge: isDemo ? 'Benchmark' : undefined,
      badgeTone: isDemo ? 'benchmark' : undefined,
    },
    {
      label: 'F1 Score',
      value:
        displayMetrics?.f1 !== null && displayMetrics?.f1 !== undefined
          ? formatPercentage(displayMetrics.f1)
          : 'Awaiting labels',
      note: 'Harmonic mean',
      badge: isDemo ? 'Benchmark' : undefined,
      badgeTone: isDemo ? 'benchmark' : undefined,
    },
  ];

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

  const sampleCount = isDemo ? 100 : visiblePredictions.length;

  return (
    <div className="dashboard-page">
      <div className="dashboard-page-heading">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>ML Model Performance Monitoring Platform</h1>
          <p className="dashboard-intro">
            A high-fidelity monitoring view uniting live production inference, official NSL-KDD benchmarks, and drift lifecycle tracking.
          </p>
        </div>
        <div className="dashboard-header-controls">
          <div className="dashboard-mode-toggle" role="group" aria-label="Environment data mode">
            <button
              type="button"
              className={`btn-mode mode-production ${dataMode === 'production' ? 'active' : ''}`}
              onClick={() => setDataMode('production')}
              aria-pressed={dataMode === 'production'}
              title="Show live production data from PostgreSQL"
            >
              <span className="data-source-badge badge-production badge-sm">Live</span>
              <span>Production</span>
            </button>
            <button
              type="button"
              className={`btn-mode mode-demo ${dataMode === 'demo' ? 'active' : ''}`}
              onClick={() => setDataMode('demo')}
              aria-pressed={dataMode === 'demo'}
              title="Switch to demonstration mode with benchmark metrics and simulated drift"
            >
              <span className="data-source-badge badge-demo badge-sm">Demo</span>
              <span>Benchmark &amp; Simulation</span>
            </button>
          </div>

          <div className="dashboard-refresh-controls">
            <button
              className="btn btn-secondary dashboard-refresh"
              type="button"
              onClick={retry}
              disabled={Object.values(loading).some(Boolean) || isRefreshing}
            >
              {isRefreshing || Object.values(loading).some(Boolean) ? 'Refreshing...' : 'Refresh dashboard'}
            </button>
            <div className="dashboard-refresh-status" aria-live="polite">
              <span>Automatic refresh <strong>On · every {Math.round(refreshIntervalMs / 1000)}s</strong></span>
              <span>Last successful refresh <strong>{formatTimestamp(lastSuccessfulRefresh)}</strong></span>
            </div>
          </div>
        </div>
      </div>

      {isDemo && (
        <div className="demo-banner-alert" role="status">
          <div className="demo-banner-content">
            <span className="demo-banner-icon" aria-hidden="true">🔶</span>
            <div>
              <strong>Demonstration Environment Active:</strong> Displaying canonical NSL-KDD test holdout evaluation (22,544 rows) and simulated drift lifecycle. No production records or database tables are modified.
            </div>
          </div>
          <button className="btn btn-secondary btn-sm demo-banner-action" type="button" onClick={() => setDataMode('production')}>
            Back to Live Production
          </button>
        </div>
      )}

      {loading.metrics ? (
        <div className="dashboard-loading-bar">Loading monitoring metrics...</div>
      ) : errors.metrics ? (
        <div className="dashboard-section-error">
          <strong>Metrics unavailable.</strong>
          <span>{errors.metrics}</span>
          <button className="btn btn-secondary" type="button" onClick={retry}>
            Retry
          </button>
        </div>
      ) : (
        <section aria-label="Model performance metrics">
          <div className="section-head" style={{ marginBottom: '12px' }}>
            <div>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 600 }}>
                {isDemo ? 'Benchmark & Simulation Overview' : 'Operational Model Metrics'}
              </h3>
              <p className="page-description" style={{ fontSize: '0.825rem', margin: '2px 0 0' }}>
                {isDemo
                  ? 'Canonical NSL-KDD test holdout evaluation (22,544 samples) paired with simulated streaming telemetry.'
                  : 'Live telemetry and ground-truth evaluation computed from production inferences recorded in PostgreSQL.'}
              </p>
            </div>
          </div>
          <div className="dashboard-metrics-grid">
            {metricCards.map((metric) => (
              <MetricCard key={metric.label} {...metric} />
            ))}
          </div>
        </section>
      )}

      {/* Multi-Source Evaluation Readiness & Canonical Benchmark Arena */}
      {!isDemo && displayMetrics?.accuracy === null && (
        <div className="evaluation-readiness-arena">
          <div className="readiness-card">
            <div className="readiness-card-header">
              <h4 className="readiness-card-title">Live Evaluation Readiness</h4>
              <span className="data-source-badge badge-production">Live Production</span>
            </div>
            <div className="readiness-meter-wrap">
              <div className="readiness-meter-labels">
                <span>Verified Ground-Truth Coverage</span>
                <strong>{displayMetrics?.labeled_prediction_count || 0} / 100 verified samples</strong>
              </div>
              <div className="readiness-meter-track">
                <div
                  className="readiness-meter-fill"
                  style={{ width: `${Math.min(100, Math.max(3, ((displayMetrics?.labeled_prediction_count || 0) / 100) * 100))}%` }}
                />
              </div>
            </div>
            <p style={{ fontSize: '0.825rem', color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.45 }}>
              Live production predictions arrive unlabeled. Label incoming network flows as <strong>Normal</strong> or <strong>Attack</strong> in the Recent Predictions table below to activate live accuracy, precision, recall, and F1 calculations.
            </p>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '6px' }}>
              <a href="#recent-predictions" className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }}>
                Label recent predictions ↓
              </a>
              <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                or switch to{' '}
                <button
                  type="button"
                  onClick={() => setDataMode('demo')}
                  style={{
                    color: '#fbbf24',
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Benchmark & Demo mode
                </button>
              </span>
            </div>
          </div>

          <div className="benchmark-card">
            <div className="benchmark-card-header">
              <div>
                <h4 className="benchmark-card-title">NSL-KDD Canonical Test Benchmark</h4>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  Evaluated on full <code>KDDTest+.txt</code> holdout (22,544 rows)
                </span>
              </div>
              <span className="data-source-badge badge-benchmark">Benchmark</span>
            </div>

            <div className="benchmark-stats-grid">
              <div className="benchmark-stat-pill">
                <span>Accuracy</span>
                <strong>{formatPercentage(benchmark.test_holdout.metrics.accuracy)}</strong>
              </div>
              <div className="benchmark-stat-pill">
                <span>Precision</span>
                <strong>{formatPercentage(benchmark.test_holdout.metrics.precision)}</strong>
              </div>
              <div className="benchmark-stat-pill">
                <span>Recall</span>
                <strong>{formatPercentage(benchmark.test_holdout.metrics.recall)}</strong>
              </div>
              <div className="benchmark-stat-pill">
                <span>F1 Score</span>
                <strong>{formatPercentage(benchmark.test_holdout.metrics.f1)}</strong>
              </div>
            </div>

            <div className="provenance-citation-box">
              <strong>Benchmark Reference:</strong> Canadian Institute for Cybersecurity (CIC) / UNB.
              <em> M. Tavallaee, E. Bagheri, W. Lu, and A. Ghorbani, IEEE CISDA, 2009.</em>
              <div style={{ marginTop: '4px', fontSize: '0.74rem', opacity: 0.85 }}>
                Independent holdout contains 17 novel zero-day attack classes. Model: <code>{benchmark.model_id}</code> ({benchmark.model_type}, 41 features, ROC-AUC: {benchmark.test_holdout.metrics.roc_auc?.toFixed(3)}).
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Demo Mode Benchmark Confusion Matrix */}
      {isDemo && (
        <div className="evaluation-readiness-arena">
          <div className="benchmark-card" style={{ gridColumn: '1 / -1' }}>
            <div className="benchmark-card-header">
              <div>
                <h4 className="benchmark-card-title">Canonical NSL-KDD Test Holdout Performance</h4>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  Dataset: <code>KDDTest+.txt</code> (SHA-256: <code>fa46b093...8f84</code>) — 22,544 evaluated rows
                </span>
              </div>
              <span className="data-source-badge badge-benchmark">Official Benchmark</span>
            </div>

            <div className="benchmark-stats-grid">
              <div className="benchmark-stat-pill">
                <span>Holdout Accuracy</span>
                <strong>{formatPercentage(benchmark.test_holdout.metrics.accuracy)}</strong>
              </div>
              <div className="benchmark-stat-pill">
                <span>Holdout Precision</span>
                <strong>{formatPercentage(benchmark.test_holdout.metrics.precision)}</strong>
              </div>
              <div className="benchmark-stat-pill">
                <span>Holdout Recall</span>
                <strong>{formatPercentage(benchmark.test_holdout.metrics.recall)}</strong>
              </div>
              <div className="benchmark-stat-pill">
                <span>Holdout F1</span>
                <strong>{formatPercentage(benchmark.test_holdout.metrics.f1)}</strong>
              </div>
            </div>

            <div className="confusion-matrix-box">
              <h5>Confusion Matrix (Canonical Test Holdout — 22,544 Samples)</h5>
              <table className="cm-table">
                <thead>
                  <tr>
                    <th className="cm-header">Actual \ Predicted</th>
                    <th className="cm-header">Predicted Normal (0)</th>
                    <th className="cm-header">Predicted Attack (1)</th>
                    <th className="cm-header">Class Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th className="cm-header">Actual Normal (0)</th>
                    <td className="cm-cell-correct">
                      <strong>9,434</strong>
                      <span style={{ fontSize: '0.7rem', display: 'block' }}>True Negatives (97.1%)</span>
                    </td>
                    <td className="cm-cell-error">
                      <strong>277</strong>
                      <span style={{ fontSize: '0.7rem', display: 'block' }}>False Positives (2.9%)</span>
                    </td>
                    <td><strong>9,711</strong></td>
                  </tr>
                  <tr>
                    <th className="cm-header">Actual Attack (1)</th>
                    <td className="cm-cell-error">
                      <strong>4,337</strong>
                      <span style={{ fontSize: '0.7rem', display: 'block' }}>False Negatives (33.8%)</span>
                    </td>
                    <td className="cm-cell-correct">
                      <strong>8,496</strong>
                      <span style={{ fontSize: '0.7rem', display: 'block' }}>True Positives (66.2%)</span>
                    </td>
                    <td><strong>12,833</strong></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="provenance-citation-box">
              <strong>Evaluation Provenance & Scientific Citation:</strong>
              <em> M. Tavallaee, E. Bagheri, W. Lu, and A. Ghorbani, “A Detailed Analysis of the KDD CUP 99 Data Set,” Second IEEE Symposium on Computational Intelligence for Security and Defense Applications (CISDA), 2009.</em>
              Canadian Institute for Cybersecurity (CIC) / University of New Brunswick (UNB).
            </div>
          </div>
        </div>
      )}

      {/* Operational Distributions Arena */}
      <div className="distributions-arena">
        <div className="distribution-card">
          <div className="distribution-card-header">
            <h4 className="distribution-card-title">Inference Latency Distribution</h4>
            <span className={`data-source-badge ${isDemo ? 'badge-demo' : 'badge-production'}`}>
              {isDemo ? 'Simulation Stream' : 'Live Stream'}
            </span>
          </div>
          <div className="latency-stats-row">
            <div className="latency-stat-box">
              <span>Min</span>
              <strong>{latencyStats.min !== null ? `${latencyStats.min.toFixed(1)} ms` : '—'}</strong>
            </div>
            <div className="latency-stat-box">
              <span>Median (p50)</span>
              <strong>{latencyStats.median !== null ? `${latencyStats.median.toFixed(1)} ms` : '—'}</strong>
            </div>
            <div className="latency-stat-box">
              <span>p95 Tail</span>
              <strong>{latencyStats.p95 !== null ? `${latencyStats.p95.toFixed(1)} ms` : '—'}</strong>
            </div>
            <div className="latency-stat-box">
              <span>Max</span>
              <strong>{latencyStats.max !== null ? `${latencyStats.max.toFixed(1)} ms` : '—'}</strong>
            </div>
          </div>
          <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
            End-to-end inference execution latency measured from incoming payload parsing through XGBoost feature scoring.
          </p>
        </div>

        <div className="distribution-card">
          <div className="distribution-card-header">
            <h4 className="distribution-card-title">Predicted Traffic Class Balance</h4>
            <span className={`data-source-badge ${isDemo ? 'badge-demo' : 'badge-production'}`}>
              {isDemo ? 'Simulation Stream' : 'Live Stream'}
            </span>
          </div>
          <div className="class-split-bar">
            <div className="class-split-normal" style={{ width: `${classDist.normalPct}%` }}>
              {classDist.normalPct >= 18 ? `${classDist.normalPct}% Normal` : ''}
            </div>
            <div className="class-split-attack" style={{ width: `${classDist.attackPct}%` }}>
              {classDist.attackPct >= 18 ? `${classDist.attackPct}% Attack` : ''}
            </div>
          </div>
          <div className="class-legend-row">
            <div className="class-legend-item">
              <span className="class-legend-dot normal" />
              <span>Normal (Class 0): {classDist.normalCount} flows ({classDist.normalPct}%)</span>
            </div>
            <div className="class-legend-item">
              <span className="class-legend-dot attack" />
              <span>Attack (Class 1): {classDist.attackCount} flows ({classDist.attackPct}%)</span>
            </div>
          </div>
          <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
            Ratio of benign network traffic flows to detected attack classifications across observed prediction traffic.
          </p>
        </div>
      </div>

      <div className="dashboard-primary-grid">
        <DriftPanel
          history={displayDriftHistory}
          sampleCount={sampleCount}
          loading={loading.drift}
          error={errors.drift}
          badge={isDemo ? 'Simulated PSI' : 'Production PSI'}
          badgeTone={isDemo ? 'demo' : 'production'}
          onRetry={retry}
        />
        <SectionCard
          title="Current model"
          eyebrow="Serving metadata"
          badge={isDemo ? 'Demo Configuration' : 'Production Container'}
          badgeTone={isDemo ? 'demo' : 'production'}
          className="model-summary-section"
        >
          <SectionState loading={loading.models} error={errors.models} onRetry={retry}>
            <div className="model-summary-list">
              <div>
                <span>Model ID</span>
                <strong>{activeModel?.model_id || metrics?.model_id || 'nsl-kdd-baseline'}</strong>
              </div>
              <div>
                <span>Model version</span>
                <strong>{activeModel?.model_version || metrics?.model_version || 'nsl-kdd-validation-20260928'}</strong>
              </div>
              <div>
                <span>Algorithm</span>
                <strong>XGBoost Binary Classifier</strong>
              </div>
              <div>
                <span>Feature Schema</span>
                <strong>41 network traffic features</strong>
              </div>
              <div>
                <span>Service status</span>
                <StatusBadge tone={activeModel || isDemo ? 'success' : 'neutral'}>
                  {activeModel || isDemo ? 'Active' : EMPTY_VALUE}
                </StatusBadge>
              </div>
            </div>
          </SectionState>
        </SectionCard>
      </div>

      <div className="dashboard-section-stack">
        <AlertsPanel
          rows={displayAlerts}
          loading={loading.alerts}
          error={errors.alerts}
          badge={isDemo ? 'Simulated Alert' : 'Production Alerts'}
          badgeTone={isDemo ? 'demo' : 'production'}
          onRetry={retry}
        />
        <ModelsPanel
          rows={models}
          activeModel={activeModel}
          loading={loading.models}
          error={errors.models}
          badge="Registry"
          badgeTone="production"
          onRetry={retry}
        />
        <RetrainingPanel
          rows={displayRetraining}
          loading={loading.retraining}
          error={errors.retraining}
          badge={isDemo ? 'Simulated Lifecycle' : 'Production Queue'}
          badgeTone={isDemo ? 'demo' : 'production'}
          onRetry={retry}
        />
        <PredictionsPanel
          rows={displayPredictions}
          loading={loading.predictions}
          error={errors.predictions}
          badge={isDemo ? 'Synthetic Demo' : 'Production Inferences'}
          badgeTone={isDemo ? 'demo' : 'production'}
          isDemo={isDemo}
          onRetry={retry}
          onLabelPrediction={isDemo ? undefined : handleLabelPrediction}
          updatingPredictionId={updatingPredictionId}
        />
      </div>
    </div>
  );
}
