import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

const host = '127.0.0.1';
const port = await findOpenPort();
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
      emulators: {
        firestore: {
          host,
          port,
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

function findOpenPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') {
          resolve(address.port);
          return;
        }

        reject(new Error('Could not allocate a Firestore emulator port.'));
      });
    });
  });
}

function runCommand(configPath) {
  return new Promise((resolve) => {
    const args =
      process.platform === 'win32'
        ? [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            `npx firebase-tools@13.35.1 emulators:exec --only firestore --project demo-auth-rules-wave8 --config '${configPath}' 'vitest run firestore.rules.emulator.test.mjs'`,
          ]
        : [
            'firebase-tools@13.35.1',
            'emulators:exec',
            '--only',
            'firestore',
            '--project',
            'demo-auth-rules-wave8',
            '--config',
            configPath,
            'vitest run firestore.rules.emulator.test.mjs',
          ];
    const command = process.platform === 'win32' ? 'powershell.exe' : 'npx';
    console.log(`Running Firestore rules tests on ${host}:${port}`);
    console.log([command, ...args].join(' '));
    const child = spawn(command, args, {
      env: {
        ...process.env,
        FIRESTORE_RULES_TEST_PORT: String(port),
      },
      stdio: 'inherit',
    });

    child.on('close', (code) => resolve(code ?? 1));
  });
}
