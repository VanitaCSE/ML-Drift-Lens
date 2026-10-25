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
  },
}));

describe('Deployments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders current serving deployment and honest unconfigured cloud status', async () => {
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
      redeployment_block_reason: 'Automated cloud redeployment is permanently disabled until all required cloud infrastructure prerequisites are fulfilled.',
      prerequisites: {
        render_staging_client: {
          key: 'render_staging_client',
          label: 'Render Staging Client',
          status: 'unconfigured',
          badge: 'Unconfigured (Disabled)',
          reason: 'Missing RENDER_API_KEY, RENDER_STAGING_SERVICE_ID, or RENDER_TARGET_ENVIRONMENT is not set to staging.',
        },
        remote_durable_store: {
          key: 'remote_durable_store',
          label: 'Remote Durable Store',
          status: 'unconfigured',
          badge: 'Unconfigured (Local Filesystem Only)',
          reason: 'No remote durable object storage provider (e.g. S3, Cloudflare R2, GCS) configured.',
        },
        independent_live_verifier: {
          key: 'independent_live_verifier',
          label: 'Independent Live Verifier',
          status: 'unconfigured',
          badge: 'Unconfigured (Local Probes Only)',
          reason: 'No independent post-deployment verification probe configured.',
        },
        operator_authorization: {
          key: 'operator_authorization',
          label: 'Operator Authorization',
          status: 'blocked',
          badge: 'Policy Blocked (403)',
          reason: 'Operator authorization policy is unconfigured.',
        },
      },
    });

    render(<Deployments />);

    await waitFor(() => {
      expect(screen.getByText('Current Serving Deployment')).toBeTruthy();
      expect(screen.getByText('candidate-20261009T061233Z-7e4ec984')).toBeTruthy();
      expect(screen.getByText('Loaded & Ready')).toBeTruthy();
      expect(screen.getByText('Unconfigured (Disabled)')).toBeTruthy();
    });

    const redeployBtn = screen.getByRole('button', { name: /Redeploy to Staging \(Disabled\)/i });
    expect(redeployBtn.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/permanently disabled/i)).toBeTruthy();
  });

  it('renders backend-derived configured_unverified status dynamically', async () => {
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
      redeployment_block_reason: 'Automated cloud redeployment is permanently disabled until all required cloud infrastructure prerequisites are fulfilled.',
      prerequisites: {
        render_staging_client: {
          key: 'render_staging_client',
          label: 'Render Staging Client',
          status: 'configured_unverified',
          badge: 'Configured (Unverified)',
          reason: 'Render staging credentials present in environment but connection has not been verified against the Render API.',
        },
        remote_durable_store: {
          key: 'remote_durable_store',
          label: 'Remote Durable Store',
          status: 'unconfigured',
          badge: 'Unconfigured (Local Filesystem Only)',
          reason: 'No remote durable object storage provider configured.',
        },
        independent_live_verifier: {
          key: 'independent_live_verifier',
          label: 'Independent Live Verifier',
          status: 'unconfigured',
          badge: 'Unconfigured (Local Probes Only)',
          reason: 'No independent post-deployment verifier configured.',
        },
        operator_authorization: {
          key: 'operator_authorization',
          label: 'Operator Authorization',
          status: 'blocked',
          badge: 'Policy Blocked (403)',
          reason: 'Operator authorization policy is unconfigured.',
        },
      },
    });

    render(<Deployments />);

    await waitFor(() => {
      expect(screen.getByText('Configured (Unverified)')).toBeTruthy();
      expect(screen.getByText('Render Staging')).toBeTruthy();
      expect(screen.getByText('Backend Proxy to inference.internal:8000')).toBeTruthy();
    });
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
