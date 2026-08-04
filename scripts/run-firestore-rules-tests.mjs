import { spawn } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

const host = '127.0.0.1';
const [firestorePort, storagePort] = await findOpenPorts(2);
const configPath = path.join(process.cwd(), '.firebase-rules-test.json');
const cliConfigPath = path.join(process.cwd(), '.tmp-firebase-rules-config');
const cliCachePath = path.join(process.cwd(), '.tmp-firebase-rules-cache');

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

const exitCode = await runCommand(configPath, cliConfigPath, cliCachePath);

await rm(configPath, { force: true });
await rm(cliConfigPath, { force: true, recursive: true });
await rm(cliCachePath, { force: true, recursive: true });
console.log(`Firebase rules test runner exited with code ${exitCode}.`);
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

function runCommand(configPath, cliConfigPath, cliCachePath) {
  return new Promise((resolve) => {
    const firebaseCliPath = path.join(
      process.cwd(),
      'functions',
      'node_modules',
      'firebase-tools',
      'lib',
      'bin',
      'firebase.js',
    );
    const args = [
      'emulators:exec',
      '--only',
      'firestore,storage',
      '--project',
      'demo-auth-rules-wave8',
      '--config',
      configPath,
      'vitest run --no-file-parallelism firestore.rules.emulator.test.mjs storage.rules.emulator.test.mjs',
    ];
    const command = process.execPath;
    const spawnArgs = [firebaseCliPath, ...args];
    console.log(`Running Firestore rules tests on ${host}:${firestorePort}`);
    console.log(`Running Storage rules tests on ${host}:${storagePort}`);
    console.log([command, ...spawnArgs].join(' '));
    const child = spawn(command, spawnArgs, {
      env: {
        ...process.env,
        FIRESTORE_RULES_TEST_PORT: String(firestorePort),
        STORAGE_RULES_TEST_PORT: String(storagePort),
        XDG_CACHE_HOME: cliCachePath,
        XDG_CONFIG_HOME: cliConfigPath,
      },
      stdio: 'inherit',
      windowsHide: true,
    });

    child.on('error', (error) => {
      console.error('Could not start the Firebase rules test runner.', error);
      resolve(1);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}
