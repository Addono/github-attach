import { describe, expect, it, vi } from "vitest";
import {
  listGitHubCliAccounts,
  resolveGitHubCliAuth,
} from "../../../src/core/githubCliAuth.js";

type ExecResult = {
  stdout: string;
  stderr?: string;
};

describe("githubCliAuth", () => {
  it("lists accounts from gh auth status JSON", async () => {
    const execFileImpl = vi
      .fn<(...args: unknown[]) => Promise<ExecResult>>()
      .mockResolvedValue({
        stdout: JSON.stringify({
          hosts: {
            "github.com": [
              {
                active: true,
                host: "github.com",
                login: "AKnapen-Ahold",
                state: "success",
              },
              {
                active: false,
                host: "github.com",
                login: "Addono",
                state: "success",
              },
            ],
          },
        }),
      });

    const accounts = await listGitHubCliAccounts("github.com", execFileImpl);

    expect(accounts.map((account) => account.login)).toEqual([
      "AKnapen-Ahold",
      "Addono",
    ]);
  });

  it("prefers the active gh account when no target repository is provided", async () => {
    const execFileImpl = vi
      .fn<(...args: unknown[]) => Promise<ExecResult>>()
      .mockImplementation(async (_file, args) => {
        const commandArgs = Array.isArray(args) ? args : [];
        if (commandArgs[1] === "status") {
          return {
            stdout: JSON.stringify({
              hosts: {
                "github.com": [
                  {
                    active: true,
                    host: "github.com",
                    login: "AKnapen-Ahold",
                    state: "success",
                  },
                  {
                    active: false,
                    host: "github.com",
                    login: "Addono",
                    state: "success",
                  },
                ],
              },
            }),
          };
        }

        if (commandArgs[1] === "token") {
          return { stdout: "ghs_active_token\n" };
        }

        throw new Error(`Unexpected gh call: ${commandArgs.join(" ")}`);
      });

    const auth = await resolveGitHubCliAuth({
      execFileImpl,
      fetchImpl: vi.fn(),
    });

    expect(auth.token).toBe("ghs_active_token");
    expect(auth.login).toBe("AKnapen-Ahold");
  });

  it("falls back to the account that can access the target repository", async () => {
    const execFileImpl = vi
      .fn<(...args: unknown[]) => Promise<ExecResult>>()
      .mockImplementation(async (_file, args) => {
        const commandArgs = Array.isArray(args) ? args : [];
        if (commandArgs[1] === "status") {
          return {
            stdout: JSON.stringify({
              hosts: {
                "github.com": [
                  {
                    active: true,
                    host: "github.com",
                    login: "AKnapen-Ahold",
                    state: "success",
                  },
                  {
                    active: false,
                    host: "github.com",
                    login: "Addono",
                    state: "success",
                  },
                ],
              },
            }),
          };
        }

        if (commandArgs[1] === "token" && commandArgs[5] === "AKnapen-Ahold") {
          return { stdout: "ghs_wrong_identity\n" };
        }

        if (commandArgs[1] === "token" && commandArgs[5] === "Addono") {
          return { stdout: "ghs_addono_identity\n" };
        }

        throw new Error(`Unexpected gh call: ${commandArgs.join(" ")}`);
      });

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input, init) => {
        const url = String(input);
        const authHeader =
          typeof init?.headers === "object" &&
          init.headers !== null &&
          "Authorization" in init.headers
            ? String(init.headers["Authorization"])
            : undefined;
        const ok =
          url.endsWith("/repos/Addono/gh-attach") &&
          authHeader === "Bearer ghs_addono_identity";
        return new Response(JSON.stringify({ ok }), { status: ok ? 200 : 404 });
      });

    const auth = await resolveGitHubCliAuth({
      owner: "Addono",
      repo: "gh-attach",
      execFileImpl,
      fetchImpl,
    });

    expect(auth.token).toBe("ghs_addono_identity");
    expect(auth.login).toBe("Addono");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns accounts without a token when no gh identity can access the target repo", async () => {
    const execFileImpl = vi
      .fn<(...args: unknown[]) => Promise<ExecResult>>()
      .mockImplementation(async (_file, args) => {
        const commandArgs = Array.isArray(args) ? args : [];
        if (commandArgs[1] === "status") {
          return {
            stdout: JSON.stringify({
              hosts: {
                "github.com": [
                  {
                    active: true,
                    host: "github.com",
                    login: "AKnapen-Ahold",
                    state: "success",
                  },
                ],
              },
            }),
          };
        }

        if (commandArgs[1] === "token") {
          return { stdout: "ghs_wrong_identity\n" };
        }

        throw new Error(`Unexpected gh call: ${commandArgs.join(" ")}`);
      });

    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("{}", {
        status: 404,
      }),
    );

    const auth = await resolveGitHubCliAuth({
      owner: "Addono",
      repo: "gh-attach",
      execFileImpl,
      fetchImpl,
    });

    expect(auth.token).toBeUndefined();
    expect(auth.login).toBeUndefined();
    expect(auth.accounts.map((account) => account.login)).toEqual([
      "AKnapen-Ahold",
    ]);
  });
});
