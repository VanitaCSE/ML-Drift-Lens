const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const projectRoot = path.resolve(__dirname, "../..");
const DEFAULT_TIMEOUT_MS = 25 * 60 * 1000;
const DEFAULT_MIN_SAMPLES = 150;

function defaultPythonExecutable() {
  const virtualEnvironmentPython = path.join(
    projectRoot,
    ".venv-1",
    "Scripts",
    "python.exe",
  );
  return fs.existsSync(virtualEnvironmentPython) ? virtualEnvironmentPython : "python";
}

function runCandidateRetraining(records, options = {}, spawnProcess = spawn) {
  const modelId = options.modelId;
  const contractPath = options.contractPath || path.join(projectRoot, "ml", "contracts", "nsl_kdd_data_contract.json");
  const candidateDir = options.candidateDir || path.join(projectRoot, "ml", "artifacts", "candidates");
  const pythonExecutable = options.pythonExecutable || process.env.PYTHON_EXECUTABLE || defaultPythonExecutable();
  const timeoutMs = Number(options.timeoutMs || process.env.CANDIDATE_RETRAINING_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    return Promise.reject(new Error("Candidate retraining timeout must be a positive integer"));
  }
  const args = [
    "-m",
    "ml.retraining",
    "--contract",
    contractPath,
    "--candidate-dir",
    candidateDir,
    "--model-id",
    modelId,
    "--min-samples",
    String(options.minSamples ?? DEFAULT_MIN_SAMPLES),
  ];

  if (options.oldModelVersion) {
    args.push("--old-model-version", options.oldModelVersion);
  }

  return new Promise((resolve, reject) => {
    const child = spawnProcess(pythonExecutable, args, {
      cwd: projectRoot,
      env: {
        ...process.env,
        PYTHONPATH: [projectRoot, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
      },
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Candidate retraining timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timeout.unref?.();

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      if (exitCode !== 0) {
        return reject(new Error(stderr.trim() || `Candidate retraining exited with code ${exitCode}`));
      }

      try {
        const outputLines = stdout.trim().split(/\r?\n/).filter(Boolean);
        resolve(JSON.parse(outputLines[outputLines.length - 1]));
      } catch (error) {
        reject(new Error(`Invalid candidate retraining output: ${error.message}`));
      }
    });

    child.stdin.end(JSON.stringify(records));
  });
}

module.exports = {
  projectRoot,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MIN_SAMPLES,
  runCandidateRetraining,
};