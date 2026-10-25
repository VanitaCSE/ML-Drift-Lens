import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SystemStatus } from './SystemStatus';
import { apiClient } from '../services/apiClient';

vi.mock('../services/apiClient', () => ({
  apiClient: {
    getHealth: vi.fn(),
    getReadiness: vi.fn(),
    getModelInfo: vi.fn(),
  },
}));

describe('SystemStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all services healthy when backend and ML service are operational', async () => {
    vi.mocked(apiClient.getHealth).mockResolvedValue({
      status: 'healthy',
      healthy: true,
      service: 'modelwatch-backend',
      database_connected: true,
      ml_service_healthy: true,
      message: 'Backend dependencies are healthy',
    });
    vi.mocked(apiClient.getReadiness).mockResolvedValue({
      ready: true,
      model_loaded: true,
      message: 'Model is ready for inference',
    });
    vi.mocked(apiClient.getModelInfo).mockResolvedValue({
      model_id: 'test-model',
      model_version: 'candidate-1.0.0',
      preprocessing_version: 'prep-1.0.0',
      model_type: 'xgboost',
      num_features: 41,
      training_timestamp: '2026-10-25T00:00:00Z',
    });

    render(<SystemStatus />);

    await waitFor(() => {
      expect(screen.getByText('Healthy')).toBeTruthy();
      expect(screen.getByText('Connected')).toBeTruthy();
      expect(screen.getByText('Ready')).toBeTruthy();
      expect(screen.getByText('Loaded')).toBeTruthy();
    });

    expect(screen.getByText('candidate-1.0.0')).toBeTruthy();
    expect(screen.getByText('XGBOOST')).toBeTruthy();
  });

  it('truthfully reports disconnected database when database health check fails', async () => {
    vi.mocked(apiClient.getHealth).mockResolvedValue({
      status: 'unhealthy',
      healthy: false,
      database_connected: false,
      ml_service_healthy: true,
      message: 'Database connection failed',
    });
    vi.mocked(apiClient.getReadiness).mockResolvedValue({
      ready: true,
      model_loaded: true,
      message: 'Model is ready',
    });
    vi.mocked(apiClient.getModelInfo).mockResolvedValue({
      model_version: '1.0.0',
      model_type: 'xgboost',
      preprocessing_version: '1.0.0',
      num_features: 41,
      training_timestamp: '2026-10-25T00:00:00Z',
    });

    render(<SystemStatus />);

    await waitFor(() => {
      expect(screen.getByText('Disconnected')).toBeTruthy();
      expect(screen.getByText('Degraded')).toBeTruthy();
    });
  });

  it('handles backend network failures gracefully', async () => {
    vi.mocked(apiClient.getHealth).mockRejectedValue(new Error('Connection refused'));
    vi.mocked(apiClient.getReadiness).mockRejectedValue(new Error('Network error'));
    vi.mocked(apiClient.getModelInfo).mockRejectedValue(new Error('Network error'));

    render(<SystemStatus />);

    await waitFor(() => {
      const unavailables = screen.getAllByText('Unavailable');
      expect(unavailables.length).toBeGreaterThan(0);
      expect(screen.getByText(/Connection refused/)).toBeTruthy();
    });
  });

  it('triggers a fresh status check when clicking Refresh', async () => {
    vi.mocked(apiClient.getHealth).mockResolvedValue({
      status: 'healthy',
      healthy: true,
      database_connected: true,
      ml_service_healthy: true,
    });
    vi.mocked(apiClient.getReadiness).mockResolvedValue({
      ready: true,
      model_loaded: true,
      message: 'Ready',
    });
    vi.mocked(apiClient.getModelInfo).mockResolvedValue({
      model_version: '1.0.0',
      model_type: 'xgboost',
      preprocessing_version: '1.0.0',
      num_features: 41,
      training_timestamp: '2026-10-25T00:00:00Z',
    });

    render(<SystemStatus />);

    await waitFor(() => {
      expect(screen.getByText('Healthy')).toBeTruthy();
    });

    expect(apiClient.getHealth).toHaveBeenCalledTimes(1);

    const refreshButton = screen.getByRole('button', { name: 'Refresh' });
    fireEvent.click(refreshButton);

    await waitFor(() => {
      expect(apiClient.getHealth).toHaveBeenCalledTimes(2);
    });
  });
});
