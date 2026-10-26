import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PredictionHistory } from './PredictionHistory';
import { apiClient } from '../services/apiClient';

vi.mock('../services/apiClient', () => ({
  apiClient: {
    getPredictionHistory: vi.fn(),
  },
}));

describe('PredictionHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('announces an empty history distinctly from an unavailable request', async () => {
    vi.mocked(apiClient.getPredictionHistory).mockResolvedValueOnce([]);

    render(<PredictionHistory />);

    expect(await screen.findByText('No predictions yet.')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('No predictions yet.');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('provides a retry action after a history request fails', async () => {
    vi.mocked(apiClient.getPredictionHistory)
      .mockRejectedValueOnce(new Error('Backend unavailable'))
      .mockResolvedValueOnce([]);

    render(<PredictionHistory />);

    expect((await screen.findByRole('alert')).textContent).toContain('Backend unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry prediction history' }));

    expect(await screen.findByText('No predictions yet.')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('No predictions yet.');
    expect(apiClient.getPredictionHistory).toHaveBeenCalledTimes(2);
  });
  it('allows an analyst to submit ground-truth labels for unlabeled predictions', async () => {
    vi.mocked(apiClient.getPredictionHistory).mockResolvedValueOnce([
      {
        id: 42,
        model_id: 'nsl-kdd-baseline',
        model_version: 'v1.0',
        preprocessing_version: 'v1.0',
        input_features: '{}',
        prediction: 'normal',
        prediction_class: 0,
        confidence: 0.98,
        request_id: 'req-42',
        timestamp: '2026-10-26T12:00:00Z',
        actual_label: undefined,
      },
    ]);
    (apiClient as any).labelPrediction = vi.fn().mockResolvedValueOnce({
      id: 42,
      actual_label: 'normal',
    });

    render(<PredictionHistory />);
    expect(await screen.findByText('req-42')).toBeTruthy();
    const normalBtn = screen.getByRole('button', { name: 'Label prediction 42 as normal' });
    expect(normalBtn).toBeTruthy();
    fireEvent.click(normalBtn);
    await screen.findByText('NORMAL');
    expect((apiClient as any).labelPrediction).toHaveBeenCalledWith(42, 'normal');
  });

  it('displays summary telemetry and filters records by class and label status', async () => {
    vi.mocked(apiClient.getPredictionHistory).mockResolvedValueOnce([
      {
        id: 1,
        model_id: 'nsl-kdd-baseline',
        model_version: 'v1.0',
        preprocessing_version: 'v1.0',
        input_features: '{}',
        prediction: 'normal',
        prediction_class: 0,
        confidence: 0.98,
        inference_latency_ms: 4.2,
        request_id: 'req-001',
        timestamp: '2026-10-26T12:00:00Z',
        actual_label: 'normal',
      },
      {
        id: 2,
        model_id: 'nsl-kdd-baseline',
        model_version: 'v1.0',
        preprocessing_version: 'v1.0',
        input_features: '{}',
        prediction: 'attack',
        prediction_class: 1,
        confidence: 0.95,
        inference_latency_ms: 5.6,
        request_id: 'req-002',
        timestamp: '2026-10-26T12:05:00Z',
        actual_label: undefined,
      },
    ]);

    render(<PredictionHistory />);
    expect(await screen.findByText('req-001')).toBeTruthy();
    expect(screen.getByText('req-002')).toBeTruthy();
    expect(screen.getByText('2 inferences')).toBeTruthy();
    expect(screen.getByText('1 / 2 verified')).toBeTruthy();

    // Filter to attack only
    const attackButtons = screen.getAllByRole('button', { name: /^attack$/i });
    fireEvent.click(attackButtons[0]);
    expect(screen.queryByText('req-001')).toBeNull();
    expect(screen.getByText('req-002')).toBeTruthy();

    // Reset or filter to labeled only
    const labeledButtons = screen.getAllByRole('button', { name: /^labeled$/i });
    const allButtons = screen.getAllByRole('button', { name: /^all$/i });
    fireEvent.click(allButtons[0]); // Reset class to all
    fireEvent.click(labeledButtons[0]); // Label to labeled
    expect(screen.getByText('req-001')).toBeTruthy();
    expect(screen.queryByText('req-002')).toBeNull();
  });
});
