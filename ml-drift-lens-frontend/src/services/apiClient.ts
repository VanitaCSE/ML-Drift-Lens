import { CANONICAL_BENCHMARK_DATA, DEFAULT_DEMO_SCENARIO } from './benchmarkData';

/**
 * API Client for Network Intrusion Detection Backend
 * Communicates with Node.js backend at /api/*
 * 
 * In development, Vite proxy forwards /api to http://localhost:3000
 * In production, /api resolves to the same origin or configured backend URL
 */

// Use relative paths in development (benefits from Vite proxy)
// Use absolute URL only if explicitly configured
const API_BASE = import.meta.env.VITE_API_URL 
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

interface PredictionRequest {
  model_id: string;
  model_version: string;
  preprocessing_version: string;
  input_features: Record<string, number | string>;
  request_id?: string;
}

interface PredictionResponse {
  success: boolean;
  prediction: string;
  prediction_class: number;
  confidence: number;
  inference_latency_ms: number;
  model_id: string;
  model_version: string;
  preprocessing_version: string;
  request_id: string;
  stored_id: number;
}

export interface ModelInfo {
  model_id?: string;
  model_name?: string;
  model_version: string;
  preprocessing_version: string;
  model_type: string;
  dataset?: string;
  feature_count?: number;
  num_features: number;
  training_timestamp: string;
  validation_metrics?: Record<string, number | number[] | Record<string, number>>;
  test_metrics?: Record<string, number | number[] | Record<string, number>>;
  metrics?: Record<string, number | number[] | Record<string, number>>;
}

export interface HealthStatus {
  service?: string;
  status?: string;
  message?: string;
  healthy?: boolean;
  database_connected?: boolean;
  ml_service_healthy?: boolean;
}

export interface DeploymentPrerequisite {
  key: string;
  label: string;
  status: 'unconfigured' | 'configured_unverified' | 'verified' | 'failed' | 'blocked';
  badge: string;
  reason: string;
}

export interface DeploymentStatusResponse {
  success: boolean;
  environment: string;
  inference_routing: string;
  artifact_integrity: string;
  all_passed: boolean;
  can_redeploy: boolean;
  redeployment_block_reason: string;
  prerequisites: Record<string, DeploymentPrerequisite>;
}

export interface ReadinessStatus {
  ready: boolean;
  model_loaded: boolean;
  message: string;
}

export interface PredictionHistoryItem {
  id: number;
  model_id: string;
  model_version: string;
  preprocessing_version: string;
  input_features: string;
  prediction: string;
  prediction_class: number;
  confidence: number;
  inference_latency_ms?: number | null;
  request_id: string;
  timestamp: string;
  actual_label?: string;
}

export interface MonitoringMetrics {
  total_prediction_count: number;
  labeled_prediction_count: number;
  accuracy: number | null;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  metrics_status: string;
  model_id: string | null;
  model_version: string | null;
  latest_prediction_timestamp: string | null;
}

export interface DriftScore {
  id: number;
  model_id: string;
  metric_type: string;
  score: number;
  threshold: number;
  status: string;
  timestamp: string;
}

export interface AlertRecord {
  id: number;
  model_id: string;
  message: string;
  status: string;
  timestamp: string;
  drift_score_id: number;
}

export interface ModelVersionRecord {
  id: number;
  model_id: string;
  model_version: string;
  mlflow_run_id: string | null;
  timestamp: string;
  accuracy: number | null;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  is_active: boolean;
}

export interface RetrainingJobRecord {
  id: number;
  model_id: string;
  triggered_by: string;
  trigger_reason?: string | null;
  status?: string;
  start_time: string;
  end_time: string | null;
  updated_at?: string;
  old_model_version: string | null;
  new_model_version: string | null;
  promoted: boolean;
  attempt_count?: number;
  min_samples?: number;
  sample_count?: number | null;
  evaluation_sample_count?: number | null;
  error_message?: string | null;
  candidate_metrics?: Record<string, unknown> | null;
  reload_status: string | null;
  candidate_f1?: number | null;
  incumbent_f1?: number | null;
  candidate_precision?: number | null;
  candidate_recall?: number | null;
  promotion_reason?: string | null;
}

export interface BenchmarkMetrics {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  roc_auc?: number;
}

export interface ConfusionMatrix {
  true_negatives: number;
  false_positives: number;
  false_negatives: number;
  true_positives: number;
}

export interface BenchmarkEvaluationSplit {
  dataset_file: string;
  sha256: string;
  total_samples: number;
  class_distribution: {
    normal: number;
    attack: number;
    normal_pct: number;
    attack_pct: number;
  };
  metrics: BenchmarkMetrics;
  confusion_matrix: ConfusionMatrix;
  evaluation_notes: string;
}

export interface BenchmarkData {
  benchmark_name: string;
  dataset_source: string;
  dataset_url: string;
  citation: string;
  model_id: string;
  model_version: string;
  model_type: string;
  feature_count: number;
  mlflow_run_id: string;
  training_timestamp: string;
  test_holdout: BenchmarkEvaluationSplit;
  validation_split: BenchmarkEvaluationSplit;
  drift_baseline: {
    metric: string;
    threshold: number;
    warning_threshold: number;
    minimum_samples: number;
    reference_dataset: string;
    reference_sample_count: number;
    monitored_features: string[];
  };
}

export interface DemoScenarioData {
  is_simulation: true;
  data_source: 'demo_simulation';
  scenario_name: string;
  description: string;
  notice: string;
  metrics: MonitoringMetrics;
  drift_history: DriftScore[];
  alerts: AlertRecord[];
  retraining_jobs: RetrainingJobRecord[];
  latency_distribution: {
    min_ms: number;
    median_ms: number;
    p95_ms: number;
    p99_ms: number;
    max_ms: number;
  };
  class_distribution: {
    total: number;
    normal_count: number;
    normal_pct: number;
    attack_count: number;
    attack_pct: number;
  };
}

export interface PaginationOptions {
  limit?: number;
  offset?: number;
}

export interface AuthUser {
  id: string;
  email: string;
  email_verified?: boolean;
}

export type CurrentSession =
  | { authenticated: false; user: null }
  | { authenticated: true; user: AuthUser; csrfToken: string; email_verified?: boolean };

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

let csrfToken: string | null = null;
let authenticationFailureHandler: (() => void) | null = null;

async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const method = (init.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) {
    headers.set('X-CSRF-Token', csrfToken);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });
  if (response.status === 401 && !path.startsWith('/auth/')) {
    authenticationFailureHandler?.();
  }
  return response;
}

async function responseError(response: Response, fallback: string) {
  const body = await response.json().catch(() => undefined) as {
    error?: string;
    details?: string;
    message?: string;
    code?: string;
  } | undefined;
  const message = body?.details
    ? `${body.error || fallback}: ${body.details}`
    : (body?.error || body?.message || `${fallback}: ${response.statusText}`);
  return new ApiError(
    message,
    response.status,
    body?.code,
  );
}

async function getJson<T>(path: string): Promise<T> {
  const response = await apiFetch(path);
  if (!response.ok) {
    throw await responseError(response, `Failed to fetch ${path}`);
  }
  return response.json();
}

export const apiClient = {
  setCsrfToken(token: string | null) {
    csrfToken = token;
  },

  setAuthenticationFailureHandler(handler: (() => void) | null) {
    authenticationFailureHandler = handler;
  },

  async getCurrentSession(): Promise<CurrentSession> {
    return getJson<CurrentSession>('/auth/me');
  },

  async login(email: string, password: string): Promise<AuthUser> {
    const response = await apiFetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) throw await responseError(response, 'Login failed');
    const result = await response.json() as { user: AuthUser };
    return result.user;
  },

  async register(email: string, password: string): Promise<AuthUser> {
    const response = await apiFetch('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) throw await responseError(response, 'Registration failed');
    const result = await response.json() as { user: AuthUser };
    return result.user;
  },

  async requestPasswordReset(email: string): Promise<{ success: boolean; message: string }> {
    const response = await apiFetch('/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (!response.ok) throw await responseError(response, 'Password recovery request failed');
    return response.json() as Promise<{ success: boolean; message: string }>;
  },

  async resetPassword(token: string, password: string): Promise<{ success: boolean; message: string }> {
    const response = await apiFetch('/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });
    if (!response.ok) throw await responseError(response, 'Password reset failed');
    return response.json() as Promise<{ success: boolean; message: string }>;
  },

  async verifyEmail(token: string): Promise<{ success: boolean; message: string }> {
    const response = await apiFetch('/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!response.ok) throw await responseError(response, 'Email verification failed');
    return response.json() as Promise<{ success: boolean; message: string }>;
  },

  async resendVerification(email: string): Promise<{ success: boolean; message: string }> {
    const response = await apiFetch('/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (!response.ok) throw await responseError(response, 'Resend verification failed');
    return response.json() as Promise<{ success: boolean; message: string }>;
  },

  async logout(): Promise<void> {
    const response = await apiFetch('/auth/logout', { method: 'POST' });
    if (!response.ok) throw await responseError(response, 'Logout failed');
  },

  /**
   * Get model information
   */
  async getModelInfo(): Promise<ModelInfo> {
    const response = await apiFetch('/model-info');
    if (!response.ok) {
      throw await responseError(response, 'Failed to fetch model info');
    }
    const data = await response.json();
    // Extract model from response wrapper
    return data.model || data;
  },

  /**
   * Check health status
   */
  async getHealth(): Promise<HealthStatus> {
    const response = await apiFetch('/health');
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      if (data && typeof data === 'object' && ('database_connected' in data || 'status' in data || 'ml_service_healthy' in data)) {
        return data as HealthStatus;
      }
      throw await responseError(response, 'Health check failed');
    }
    return response.json();
  },

  /**
   * Check readiness status
   */
  async getDeploymentStatus(): Promise<DeploymentStatusResponse> {
    return getJson<DeploymentStatusResponse>('/deployments/status');
  },

  async getReadiness(): Promise<ReadinessStatus> {
    const response = await apiFetch('/ready');
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      if (data && typeof data === 'object' && ('ready' in data || 'model_loaded' in data)) {
        return data as ReadinessStatus;
      }
      throw await responseError(response, 'Readiness check failed');
    }
    return response.json();
  },

  /**
   * Submit a prediction request
   */
  async predict(request: PredictionRequest): Promise<PredictionResponse> {
    const response = await apiFetch('/predictions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.error || `Prediction failed: ${response.statusText}`;
      throw new Error(errorData.details ? `${errorMessage}: ${errorData.details}` : errorMessage);
    }

    return response.json();
  },

  /**
   * Get prediction history
   */
  async getPredictionHistory(options: PaginationOptions = {}): Promise<PredictionHistoryItem[]> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.offset !== undefined) params.set('offset', String(options.offset));
    const query = params.toString();
    return getJson<PredictionHistoryItem[]>(`/predictions${query ? `?${query}` : ''}`);
  },

  /**
   * Submit an analyst verified ground-truth label for a prediction
   */
  async labelPrediction(id: number, actualLabel: 'normal' | 'attack'): Promise<PredictionHistoryItem> {
    const response = await apiFetch(`/predictions/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ actual_label: actualLabel }),
    });
    if (!response.ok) {
      throw await responseError(response, 'Failed to update prediction label');
    }
    return response.json();
  },

  async getMetrics(): Promise<MonitoringMetrics> {
    return getJson<MonitoringMetrics>('/metrics');
  },

  async getLatestDrift(): Promise<DriftScore | null> {
    return getJson<DriftScore | null>('/drift');
  },

  async getDriftHistory(options: PaginationOptions = {}): Promise<DriftScore[]> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.offset !== undefined) params.set('offset', String(options.offset));
    const query = params.toString();
    return getJson<DriftScore[]>(`/drift/history${query ? `?${query}` : ''}`);
  },

  async getAlerts(options: PaginationOptions = {}): Promise<AlertRecord[]> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.offset !== undefined) params.set('offset', String(options.offset));
    const query = params.toString();
    return getJson<AlertRecord[]>(`/alerts${query ? `?${query}` : ''}`);
  },

  async getModels(): Promise<ModelVersionRecord[]> {
    return getJson<ModelVersionRecord[]>('/models');
  },

  async getRetrainingJobs(): Promise<RetrainingJobRecord[]> {
    return getJson<RetrainingJobRecord[]>('/retraining');
  },

  async getRetrainingJob(jobId: number): Promise<RetrainingJobRecord> {
    return getJson<RetrainingJobRecord>(`/retraining/${encodeURIComponent(jobId)}`);
  },

  async getBenchmarkData(): Promise<BenchmarkData> {
    try {
      const res = await getJson<{ success: boolean; benchmark: BenchmarkData }>('/benchmark');
      return res.benchmark || CANONICAL_BENCHMARK_DATA;
    } catch {
      return CANONICAL_BENCHMARK_DATA;
    }
  },

  async getDemoScenario(): Promise<DemoScenarioData> {
    try {
      const res = await getJson<{ success: boolean; scenario: DemoScenarioData }>('/benchmark/demo');
      return res.scenario || DEFAULT_DEMO_SCENARIO;
    } catch {
      return DEFAULT_DEMO_SCENARIO;
    }
  },
};
