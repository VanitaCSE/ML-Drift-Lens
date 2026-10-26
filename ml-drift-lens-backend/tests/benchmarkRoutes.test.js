const assert = require("node:assert/strict");
const { test } = require("node:test");
const benchmarkController = require("../controllers/benchmarkController");
const router = require("../routes/benchmarkRoutes");

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("benchmark routes are properly registered", () => {
  const rootRoute = router.stack.find((layer) => layer.route?.path === "/");
  assert.ok(rootRoute, "GET / is registered");
  assert.equal(rootRoute.route.methods.get, true);

  const demoRoute = router.stack.find((layer) => layer.route?.path === "/demo");
  assert.ok(demoRoute, "GET /demo is registered");
  assert.equal(demoRoute.route.methods.get, true);
});

test("getBenchmarkData returns canonical NSL-KDD benchmark metadata and holdout evaluation", () => {
  const res = responseRecorder();
  benchmarkController.getBenchmarkData({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data_source, "official_benchmark");

  const benchmark = res.body.benchmark;
  assert.ok(benchmark);
  assert.equal(benchmark.benchmark_name, "NSL-KDD Canonical Benchmark");
  assert.ok(benchmark.citation.includes("Tavallaee"));
  assert.equal(benchmark.model_id, "nsl-kdd-baseline");
  assert.equal(benchmark.feature_count, 41);

  // Check test holdout evaluation (22,544 samples from KDDTest+.txt)
  assert.equal(benchmark.test_holdout.total_samples, 22544);
  assert.equal(benchmark.test_holdout.dataset_file, "KDDTest+.txt");
  assert.equal(benchmark.test_holdout.sha256, "fa46b0935342616aa83b7c2578db355b6a7aaabbc492248172c7a1e8b7ab8f84");
  assert.ok(Math.abs(benchmark.test_holdout.metrics.accuracy - 0.7953) < 0.001);
  assert.ok(Math.abs(benchmark.test_holdout.metrics.f1 - 0.7864) < 0.001);
  assert.ok(Math.abs(benchmark.test_holdout.metrics.precision - 0.9684) < 0.001);
  assert.ok(Math.abs(benchmark.test_holdout.metrics.recall - 0.6620) < 0.001);
  assert.equal(benchmark.test_holdout.confusion_matrix.true_negatives, 9434);
  assert.equal(benchmark.test_holdout.confusion_matrix.true_positives, 8496);

  // Check validation split evaluation (25,195 samples from KDDTrain+.txt)
  assert.equal(benchmark.validation_split.total_samples, 25195);
  assert.ok(Math.abs(benchmark.validation_split.metrics.accuracy - 0.9990) < 0.001);
  assert.ok(Math.abs(benchmark.validation_split.metrics.f1 - 0.9990) < 0.001);

  // Check drift baseline configuration
  assert.equal(benchmark.drift_baseline.threshold, 0.20);
  assert.equal(benchmark.drift_baseline.minimum_samples, 100);
  assert.equal(benchmark.drift_baseline.reference_sample_count, 125973);
});

test("getDemoScenario returns an isolated simulation dataset clearly labeled as simulation", () => {
  const res = responseRecorder();
  benchmarkController.getDemoScenario({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data_source, "demo_simulation");

  const scenario = res.body.scenario;
  assert.equal(scenario.is_simulation, true);
  assert.equal(scenario.data_source, "demo_simulation");
  assert.ok(scenario.notice.includes("DEMONSTRATION DATA ONLY"));

  // Check simulated drift timeline
  assert.equal(scenario.drift_history.length, 10);
  const driftEvent = scenario.drift_history.find((d) => d.status === "significant_drift");
  assert.ok(driftEvent, "Has a drift point with significant_drift");
  assert.ok(driftEvent.score > 0.20, "Drift score exceeds threshold");

  // Check simulated alerts
  assert.ok(scenario.alerts.length >= 1);
  assert.equal(scenario.alerts[0].status, "resolved");

  // Check simulated retraining
  assert.ok(scenario.retraining_jobs.length >= 1);
  assert.equal(scenario.retraining_jobs[0].promoted, true);
  assert.ok(scenario.retraining_jobs[0].candidate_f1 > scenario.retraining_jobs[0].incumbent_f1);

  // Check latency and class distributions
  assert.ok(scenario.latency_distribution.p95_ms > 0);
  assert.equal(scenario.class_distribution.normal_count + scenario.class_distribution.attack_count, scenario.class_distribution.total);
});
