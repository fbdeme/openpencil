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

// Store the pty process so we can write to it later
let activePty: any = null;
let ptyOutput = '';

function cleanupPty() {
  if (activePty) {
    try { activePty.kill(); } catch {}
    activePty = null;
    ptyOutput = '';
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
 * body: { code: "..." } → sends code to waiting pty process
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
    if (!activePty) {
      return { success: false, error: 'No active login session. Click Login again.' } satisfies LoginResult;
    }
    try {
      serverLog.info('[login-agent] Sending code (' + body.code.length + ' chars) to pty');
      ptyOutput = '';
      activePty.write(body.code + '\r');
      // Extra enters after a delay
      setTimeout(() => { try { activePty?.write('\r'); } catch {} }, 500);
      setTimeout(() => { try { activePty?.write('\r'); } catch {} }, 1000);

      // Wait for process to finish
      const result = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          serverLog.info('[login-agent] Code submit timeout. pty output: ' + ptyOutput.substring(0, 500));
          cleanupPty();
          resolve(false);
        }, 20000);

        const checkDone = setInterval(async () => {
          // Check if login succeeded by polling auth status
          try {
            const status = await runAuthStatus(claudePath);
            const parsed = JSON.parse(status);
            if (parsed.loggedIn) {
              clearTimeout(timeout);
              clearInterval(checkDone);
              serverLog.info('[login-agent] Login verified as successful');
              cleanupPty();
              resolve(true);
            }
          } catch {}
        }, 2000);

        if (activePty.onExit) {
          activePty.onExit(() => {
            clearTimeout(timeout);
            clearInterval(checkDone);
            activePty = null;
          });
        }
      });

      if (result) {
        return { success: true } satisfies LoginResult;
      }
      return { success: false, error: 'Login failed. Check the code and try again.' } satisfies LoginResult;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send code';
      serverLog.info('[login-agent] Code submit error: ' + msg);
      cleanupPty();
      return { success: false, error: msg } satisfies LoginResult;
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

  // Step 1: Start login with node-pty and capture OAuth URL
  cleanupPty();
  try {
    const url = await startLoginPty(claudePath);
    if (url) {
      serverLog.info('[login-agent] OAuth URL generated, waiting for code');
      return { success: true, url, needsCode: true } satisfies LoginResult;
    }
    return { success: false, error: 'Could not get login URL' } satisfies LoginResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Login failed';
    serverLog.info('[login-agent] Start login error: ' + msg);
    return { success: false, error: msg } satisfies LoginResult;
  }
});

async function startLoginPty(cmd: string): Promise<string | null> {
  let pty: typeof import('node-pty');
  try {
    pty = await import('node-pty');
  } catch {
    // Fallback: try require
    try {
      pty = require('node-pty');
    } catch (e) {
      serverLog.info('[login-agent] node-pty not available, falling back to spawn');
      return startLoginFallback(cmd);
    }
  }

  return new Promise((resolve) => {
    ptyOutput = '';
    const proc = pty.spawn(cmd, ['auth', 'login'], {
      name: 'xterm',
      cols: 200,
      rows: 30,
      env: { ...process.env, BROWSER: 'none' } as Record<string, string>,
    });
    activePty = proc;

    const timeout = setTimeout(() => {
      serverLog.info('[login-agent] URL capture timeout. Output: ' + ptyOutput.substring(0, 500));
      cleanupPty();
      resolve(null);
    }, 15000);

    proc.onData((data: string) => {
      ptyOutput += data;
      const match = ptyOutput.match(/(https:\/\/claude\.com\/[^\s\x1b]+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });

    proc.onExit?.(() => {
      clearTimeout(timeout);
      if (!ptyOutput.match(/(https:\/\/claude\.com\/[^\s\x1b]+)/)) {
        activePty = null;
        resolve(null);
      }
    });
  });
}

// Fallback without node-pty using script command
function startLoginFallback(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    ptyOutput = '';
    const proc = spawn('script', ['-qc', `"${cmd}" auth login`, '/dev/null'], {
      env: { ...process.env, BROWSER: 'none' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    activePty = { write: (d: string) => proc.stdin?.write(d), kill: () => proc.kill() };

    const timeout = setTimeout(() => {
      cleanupPty();
      resolve(null);
    }, 15000);

    const check = (data: Buffer) => {
      ptyOutput += data.toString();
      const match = ptyOutput.match(/(https:\/\/claude\.com\/[^\s\x1b]+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    };
    proc.stdout?.on('data', check);
    proc.stderr?.on('data', check);
    proc.on('close', () => {
      clearTimeout(timeout);
      if (!ptyOutput.match(/(https:\/\/claude\.com\/[^\s\x1b]+)/)) {
        activePty = null;
        resolve(null);
      }
    });
  });
}
