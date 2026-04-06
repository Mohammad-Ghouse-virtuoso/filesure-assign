const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const port = 3101;
const baseUrl = `http://127.0.0.1:${port}`;
let serverProcess;

function waitForServerReady(childProcess) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for server startup.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
    }, 10000);

    function cleanup() {
      clearTimeout(timeout);
      childProcess.stdout.off('data', onStdout);
      childProcess.stderr.off('data', onStderr);
      childProcess.off('exit', onExit);
    }

    function onStdout(chunk) {
      stdout += chunk.toString();
      if (stdout.includes('FileSure API Server running')) {
        cleanup();
        resolve();
      }
    }

    function onStderr(chunk) {
      stderr += chunk.toString();
    }

    function onExit(code) {
      cleanup();
      reject(new Error(`Server exited before startup with code ${code}.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
    }

    childProcess.stdout.on('data', onStdout);
    childProcess.stderr.on('data', onStderr);
    childProcess.on('exit', onExit);
  });
}

test.before(async () => {
  serverProcess = spawn('node', ['server.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await waitForServerReady(serverProcess);
});

test.after(async () => {
  if (!serverProcess || serverProcess.killed) {
    return;
  }

  await new Promise((resolve) => {
    serverProcess.once('exit', resolve);
    serverProcess.kill('SIGTERM');
  });
});

test('GET /companies rejects unsupported query parameters', async () => {
  const response = await fetch(`${baseUrl}/companies?foo=bar`);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.code, 400);
  assert.match(body.error, /Unsupported query parameter/);
  assert.match(body.error, /foo/);
});

test('GET /companies rejects malformed page values', async () => {
  const response = await fetch(`${baseUrl}/companies?page=abc`);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.code, 400);
  assert.equal(body.error, 'page must be a positive integer');
});

test('GET /companies rejects limit values above 100', async () => {
  const response = await fetch(`${baseUrl}/companies?limit=101`);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.code, 400);
  assert.equal(body.error, 'limit must be between 1 and 100');
});

test('GET /companies returns paginated fallback data', async () => {
  const response = await fetch(`${baseUrl}/companies?page=1&limit=2&status=active`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.pagination.page, 1);
  assert.equal(body.pagination.limit, 2);
  assert.ok(Array.isArray(body.companies));
  assert.equal(body.companies.length, 2);
  assert.match(body.dataSource, /data\.json|mongodb/);
});

test('GET /companies/summary returns 80 total records', async () => {
  const response = await fetch(`${baseUrl}/companies/summary`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.total, 80);
});
