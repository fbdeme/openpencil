import { defineEventHandler, readBody, setResponseHeaders } from 'h3';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolveClaudeCli } from '../../utils/resolve-claude-cli';
import { serverLog } from '../../utils/server-logger';

interface LoginResult {
  success: boolean;
  url?: string;
  error?: string;
  alreadyLoggedIn?: boolean;
  needsCode?: boolean;
}

// Keep the login process alive so we can send the code later
let activeLoginProc: ChildProcess | null = null;
let loginOutput = '';

function cleanupLoginProc() {
  if (activeLoginProc) {
    activeLoginProc.kill();
    activeLoginProc = null;
    loginOutput = '';
  }
}

function runAuthStatus(cmd: string): Promise<string> {
  return new Promise((resolve) => {
    let output = '';
    const proc = spawn(cmd, ['auth', 'status'], {
      env: { ...process.env, BROWSER: 'none' },
    });
    proc.stdout?.on('data', (d) => { output += d.toString(); });
    proc.stderr?.on('data', (d) => { output += d.toString(); });
    proc.on('close', () => resolve(output));
    proc.on('error', () => resolve(''));
  });
}

/**
 * POST /api/ai/login-agent
 * body: {} → starts login, returns OAuth URL
 * body: { code: "..." } → sends code to waiting process
 */
export default defineEventHandler(async (event) => {
  setResponseHeaders(event, { 'Content-Type': 'application/json' });
  const body = await readBody(event).catch(() => ({}));

  const claudePath = resolveClaudeCli();
  if (!claudePath) {
    return { success: false, error: 'Claude CLI not found' } satisfies LoginResult;
  }

  // Step 2: User is sending the OAuth code
  if (body?.code) {
    if (!activeLoginProc || !activeLoginProc.stdin) {
      return { success: false, error: 'No active login session. Click Login again.' } satisfies LoginResult;
    }
    try {
      activeLoginProc.stdin.write(body.code + '\n');
      // Additional enters required by the login flow
      setTimeout(() => activeLoginProc?.stdin?.write('\n'), 500);
      setTimeout(() => activeLoginProc?.stdin?.write('\n'), 1000);
      // Wait for process to complete
      const result = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          cleanupLoginProc();
          resolve(false);
        }, 15000);
        activeLoginProc!.on('close', async (code) => {
          clearTimeout(timeout);
          activeLoginProc = null;
          // Verify login succeeded
          const status = await runAuthStatus(claudePath);
          try {
            const parsed = JSON.parse(status);
            resolve(parsed.loggedIn === true);
          } catch {
            resolve(false);
          }
        });
      });
      if (result) {
        serverLog.info('[login-agent]', 'Login successful');
        return { success: true } satisfies LoginResult;
      }
      return { success: false, error: 'Login failed. Check the code and try again.' } satisfies LoginResult;
    } catch (err) {
      cleanupLoginProc();
      return { success: false, error: 'Failed to send code' } satisfies LoginResult;
    }
  }

  // Step 0: Check if already logged in
  try {
    const statusOutput = await runAuthStatus(claudePath);
    const parsed = JSON.parse(statusOutput);
    if (parsed.loggedIn) {
      return { success: true, alreadyLoggedIn: true } satisfies LoginResult;
    }
  } catch { /* continue */ }

  // Step 1: Start login and return OAuth URL
  cleanupLoginProc();
  try {
    const url = await startLoginAndCaptureUrl(claudePath);
    if (url) {
      serverLog.info('[login-agent]', 'OAuth URL generated, waiting for code');
      return { success: true, url, needsCode: true } satisfies LoginResult;
    }
    return { success: false, error: 'Could not get login URL' } satisfies LoginResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Login failed';
    serverLog.info('[login-agent]', `login error: ${msg}`);
    return { success: false, error: msg } satisfies LoginResult;
  }
});

function startLoginAndCaptureUrl(cmd: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    loginOutput = '';
    // Use script to provide a pseudo-tty so claude auth login accepts stdin
    const proc = spawn('script', ['-qc', `"${cmd}" auth login`, '/dev/null'], {
      env: { ...process.env, BROWSER: 'none' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    activeLoginProc = proc;

    const timeout = setTimeout(() => {
      cleanupLoginProc();
      resolve(null);
    }, 15000);

    const checkForUrl = (data: Buffer) => {
      loginOutput += data.toString();
      const match = loginOutput.match(/(https:\/\/claude\.com\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    };

    proc.stdout?.on('data', checkForUrl);
    proc.stderr?.on('data', checkForUrl);
    proc.on('error', (err) => {
      clearTimeout(timeout);
      activeLoginProc = null;
      reject(err);
    });
    proc.on('close', () => {
      clearTimeout(timeout);
      if (!loginOutput.match(/(https:\/\/claude\.com\/[^\s]+)/)) {
        activeLoginProc = null;
        resolve(null);
      }
    });
  });
}
