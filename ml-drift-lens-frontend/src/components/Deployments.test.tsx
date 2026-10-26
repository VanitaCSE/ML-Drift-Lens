import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { Deployments } from './Deployments';
import { apiClient } from '../services/apiClient';

vi.mock('../services/apiClient', () => ({
  apiClient: {
    getHealth: vi.fn(),
    getReadiness: vi.fn(),
    getModelInfo: vi.fn(),
    getDeploymentStatus: vi.fn(),
    getPredictionHistory: vi.fn(),
    getAlerts: vi.fn(),
    getDriftHistory: vi.fn(),
  },
}));

describe('Deployments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.getPredictionHistory).mockResolvedValue([]);
    vi.mocked(apiClient.getAlerts).mockResolvedValue([]);
    vi.mocked(apiClient.getDriftHistory).mockResolvedValue([]);
  });

  it('renders current serving deployment and telemetry without cloud prerequisites or redeployment blocks', async () => {
    vi.mocked(apiClient.getHealth).mockResolvedValue({
      status: 'healthy',
      healthy: true,
      service: 'modelwatch-backend',
    });
    vi.mocked(apiClient.getReadiness).mockResolvedValue({
      ready: true,
      model_loaded: true,
      message: 'Model is ready',
    });
    vi.mocked(apiClient.getModelInfo).mockResolvedValue({
      model_version: 'candidate-20261009T061233Z-7e4ec984',
      model_type: 'xgboost',
      num_features: 41,
      preprocessing_version: 'preprocessing-v1',
      training_timestamp: '2026-10-09',
    });
    vi.mocked(apiClient.getDeploymentStatus).mockResolvedValue({
      success: true,
      environment: 'Local Development (127.0.0.1)',
      inference_routing: 'Backend Proxy to FastAPI (port 28000)',
      artifact_integrity: 'Verified SHA-256 Manifest v1',
      all_passed: false,
      can_redeploy: false,
      redeployment_block_reason: 'Automated cloud redeployment is permanently disabled.',
      prerequisites: {},
    });

    render(<Deployments />);

    await waitFor(() => {
      expect(screen.getByText('Current Serving Deployment')).toBeTruthy();
      expect(screen.getByText('candidate-20261009T061233Z-7e4ec984')).toBeTruthy();
      expect(screen.getByText('Loaded & Ready')).toBeTruthy();
      expect(screen.getByText('Operational Threat & Model Attention Telemetry')).toBeTruthy();
      expect(screen.getByText('Nominal · No Action Required')).toBeTruthy();
    });

    // Verify Cloud & Staging Integration Prerequisites section and cards are completely removed
    expect(screen.queryByText('Cloud & Staging Integration Prerequisites')).toBeNull();
    expect(screen.queryByText('Render Staging Client')).toBeNull();
    expect(screen.queryByText('Remote Durable Store')).toBeNull();
    expect(screen.queryByText('Independent Live Verifier')).toBeNull();
    expect(screen.queryByText('Operator Authorization')).toBeNull();

    // Verify Staging Redeployment Control and Deployment Architecture Note are removed
    expect(screen.queryByText('Staging Redeployment Control')).toBeNull();
    expect(screen.queryByRole('button', { name: /Redeploy to Staging/i })).toBeNull();
    expect(screen.queryByText(/Candidate Promotion vs\. Cloud Redeployment/i)).toBeNull();
    expect(screen.queryByText(/Deployment Architecture Note:/i)).toBeNull();
  });

  it('renders backend-derived environment and routing status dynamically', async () => {
    vi.mocked(apiClient.getHealth).mockResolvedValue({
      status: 'healthy',
      healthy: true,
      service: 'modelwatch-backend',
    });
    vi.mocked(apiClient.getReadiness).mockResolvedValue({
      ready: true,
      model_loaded: true,
      message: 'Model is ready',
    });
    vi.mocked(apiClient.getModelInfo).mockResolvedValue({
      model_version: 'candidate-20261009T061233Z-7e4ec984',
      model_type: 'xgboost',
      num_features: 41,
      preprocessing_version: 'preprocessing-v1',
      training_timestamp: '2026-10-09',
    });
    vi.mocked(apiClient.getDeploymentStatus).mockResolvedValue({
      success: true,
      environment: 'Render Staging',
      inference_routing: 'Backend Proxy to inference.internal:8000',
      artifact_integrity: 'Verified SHA-256 Manifest v1',
      all_passed: false,
      can_redeploy: false,
      redeployment_block_reason: 'Automated cloud redeployment is permanently disabled.',
      prerequisites: {},
    });

    render(<Deployments />);

    await waitFor(() => {
      expect(screen.getByText('Render Staging')).toBeTruthy();
      expect(screen.getByText('Backend Proxy to inference.internal:8000')).toBeTruthy();
    });

    expect(screen.queryByText('Cloud & Staging Integration Prerequisites')).toBeNull();
    expect(screen.queryByText('Staging Redeployment Control')).toBeNull();
  });

  it('displays attention recommended status with probabilistic inference disclaimer when attacks are detected', async () => {
    vi.mocked(apiClient.getHealth).mockResolvedValue({
      status: 'healthy',
      healthy: true,
      service: 'modelwatch-backend',
    });
    vi.mocked(apiClient.getReadiness).mockResolvedValue({
      ready: true,
      model_loaded: true,
      message: 'Model is ready',
    });
    vi.mocked(apiClient.getModelInfo).mockResolvedValue({
      model_version: 'nsl-kdd-validation-20260928',
      model_type: 'xgboost',
      num_features: 41,
      preprocessing_version: 'preprocessing-v1',
      training_timestamp: '2026-09-28',
    });
    vi.mocked(apiClient.getDeploymentStatus).mockResolvedValue({
      success: true,
      environment: 'Local Development (127.0.0.1)',
      inference_routing: 'Backend Proxy to FastAPI (port 28000)',
      artifact_integrity: 'Verified SHA-256 Manifest v1',
      all_passed: false,
      can_redeploy: false,
      redeployment_block_reason: 'Automated cloud redeployment is permanently disabled.',
      prerequisites: {},
    });
    vi.mocked(apiClient.getPredictionHistory).mockResolvedValue([
      {
        id: 1,
        model_id: 'nsl-kdd-baseline',
        model_version: 'nsl-kdd-validation-20260928',
        preprocessing_version: 'preprocessing-v1',
        input_features: '{}',
        prediction: 'attack',
        prediction_class: 1,
        confidence: 0.985,
        request_id: 'req-atk-1',
        timestamp: '2026-10-26T12:00:00Z',
      },
    ]);
    vi.mocked(apiClient.getAlerts).mockResolvedValue([
      {
        id: 10,
        model_id: 'nsl-kdd-baseline',
        message: 'Elevated attack probability',
        status: 'active',
        timestamp: '2026-10-26T12:00:00Z',
        drift_score_id: 1,
      },
    ]);

    render(<Deployments />);

    await waitFor(() => {
      expect(screen.getByText('Attention Recommended · Potential Threat Detected')).toBeTruthy();
      expect(screen.getByText('1 flows (Probabilistic Inference)')).toBeTruthy();
      expect(screen.getByText(/model classification is a probabilistic inference/i)).toBeTruthy();
    });

    expect(screen.queryByText('Cloud & Staging Integration Prerequisites')).toBeNull();
    expect(screen.queryByText('Staging Redeployment Control')).toBeNull();
  });

  it('handles backend failure gracefully and provides retry', async () => {
    vi.mocked(apiClient.getHealth).mockRejectedValueOnce(new Error('Connection error'));

    render(<Deployments />);

    await waitFor(() => {
      expect(screen.getByText('Deployment status is unavailable.')).toBeTruthy();
    });

    vi.mocked(apiClient.getHealth).mockResolvedValueOnce({
      status: 'healthy',
      healthy: true,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Retry status' }));

    await waitFor(() => {
      expect(apiClient.getHealth).toHaveBeenCalledTimes(2);
    });
  });
});
