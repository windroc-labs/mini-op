import type { Guard } from "../lib/guard.ts";
import { guard as actionPins } from "./action_pins.ts";
import { guard as address } from "./address.ts";
import { guard as applescript } from "./applescript.ts";
import { guard as boundary } from "./boundary.ts";
import { guard as canaryScenarios } from "./canary_scenarios.ts";
import { guard as claudeMd } from "./claude_md.ts";
import { guard as codeowners } from "./codeowners.ts";
import { guard as commentBudget } from "./comment_budget.ts";
import { guard as dataParse } from "./data_parse.ts";
import { guard as deleteTargets } from "./delete_targets.ts";
import { guard as duplicateCode } from "./duplicate_code.ts";
import { guard as docRefs } from "./doc_refs.ts";
import { guard as exitCodes } from "./exit_codes.ts";
import { guard as embeddedPrograms } from "./embedded_programs.ts";
import { guard as forbiddenOps } from "./forbidden_ops.ts";
import { guard as guardSamples } from "./guard_samples.ts";
import { guard as handwrittenJs } from "./handwritten_js.ts";
import { guard as keychainItems } from "./keychain_items.ts";
import { guard as keychainReads } from "./keychain_reads.ts";
import { guard as layout } from "./layout.ts";
import { guard as miniCommands } from "./mini_commands.ts";
import { guard as miniPasswordItem } from "./mini_password_item.ts";
import { guard as nonCode } from "./non_code.ts";
import { guard as noPython } from "./no_python.ts";
import { guard as osascriptPrograms } from "./osascript_programs.ts";
import { guard as pathBypass } from "./path_bypass.ts";
import { guard as readmeCommands } from "./readme_commands.ts";
import { guard as retiredNames } from "./retired_names.ts";
import { guard as secretPatterns } from "./secret_patterns.ts";
import { guard as secretStdin } from "./secret_stdin.ts";
import { guard as secretsDir } from "./secrets_dir.ts";
import { guard as stateDir } from "./state_dir.ts";
import { guard as suppressions } from "./suppressions.ts";
import { guard as testBoundary } from "./test_boundary.ts";
import { guard as testFiles } from "./test_files.ts";
import { guard as testIsolation } from "./test_isolation.ts";
import { guard as timeouts } from "./timeouts.ts";
import { guard as tmuxCalls } from "./tmux_calls.ts";
import { guard as toolPins } from "./tool_pins.ts";
import { guard as unreferenced } from "./unreferenced.ts";
import { guard as workflow } from "./workflow.ts";

export const guards: Guard[] = [
  actionPins,
  toolPins,
  workflow,
  readmeCommands,
  codeowners,
  suppressions,
  commentBudget,
  testIsolation,
  testBoundary,
  testFiles,
  exitCodes,
  nonCode,
  secretsDir,
  secretPatterns,
  secretStdin,
  keychainReads,
  keychainItems,
  canaryScenarios,
  pathBypass,
  layout,
  boundary,
  miniCommands,
  noPython,
  stateDir,
  forbiddenOps,
  deleteTargets,
  tmuxCalls,
  osascriptPrograms,
  applescript,
  handwrittenJs,
  embeddedPrograms,
  dataParse,
  miniPasswordItem,
  retiredNames,
  timeouts,
  claudeMd,
  address,
  docRefs,
  unreferenced,
  duplicateCode,
  guardSamples,
];
