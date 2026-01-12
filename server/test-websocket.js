#!/usr/bin/env node
/**
 * WebSocket Real-Time Update Tester for BEAD-004
 * Tests that dashboard updates in real-time when beads, agents, progress, or messages change
 */

const WebSocket = require('ws');
const http = require('http');

const API_BASE = 'http://localhost:3001';
const PROJECT_ID = '39611eed-0ab1-42be-942a-9ae73ff6e031';
const WS_URL = `ws://localhost:3001/ws?project=${PROJECT_ID}`;

// Test results tracking
const testResults = {
  passed: [],
  failed: [],
  total: 0
};

function log(msg, type = 'info') {
  const prefix = type === 'pass' ? '\x1b[32m[PASS]\x1b[0m' :
                 type === 'fail' ? '\x1b[31m[FAIL]\x1b[0m' :
                 type === 'test' ? '\x1b[33m[TEST]\x1b[0m' :
                 '\x1b[36m[INFO]\x1b[0m';
  console.log(`${prefix} ${msg}`);
}

function recordResult(name, passed, details = '') {
  testResults.total++;
  if (passed) {
    testResults.passed.push({ name, details });
    log(`${name} ${details}`, 'pass');
  } else {
    testResults.failed.push({ name, details });
    log(`${name} ${details}`, 'fail');
  }
}

function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  log('Starting WebSocket Real-Time Update Tests', 'test');
  log(`Connecting to ${WS_URL}`);

  // Track received WebSocket messages
  const receivedMessages = [];
  let wsConnected = false;
  let initReceived = false;

  // Connect to WebSocket
  const ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    wsConnected = true;
    log('WebSocket connection established');
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    receivedMessages.push(msg);
    log(`Received WS message: ${msg.type}`);
    if (msg.type === 'init') {
      initReceived = true;
    }
  });

  ws.on('error', (err) => {
    log(`WebSocket error: ${err.message}`, 'fail');
  });

  ws.on('close', () => {
    log('WebSocket connection closed');
  });

  // Wait for connection and init
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test 1: WebSocket connects and receives init message
  log('Test 1: WebSocket connection and initialization', 'test');
  recordResult('WebSocket connection', wsConnected);
  recordResult('Init message received', initReceived);

  if (initReceived) {
    const initMsg = receivedMessages.find(m => m.type === 'init');
    const hasBeads = Array.isArray(initMsg?.data?.beads);
    const hasAgents = Array.isArray(initMsg?.data?.agents);
    const hasProgress = Array.isArray(initMsg?.data?.progress);
    const hasMessages = Array.isArray(initMsg?.data?.messages);
    recordResult('Init contains beads array', hasBeads);
    recordResult('Init contains agents array', hasAgents);
    recordResult('Init contains progress array', hasProgress);
    recordResult('Init contains messages array', hasMessages);
  }

  // Clear received messages for next tests
  receivedMessages.length = 0;

  // Test 2: Bead updates trigger WebSocket broadcast
  log('Test 2: Bead real-time updates', 'test');

  // Create a test bead
  const testBeadTitle = `WS-Test-Bead-${Date.now()}`;
  const createBeadRes = await makeRequest('POST', `/api/projects/${PROJECT_ID}/beads`, {
    title: testBeadTitle,
    description: 'Test bead for WebSocket testing',
    priority: 8
  });

  await new Promise(resolve => setTimeout(resolve, 500));

  const beadCreatedMsg = receivedMessages.find(m => m.type === 'bead:created' && m.data.title === testBeadTitle);
  recordResult('Bead created broadcast received', !!beadCreatedMsg);

  if (createBeadRes.status === 201) {
    const beadId = createBeadRes.data.id;

    // Update the bead
    receivedMessages.length = 0;
    await makeRequest('PATCH', `/api/projects/${PROJECT_ID}/beads/${beadId}`, {
      status: 'in_progress',
      assignee: 'websocket-tester'
    });

    await new Promise(resolve => setTimeout(resolve, 500));

    const beadUpdatedMsg = receivedMessages.find(m => m.type === 'bead:updated' && m.data.id === beadId);
    recordResult('Bead updated broadcast received', !!beadUpdatedMsg);
    if (beadUpdatedMsg) {
      recordResult('Updated bead has correct status', beadUpdatedMsg.data.status === 'in_progress');
    }

    // Delete the bead
    receivedMessages.length = 0;
    await makeRequest('DELETE', `/api/projects/${PROJECT_ID}/beads/${beadId}`);

    await new Promise(resolve => setTimeout(resolve, 500));

    const beadDeletedMsg = receivedMessages.find(m => m.type === 'bead:deleted');
    recordResult('Bead deleted broadcast received', !!beadDeletedMsg);
  }

  // Test 3: Progress updates trigger WebSocket broadcast
  log('Test 3: Progress real-time updates', 'test');
  receivedMessages.length = 0;

  const progressRes = await makeRequest('POST', `/api/projects/${PROJECT_ID}/progress`, {
    agentId: '680fca3b-5335-4c69-ba4e-7a9140113ea4',
    agentName: 'websocket-tester',
    status: 'Running WebSocket test suite',
    completed: ['Test 1: Connection', 'Test 2: Beads'],
    next: ['Test 3: Progress', 'Test 4: Messages']
  });

  await new Promise(resolve => setTimeout(resolve, 500));

  const progressMsg = receivedMessages.find(m => m.type === 'progress:new');
  recordResult('Progress broadcast received', !!progressMsg);
  if (progressMsg) {
    recordResult('Progress has correct agentName', progressMsg.data.agentName === 'websocket-tester');
    recordResult('Progress has correct status', progressMsg.data.status === 'Running WebSocket test suite');
  }

  // Test 4: Message updates trigger WebSocket broadcast
  log('Test 4: Message real-time updates', 'test');
  receivedMessages.length = 0;

  const messageContent = `WebSocket test message at ${new Date().toISOString()}`;
  const messageRes = await makeRequest('POST', `/api/projects/${PROJECT_ID}/messages`, {
    from: 'websocket-tester',
    to: 'orchestrator',
    content: messageContent,
    type: 'info'
  });

  await new Promise(resolve => setTimeout(resolve, 500));

  const messageMsg = receivedMessages.find(m => m.type === 'message:new');
  recordResult('Message broadcast received', !!messageMsg);
  if (messageMsg) {
    recordResult('Message has correct from', messageMsg.data.from === 'websocket-tester');
    recordResult('Message has correct content', messageMsg.data.content === messageContent);
  }

  // Test 5: Verify broadcast includes timestamp and projectId
  log('Test 5: Broadcast metadata', 'test');
  if (receivedMessages.length > 0) {
    const lastMsg = receivedMessages[receivedMessages.length - 1];
    recordResult('Broadcast includes timestamp', !!lastMsg.timestamp);
    recordResult('Broadcast includes projectId', lastMsg.projectId === PROJECT_ID);
  }

  // Close WebSocket
  ws.close();

  // Print summary
  console.log('\n' + '='.repeat(60));
  log('TEST SUMMARY', 'test');
  console.log('='.repeat(60));
  log(`Total tests: ${testResults.total}`);
  log(`Passed: ${testResults.passed.length}`, testResults.passed.length > 0 ? 'pass' : 'info');
  log(`Failed: ${testResults.failed.length}`, testResults.failed.length > 0 ? 'fail' : 'info');

  if (testResults.failed.length > 0) {
    console.log('\nFailed tests:');
    testResults.failed.forEach(t => log(`  - ${t.name} ${t.details}`, 'fail'));
  }

  const allPassed = testResults.failed.length === 0;
  console.log('\n' + '='.repeat(60));
  log(allPassed ? 'ALL TESTS PASSED!' : 'SOME TESTS FAILED', allPassed ? 'pass' : 'fail');
  console.log('='.repeat(60));

  return allPassed;
}

// Run tests
runTests().then(success => {
  process.exit(success ? 0 : 1);
}).catch(err => {
  log(`Test runner error: ${err.message}`, 'fail');
  process.exit(1);
});
