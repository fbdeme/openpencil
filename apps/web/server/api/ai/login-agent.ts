import { defineEventHandler, readBody, setResponseHeaders } from 'h3';
import { spawn } from 'node:child_process';
import { resolveClaudeCli } from '../../utils/resolve-claude-cli';
import { serverLog } from '../../utils/server-logger';

interface LoginResult {
  success: boolean;
  url?: string;
  error?: string;
  alreadyLoggedIn?: boolean;
}

/**
 * POST /api/ai/login-agent
 * Triggers `claude auth login` and returns the OAuth URL for browser-based login.
 */
export default defineEventHandler(async (event) => {
  setResponseHeaders(event, { 'Content-Type': 'application/json' });

  const claudePath = resolveClaudeCli();
  if (!claudePath) {
    return { success: false, error: 'Claude CLI not found' } satisfies LoginResult;
  }

  // Check if already logged in
  try {
    const checkResult = await runCommand(claudePath, ['auth', 'status']);
    const parsed = JSON.parse(checkResult);
    if (parsed.loggedIn) {
      return {
        success: true,
        alreadyLoggedIn: true,
      } satisfies LoginResult;
    }
  } catch {
    // Continue to login
  }

  // Run claude auth login and capture the OAuth URL
  // The process won't exit (it waits for browser callback), so we resolve as soon as we see the URL
  try {
    const output = await captureLoginUrl(claudePath);
    if (output) {
      serverLog.info('[login-agent]', 'OAuth URL generated');
      return { success: true, url: output } satisfies LoginResult;
    }
    return { success: false, error: 'Could not extract login URL from claude output' } satisfies LoginResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Login failed';
    serverLog.info('[login-agent]', `login error: ${msg}`);
    return { success: false, error: msg } satisfies LoginResult;
  }
});

function captureLoginUrl(cmd: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let output = '';
    const proc = spawn(cmd, ['auth', 'login'], {
      env: { ...process.env, BROWSER: 'none' },
    });

    const timeout = setTimeout(() => {
      proc.kill();
      resolve(null);
    }, 15000);

    const checkForUrl = (data: Buffer) => {
      output += data.toString();
      const match = output.match(/(https:\/\/claude\.com\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        // Don't kill the process — it needs to stay alive to complete the OAuth callback
        resolve(match[1]);
      }
    };

    proc.stdout?.on('data', checkForUrl);
    proc.stderr?.on('data', checkForUrl);
    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    proc.on('close', () => {
      clearTimeout(timeout);
      if (!output.match(/(https:\/\/claude\.com\/[^\s]+)/)) {
        resolve(null);
      }
    });
  });
}
