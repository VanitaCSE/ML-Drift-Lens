const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { afterEach, test } = require("node:test");

const http = require("http");
const mlServiceClient = require("../services/mlServiceClient");

const originalRequest = http.request;

afterEach(() => {
  http.request = originalRequest;
});

function mockResponse(statusCode, body) {
  const response = new EventEmitter();
  response.statusCode = statusCode;
  process.nextTick(() => {
    response.emit("data", JSON.stringify(body));
    response.emit("end");
  });
  return response;
}

function mockRequest(responseFactory) {
  http.request = (options, callback) => {
    const request = new EventEmitter();
    request.setTimeout = () => {};
    request.write = () => {};
    request.end = () => process.nextTick(() => callback(responseFactory()));
    request.destroy = () => {};
    return request;
  };
}

test("reloadModel accepts only a response confirming the requested active model", async () => {
  mockRequest(() => mockResponse(200, {
    status: "success",
    model_id: "intrusion-detector-v1",
    active_model_version: "candidate-2026-03-01",
  }));

  const result = await mlServiceClient.reloadModel({
    model_id: "intrusion-detector-v1",
    model_version: "candidate-2026-03-01",
  });

  assert.equal(result.active_model_version, "candidate-2026-03-01");
});

test("reloadModel rejects a malformed successful response", async () => {
  mockRequest(() => mockResponse(200, {
    status: "success",
    model_id: "intrusion-detector-v1",
    active_model_version: "candidate-older-version",
  }));

  await assert.rejects(
    mlServiceClient.reloadModel({
      model_id: "intrusion-detector-v1",
      model_version: "candidate-2026-03-02",
    }),
    (error) => {
      assert.equal(error.statusCode, 502);
      assert.equal(error.message, "ML Service returned an invalid reload response");
      return true;
    },
  );
});

test("getModelInfo returns parsed metadata on HTTP 200", async () => {
  const modelInfoPayload = {
    model_name: "nsl-kdd-baseline",
    model_version: "nsl-kdd-validation-20260928",
    num_features: 41,
  };
  mockRequest(() => mockResponse(200, modelInfoPayload));

  const result = await mlServiceClient.getModelInfo();
  assert.equal(result.model_name, "nsl-kdd-baseline");
  assert.equal(result.model_version, "nsl-kdd-validation-20260928");
  assert.equal(result.num_features, 41);
});

test("getModelInfo retries on transient 502 and recovers", async () => {
  let callCount = 0;
  http.request = (options, callback) => {
    callCount += 1;
    const request = new EventEmitter();
    request.setTimeout = () => {};
    request.write = () => {};
    request.destroy = () => {};
    request.end = () => {
      process.nextTick(() => {
        if (callCount === 1) {
          const res = new EventEmitter();
          res.statusCode = 502;
          process.nextTick(() => {
            res.emit("data", "<html>Bad Gateway</html>");
            res.emit("end");
          });
          callback(res);
        } else {
          callback(mockResponse(200, { model_name: "nsl-kdd-baseline", model_version: "v1" }));
        }
      });
    };
    return request;
  };

  const result = await mlServiceClient.getModelInfo();
  assert.equal(callCount, 2);
  assert.equal(result.model_name, "nsl-kdd-baseline");
});

test("getModelInfo rejects on persistent upstream error", async () => {
  mockRequest(() => mockResponse(503, { detail: "Model not loaded" }));

  await assert.rejects(
    mlServiceClient.getModelInfo(),
    (err) => {
      assert.equal(err.statusCode, 503);
      assert.equal(err.message, "Model not loaded");
      return true;
    }
  );
});

test("checkReady returns true when inference service is ready", async () => {
  mockRequest(() => mockResponse(200, { ready: true, model_loaded: true, message: "Ready" }));
  const result = await mlServiceClient.checkReady();
  assert.equal(result.ready, true);
  assert.equal(result.modelLoaded, true);
});

test("checkReady returns false when inference service returns 503", async () => {
  mockRequest(() => mockResponse(503, { ready: false, model_loaded: false, message: "Model not yet loaded" }));
  const result = await mlServiceClient.checkReady();
  assert.equal(result.ready, false);
  assert.equal(result.modelLoaded, false);
});

test("predict sends feature payload and receives inference response", async () => {
  const predictionResult = {
    prediction: "normal",
    prediction_class: 0,
    confidence: 0.99,
  };
  mockRequest(() => mockResponse(200, predictionResult));

  const result = await mlServiceClient.predict({
    model_id: "nsl-kdd-baseline",
    model_version: "v1",
    preprocessing_version: "p1",
    input_features: { duration: 0 },
  });

  assert.equal(result.prediction, "normal");
  assert.equal(result.confidence, 0.99);
});
