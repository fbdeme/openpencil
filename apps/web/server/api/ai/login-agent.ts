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
  try {
    const output = await runCommand(claudePath, ['auth', 'login'], 10000);
    const urlMatch = output.match(/(https:\/\/claude\.com\/[^\s]+)/);
    if (urlMatch) {
      serverLog('login-agent', `OAuth URL generated`);
      return {
        success: true,
        url: urlMatch[1],
      } satisfies LoginResult;
    }
    return {
      success: false,
      error: 'Could not extract login URL from claude output',
    } satisfies LoginResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Login failed';
    serverLog('login-agent', `login error: ${msg}`);
    return { success: false, error: msg } satisfies LoginResult;
  }
});

function runCommand(cmd: string, args: string[], timeoutMs = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';
    const proc = spawn(cmd, args, {
      env: { ...process.env, BROWSER: 'none' },
      timeout: timeoutMs,
    });
    proc.stdout?.on('data', (data) => { output += data.toString(); });
    proc.stderr?.on('data', (data) => { output += data.toString(); });
    proc.on('close', () => resolve(output));
    proc.on('error', reject);
  });
}
