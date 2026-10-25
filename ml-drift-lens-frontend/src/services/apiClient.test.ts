import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiClient } from '../services/apiClient';

// Mock fetch
global.fetch = vi.fn();

describe('API Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiClient.setCsrfToken(null);
    apiClient.setAuthenticationFailureHandler(null);
  });

  it('should fetch model info successfully', async () => {
    const mockData = {
      model_version: '0.1.0',
      preprocessing_version: '0.1.0',
      model_type: 'xgboost',
      num_features: 41,
      training_timestamp: '2025-01-01T00:00:00Z',
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    });

    const result = await apiClient.getModelInfo();
    expect(result).toEqual(mockData);
    expect(global.fetch).toHaveBeenCalledWith('/api/model-info', expect.objectContaining({
      credentials: 'include',
    }));
  });

  it('should fetch health status', async () => {
    const mockData = {
      status: 'healthy',
      message: 'Service is running',
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    });

    const result = await apiClient.getHealth();
    expect(result).toEqual(mockData);
  });

  it('should fetch readiness status', async () => {
    const mockData = {
      ready: true,
      model_loaded: true,
      message: 'Service is ready',
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    });

    const result = await apiClient.getReadiness();
    expect(result).toEqual(mockData);
  });

  it('should make a prediction', async () => {
    const mockData = {
      success: true,
      prediction: 'normal',
      prediction_class: 0,
      confidence: 0.87,
      model_id: 'test-model',
      model_version: '0.1.0',
      preprocessing_version: '0.1.0',
      request_id: 'req-123',
      stored_id: 1,
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    });

    const result = await apiClient.predict({
      model_id: 'test-model',
      model_version: '0.1.0',
      preprocessing_version: '0.1.0',
      input_features: { duration: 100 },
    });

    expect(result).toEqual(mockData);
    expect(global.fetch).toHaveBeenCalledWith('/api/predictions', expect.objectContaining({
      credentials: 'include',
    }));
  });

  it('restores a session and submits auth credentials only to the backend', async () => {
    const session = {
      authenticated: true,
      user: { id: '1', email: 'user@example.test' },
      csrfToken: 'csrf-token',
    };
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => session,
    });
    expect(await apiClient.getCurrentSession()).toEqual(session);

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, user: session.user }),
    });
    await apiClient.login('user@example.test', 'test-password');
    expect(global.fetch).toHaveBeenLastCalledWith('/api/auth/login', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ email: 'user@example.test', password: 'test-password' }),
    }));
  });

  it('sends the restored CSRF token with protected prediction writes', async () => {
    apiClient.setCsrfToken('session-csrf-token');
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    await apiClient.predict({
      model_id: 'test-model',
      model_version: '0.1.0',
      preprocessing_version: '0.1.0',
      input_features: { duration: 100 },
    });
    const [, options] = (global.fetch as any).mock.calls.at(-1);
    expect(options.credentials).toBe('include');
    expect(new Headers(options.headers).get('X-CSRF-Token')).toBe('session-csrf-token');
  });

  it('should fetch prediction history', async () => {
    const mockData = [
      {
        id: 1,
        model_id: 'test',
        model_version: '0.1.0',
        preprocessing_version: '0.1.0',
        input_features: '{}',
        prediction: 'normal',
        prediction_class: 0,
        confidence: 0.85,
        request_id: 'req-1',
        timestamp: '2025-01-01T00:00:00Z',
      },
    ];

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    });

    const result = await apiClient.getPredictionHistory();
    expect(result).toEqual(mockData);
  });

  it('should handle API errors', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      statusText: 'Not Found',
    });

    await expect(apiClient.getModelInfo()).rejects.toThrow();
  });

  it('should preserve backend prediction validation details', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      statusText: 'Bad Request',
      json: async () => ({
        error: 'Invalid prediction request',
        details: "Prediction failed: Unknown category for feature 'service': private",
      }),
    });

    await expect(apiClient.predict({
      model_id: 'test-model',
      model_version: '0.1.0',
      preprocessing_version: 'preprocessing-v1',
      input_features: { service: 'private' },
    })).rejects.toThrow("Invalid prediction request: Prediction failed: Unknown category for feature 'service': private");
  });

  it('submits password reset and email verification requests', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, message: 'Reset sent' }),
    });
    const forgotRes = await apiClient.requestPasswordReset('user@example.com');
    expect(forgotRes.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith('/api/auth/forgot-password', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'user@example.com' }),
    }));

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, message: 'Password reset' }),
    });
    const resetRes = await apiClient.resetPassword('token-123', 'new-password-123');
    expect(resetRes.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith('/api/auth/reset-password', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ token: 'token-123', password: 'new-password-123' }),
    }));

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, message: 'Email verified' }),
    });
    const verifyRes = await apiClient.verifyEmail('token-123');
    expect(verifyRes.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith('/api/auth/verify-email', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ token: 'token-123' }),
    }));

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, message: 'Verification resent' }),
    });
    const resendRes = await apiClient.resendVerification('user@example.com');
    expect(resendRes.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith('/api/auth/resend-verification', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'user@example.com' }),
    }));
  });
});
