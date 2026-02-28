import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface Config {
  [key: string]: string | string[];
}

/**
 * Get the config file path (XDG compliant).
 */
function getConfigPath(): string {
  const envPath = process.env.GH_ATTACH_CONFIG;
  if (envPath) {
    return envPath;
  }
  const configDir = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(configDir, "gh-attach", "config.json");
}

/**
 * Load configuration from file.
 * @internal exported for use by other commands
 */
export function loadConfig(): Config {
  const path = getConfigPath();
  if (!existsSync(path)) {
    return {};
  }
  try {
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content) as Config;
  } catch {
    return {};
  }
}

/**
 * Save configuration to file.
 */
function saveConfig(config: Config): void {
  const path = getConfigPath();
  const dir = path.substring(0, path.lastIndexOf("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Config command implementation.
 */
export async function configCommand(
  action: string,
  key?: string,
  value?: string,
) {
  const config = loadConfig();

  switch (action) {
    case "list": {
      if (Object.keys(config).length === 0) {
        console.log("No configuration set");
      } else {
        for (const [k, v] of Object.entries(config)) {
          const val = Array.isArray(v) ? v.join(", ") : v;
          console.log(`${k}: ${val}`);
        }
      }
      break;
    }

    case "get": {
      if (!key) {
        throw new Error("Key is required for 'get' action");
      }
      const val = config[key];
      if (val === undefined) {
        console.log(`${key} is not set`);
      } else {
        const output = Array.isArray(val) ? val.join(", ") : val;
        console.log(output);
      }
      break;
    }

    case "set": {
      if (!key || value === undefined) {
        throw new Error("Key and value are required for 'set' action");
      }
      // Handle comma-separated values for arrays (like strategy-order)
      if (key === "strategy-order") {
        config[key] = value.split(",").map((s) => s.trim());
      } else {
        config[key] = value;
      }
      saveConfig(config);
      console.log(`${key} set to ${value}`);
      break;
    }

    default:
      throw new Error(`Unknown config action: ${action}`);
  }
}
