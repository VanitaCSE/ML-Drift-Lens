const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");

const pool = require("../db");
const mlServiceClient = require("../services/mlServiceClient");
const predictionsController = require("../controllers/predictionsController");

const originalQuery = pool.query;
const originalPredict = mlServiceClient.predict;

const predictionRequest = {
  body: {
    model_id: "intrusion-detector-v1",
    model_version: "0.1.0",
    preprocessing_version: "preprocessing-v1",
    input_features: { duration: 100, protocol_type: "tcp" },
  },
};

const mlResponse = {
  prediction: "normal",
  prediction_class: 0,
  confidence: 0.91,
};

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

afterEach(() => {
  pool.query = originalQuery;
  mlServiceClient.predict = originalPredict;
});

test("stores a prediction in PostgreSQL and returns its id", async () => {
  let queryText;
  let queryValues;
  mlServiceClient.predict = async () => mlResponse;
  pool.query = async (text, values) => {
    queryText = text;
    queryValues = values;
    return { rows: [{ id: 41 }] };
  };

  const response = responseRecorder();
  await predictionsController.createPrediction(predictionRequest, response);

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.stored_id, 41);
  assert.match(queryText, /INSERT INTO predictions/i);
    assert.deepEqual(queryValues.slice(0, 9), [
    "intrusion-detector-v1",
    "0.1.0",
    "preprocessing-v1",
    predictionRequest.body.input_features,
    "normal",
    0,
    0.91,
      response.body.inference_latency_ms,
    response.body.request_id,
  ]);
    assert.ok(queryValues[9] instanceof Date);
});

test("authoritative class mapping: serializes class 0 as normal and class 1 as attack", async () => {
  const attackMlResponse = {
    prediction: "attack",
    prediction_class: 1,
    confidence: 0.98,
  };
  let queryValues;
  mlServiceClient.predict = async () => attackMlResponse;
  pool.query = async (text, values) => {
    queryValues = values;
    return { rows: [{ id: 42 }] };
  };

  const response = responseRecorder();
  await predictionsController.createPrediction(predictionRequest, response);

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.prediction, "attack");
  assert.equal(response.body.prediction_class, 1);
  assert.equal(queryValues[4], "attack");
  assert.equal(queryValues[5], 1);
});

test("retrieves paginated prediction history without input features", async () => {
  const rows = [{ id: 1, prediction: "attack" }];
  let queryText;
  let queryValues;
  pool.query = async (text, values) => {
    queryText = text;
    queryValues = values;
    return { rows };
  };

  const response = responseRecorder();
  await predictionsController.getAllPredictions({ query: { limit: "10", offset: "5" } }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, rows);
  assert.match(queryText, /SELECT id, model_id, model_version/i);
  assert.deepEqual(queryValues, [10, 5]);
});

test("returns an empty array when PostgreSQL has no predictions", async () => {
  pool.query = async () => ({ rows: [] });

  const response = responseRecorder();
  await predictionsController.getAllPredictions({ query: {} }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, []);
});

test("hides database errors when history retrieval fails", async () => {
  pool.query = async () => {
    throw new Error("password=should-not-leak");
  };

  const response = responseRecorder();
  await predictionsController.getAllPredictions({ query: {} }, response);

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, {
    success: false,
    error: "Failed to retrieve predictions",
  });
  assert.doesNotMatch(JSON.stringify(response.body), /password/);
});

test("updates actual_label in PostgreSQL", async () => {
  const row = { id: 7, actual_label: "attack" };
  let queryValues;
  pool.query = async (text, values) => {
    queryValues = values;
    return { rows: [row] };
  };

  const response = responseRecorder();
  await predictionsController.updatePrediction(
    { params: { id: "7" }, body: { actual_label: "attack" } },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, row);
  assert.deepEqual(queryValues, ["attack", "7", "analyst-review"]);
});

test("deletes a prediction from PostgreSQL", async () => {
  const row = { id: 7, prediction: "normal" };
  let queryValues;
  pool.query = async (text, values) => {
    queryValues = values;
    return { rows: [row] };
  };

  const response = responseRecorder();
  await predictionsController.deletePrediction({ params: { id: "7" } }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { success: true, deleted: row });
  assert.deepEqual(queryValues, ["7"]);
});
test("rejects invalid actual_label values", async () => {
  const response = responseRecorder();
  await predictionsController.updatePrediction(
    { params: { id: "7" }, body: { actual_label: "unsupported-label" } },
    response,
  );

  assert.equal(response.statusCode, 400);
  assert.match(response.body.error, /Invalid actual_label/);
});
