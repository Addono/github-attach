import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

/**
 * GitHub CLI account metadata exposed by `gh auth status --json hosts`.
 */
export interface GitHubCliAccount {
  active: boolean;
  host: string;
  login: string;
  state: string;
  tokenSource?: string;
  scopes?: string;
  gitProtocol?: string;
}

/**
 * Resolved GitHub CLI authentication state for a host.
 */
export interface GitHubCliAuthState {
  accounts: GitHubCliAccount[];
  token?: string;
  login?: string;
}

interface ResolveGitHubCliAuthOptions {
  hostname?: string;
  owner?: string;
  repo?: string;
  execFileImpl?: typeof execFile;
  fetchImpl?: typeof fetch;
}

function isGitHubCliAccount(value: unknown): value is GitHubCliAccount {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["active"] === "boolean" &&
    typeof candidate["host"] === "string" &&
    typeof candidate["login"] === "string" &&
    typeof candidate["state"] === "string"
  );
}

function getApiBaseUrl(hostname: string): string {
  return hostname === "github.com"
    ? "https://api.github.com"
    : `https://${hostname}/api/v3`;
}

function prioritizeAccounts(
  accounts: GitHubCliAccount[],
  owner?: string,
): GitHubCliAccount[] {
  const successful = accounts.filter((account) => account.state === "success");
  const ownerLower = owner?.toLowerCase();

  const ownerMatches = successful.filter(
    (account) => account.login.toLowerCase() === ownerLower,
  );
  const active = successful.filter(
    (account) =>
      account.active &&
      !ownerMatches.some((match) => match.login === account.login),
  );
  const rest = successful.filter(
    (account) =>
      !ownerMatches.some((match) => match.login === account.login) &&
      !active.some((match) => match.login === account.login),
  );

  return [...ownerMatches, ...active, ...rest];
}

async function getGitHubCliTokenForUser(
  hostname: string,
  user: string,
  execFileImpl: typeof execFile,
): Promise<string | undefined> {
  try {
    const { stdout } = await execFileImpl("gh", [
      "auth",
      "token",
      "--hostname",
      hostname,
      "--user",
      user,
    ]);
    const token = stdout.trim();
    return token.length > 0 ? token : undefined;
  } catch {
    return undefined;
  }
}

async function tokenCanAccessRepository(
  token: string,
  hostname: string,
  owner: string,
  repo: string,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(
      `${getApiBaseUrl(hostname)}/repos/${owner}/${repo}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Lists accounts known to the GitHub CLI for a host.
 */
export async function listGitHubCliAccounts(
  hostname = "github.com",
  execFileImpl: typeof execFile = execFile,
): Promise<GitHubCliAccount[]> {
  try {
    const { stdout } = await execFileImpl("gh", [
      "auth",
      "status",
      "--hostname",
      hostname,
      "--json",
      "hosts",
    ]);

    const parsed = JSON.parse(stdout) as {
      hosts?: Record<string, unknown>;
    };
    const hostEntries = parsed.hosts?.[hostname];
    if (!Array.isArray(hostEntries)) {
      return [];
    }

    return hostEntries.filter(isGitHubCliAccount);
  } catch {
    return [];
  }
}

/**
 * Resolves a usable GitHub token from `gh auth`, preferring the account most likely
 * to have access to the requested repository.
 */
export async function resolveGitHubCliAuth(
  options: ResolveGitHubCliAuthOptions = {},
): Promise<GitHubCliAuthState> {
  const hostname = options.hostname ?? "github.com";
  const execFileImpl = options.execFileImpl ?? execFile;
  const fetchImpl = options.fetchImpl ?? fetch;
  const accounts = await listGitHubCliAccounts(hostname, execFileImpl);

  for (const account of prioritizeAccounts(accounts, options.owner)) {
    const token = await getGitHubCliTokenForUser(
      hostname,
      account.login,
      execFileImpl,
    );
    if (!token) {
      continue;
    }

    if (options.owner && options.repo) {
      const accessible = await tokenCanAccessRepository(
        token,
        hostname,
        options.owner,
        options.repo,
        fetchImpl,
      );
      if (!accessible) {
        continue;
      }
    }

    return {
      accounts,
      token,
      login: account.login,
    };
  }

  return { accounts };
}
