import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

const host = '127.0.0.1';
const [firestorePort, storagePort] = await findOpenPorts(2);
const tempDir = path.join(process.cwd(), '.firebase-rules-test');
const configPath = path.join(tempDir, 'firebase.json');

await mkdir(tempDir, { recursive: true });
await writeFile(
  configPath,
  JSON.stringify(
    {
      firestore: {
        rules: 'firestore.rules',
      },
      storage: {
        rules: 'storage.rules',
      },
      emulators: {
        firestore: {
          host,
          port: firestorePort,
        },
        storage: {
          host,
          port: storagePort,
        },
      },
    },
    null,
    2,
  ),
);

const exitCode = await runCommand(configPath);

await rm(tempDir, { force: true, recursive: true });
process.exit(exitCode);

async function findOpenPorts(count) {
  const servers = [];
  const ports = [];

  for (let index = 0; index < count; index += 1) {
    const server = net.createServer();
    const port = await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, host, () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          resolve(address.port);
          return;
        }
        reject(new Error('Could not allocate a Firebase emulator port.'));
      });
    });
    servers.push(server);
    ports.push(port);
  }

  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  return ports;
}

function runCommand(configPath) {
  return new Promise((resolve) => {
    const args = [
      'firebase-tools@13.35.1',
      'emulators:exec',
      '--only',
      'firestore,storage',
      '--project',
      'demo-auth-rules-wave8',
      '--config',
      configPath,
      'vitest run --no-file-parallelism firestore.rules.emulator.test.mjs storage.rules.emulator.test.mjs',
    ];
    const command = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'npx';
    const spawnArgs = process.platform === 'win32'
      ? [
          '/d',
          '/s',
          '/c',
          `npx firebase-tools@13.35.1 emulators:exec --only firestore,storage --project demo-auth-rules-wave8 --config "${configPath}" "vitest run --no-file-parallelism firestore.rules.emulator.test.mjs storage.rules.emulator.test.mjs"`,
        ]
      : args;
    console.log(`Running Firestore rules tests on ${host}:${firestorePort}`);
    console.log(`Running Storage rules tests on ${host}:${storagePort}`);
    console.log([command, ...spawnArgs].join(' '));
    const child = spawn(command, spawnArgs, {
      env: {
        ...process.env,
        FIRESTORE_RULES_TEST_PORT: String(firestorePort),
        STORAGE_RULES_TEST_PORT: String(storagePort),
      },
      stdio: 'inherit',
      windowsHide: true,
    });

    child.on('close', (code) => resolve(code ?? 1));
  });
}
