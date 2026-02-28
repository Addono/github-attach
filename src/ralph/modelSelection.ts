/**
 * Model selection and rotation logic for the Ralph Loop.
 *
 * Provides random model selection from a configurable pool, with stall
 * detection that escalates to premium models when progress stalls.
 *
 * @module
 */

/** Minimal evaluation shape needed for stall detection */
export interface EvaluationRecord {
  scores: { aggregate: number };
}

/** Configuration for model pool and stall detection */
export interface ModelPoolConfig {
  /** Regular models rotated through each build iteration */
  models: string[];
  /** Premium models used when progress stalls */
  premiumModels: string[];
  /** Number of consecutive evaluations with no improvement before escalating */
  stallWindow: number;
  /** Minimum aggregate score gain across stallWindow evals to NOT be considered stalled */
  stallThreshold: number;
}

/**
 * Selects the next model to use for an iteration.
 *
 * Normal rotation: picks randomly from the full model pool excluding the
 * current model to ensure variety.
 *
 * Stall detection: if the last `stallWindow` evaluations show less than
 * `stallThreshold` aggregate-score improvement, escalates to a random
 * premium model to break out of the plateau.
 *
 * @param evaluations - Historical evaluation records (used for stall detection)
 * @param config - Model pool and stall detection configuration
 * @param currentModel - The model used in the current iteration (excluded from candidates)
 * @param logFn - Optional logger callback for stall-escalation events
 * @returns The model ID to use for the next iteration
 */
export function selectModel(
  evaluations: EvaluationRecord[],
  config: ModelPoolConfig,
  currentModel: string,
  logFn?: (msg: string) => void,
): string {
  // Stall detection: if last stallWindow evals show < stallThreshold improvement, escalate
  if (evaluations.length >= config.stallWindow) {
    const recent = evaluations.slice(-config.stallWindow);
    const best = Math.max(...recent.map((e) => e.scores.aggregate));
    const worst = Math.min(...recent.map((e) => e.scores.aggregate));
    if (best - worst < config.stallThreshold) {
      const premiumCandidates = config.premiumModels.filter(
        (m) => m !== currentModel,
      );
      if (premiumCandidates.length > 0) {
        const chosen =
          premiumCandidates[
            Math.floor(Math.random() * premiumCandidates.length)
          ];
        if (chosen !== undefined) {
          logFn?.(
            `Stall detected (Δ${best - worst} < ${config.stallThreshold} over ${config.stallWindow} evals) → escalating to premium: ${chosen}`,
          );
          return chosen;
        }
      }
    }
  }

  // Normal rotation — exclude the current model to ensure variety.
  // Premium models are reserved for stall escalation only.
  const candidates = config.models.filter((m) => m !== currentModel);
  if (candidates.length === 0) {
    const first = config.models[0];
    return first ?? currentModel;
  }
  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  return picked ?? candidates[0] ?? currentModel;
}
