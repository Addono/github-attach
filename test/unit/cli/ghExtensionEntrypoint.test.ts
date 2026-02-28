import { describe, it, expect } from "vitest";
import {
  mkdtemp,
  mkdir,
  chmod,
  writeFile,
  readFile,
  stat,
  rm,
} from "node:fs/promises";

type PackageJson = {
  bin?: Record<string, string>;
  files?: string[];
};
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

describe("gh extension entrypoints", () => {
  it("repo includes executable gh-attach and gh-extension entrypoints", async () => {
    const root = process.cwd();

    const ghAttachStat = await stat(join(root, "gh-attach"));
    expect((ghAttachStat.mode & 0o111) !== 0).toBe(true);

    const ghExtensionStat = await stat(join(root, "gh-extension"));
    expect((ghExtensionStat.mode & 0o111) !== 0).toBe(true);

    const pkg = JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    ) as PackageJson;
    expect(pkg.bin?.["gh-extension"]).toBe("gh-extension");
    expect(pkg.files).toContain("gh-extension");
    expect(pkg.files).toContain("gh-attach");
  });

  it("gh-attach prefers a local platform binary when present", async () => {
    const root = process.cwd();
    const src = await readFile(join(root, "gh-attach"), "utf8");

    const dir = await mkdtemp(join(tmpdir(), "gh-attach-ext-"));
    try {
      const ghAttachPath = join(dir, "gh-attach");
      await writeFile(ghAttachPath, src, "utf8");
      await chmod(ghAttachPath, 0o755);

      const binDir = join(dir, "bin");
      await mkdir(binDir);

      // Determine correct binary name for the current platform
      const os = process.platform === "darwin" ? "darwin" : "linux";
      const arch = process.arch === "arm64" ? "arm64" : "amd64";
      const mockBin = join(binDir, `gh-attach-${os}-${arch}`);
      await writeFile(mockBin, "#!/bin/sh\necho MOCK\n", "utf8");
      await chmod(mockBin, 0o755);

      const { stdout, stderr } = await execFileAsync(
        ghAttachPath,
        ["--version"],
        {
          env: { ...process.env, GH_REPO: "owner/gh-attach" },
        },
      );

      expect(stderr).toBe("");
      expect(stdout).toBe("MOCK\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
