import { z } from "zod";
import path from "node:path";

const identifier = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, "Use letters, numbers, dots, dashes, or underscores");

const relativePath = z
  .string()
  .min(1)
  .refine((value) => !value.includes("\0"), "Paths cannot contain NUL bytes");

const assertionPath = relativePath.refine(
  (value) =>
    !path.isAbsolute(value) &&
    !path.win32.isAbsolute(value) &&
    !value.split(/[\\/]/).includes(".."),
  "Assertion paths must stay inside the trial workspace",
);

const fileExists = z.object({ type: z.literal("file_exists"), path: assertionPath }).strict();
const fileNotExists = z
  .object({ type: z.literal("file_not_exists"), path: assertionPath })
  .strict();
const fileContains = z
  .object({ type: z.literal("file_contains"), path: assertionPath, value: z.string() })
  .strict();
const fileNotContains = z
  .object({ type: z.literal("file_not_contains"), path: assertionPath, value: z.string() })
  .strict();
const fileMatches = z
  .object({
    type: z.literal("file_matches"),
    path: assertionPath,
    pattern: z.string().min(1),
    flags: z
      .string()
      .regex(/^[dgimsuvy]*$/)
      .optional(),
  })
  .strict();
const commandExit = z
  .object({
    type: z.literal("command_exit"),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    exitCode: z.number().int().min(0).max(255).optional(),
    timeoutMs: z.number().int().positive().max(3_600_000).optional(),
  })
  .strict();
const changedFiles = z
  .object({
    type: z.literal("changed_files"),
    include: z.array(z.string().min(1)).optional(),
    exclude: z.array(z.string().min(1)).optional(),
    min: z.number().int().nonnegative().optional(),
    max: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((value) => value.min === undefined || value.max === undefined || value.min <= value.max, {
    message: "changed_files min cannot be greater than max",
  });
const outputContains = z
  .object({
    type: z.enum([
      "stdout_contains",
      "stdout_not_contains",
      "stderr_contains",
      "stderr_not_contains",
    ]),
    value: z.string(),
  })
  .strict();

export const assertionSchema = z.discriminatedUnion("type", [
  fileExists,
  fileNotExists,
  fileContains,
  fileNotContains,
  fileMatches,
  commandExit,
  changedFiles,
  outputContains,
]);

export const agentSchema = z
  .object({
    adapter: z.enum(["codex", "claude", "gemini", "opencode", "custom"]).optional(),
    command: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    stdin: z.boolean().optional(),
    env: z.record(z.string(), z.string()).optional(),
    passEnv: z
      .array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Use a valid environment variable name"))
      .optional(),
    description: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.adapter === "custom" || value.adapter === undefined) &&
      value.command === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Custom agents require a command",
        path: ["command"],
      });
    }
    if (value.stdin === true && value.args?.some((argument) => argument.includes("{prompt}"))) {
      context.addIssue({
        code: "custom",
        message: "Choose either stdin: true or a {prompt} argument, not both",
        path: ["stdin"],
      });
    }
  });

export const caseSchema = z
  .object({
    id: identifier,
    description: z.string().min(1).optional(),
    fixture: relativePath,
    prompt: z.string().min(1),
    agents: z.array(identifier).min(1).optional(),
    trials: z.number().int().min(1).max(100).optional(),
    timeoutMs: z.number().int().positive().max(3_600_000).optional(),
    assertions: z.array(assertionSchema).min(1),
  })
  .strict();

const defaultsSchema = z
  .object({
    trials: z.number().int().min(1).max(100).default(1),
    timeoutMs: z.number().int().positive().max(3_600_000).default(300_000),
    assertionTimeoutMs: z.number().int().positive().max(3_600_000).default(60_000),
    concurrency: z.number().int().min(1).max(32).default(2),
    keep: z.enum(["never", "failures", "always"]).default("failures"),
    redact: z.boolean().default(true),
    outputDir: z.string().min(1).default(".harnesscheck"),
    copyExclude: z
      .array(z.string().min(1))
      .default([
        ".git",
        ".git/**",
        ".harnesscheck",
        ".harnesscheck/**",
        "node_modules",
        "node_modules/**",
      ]),
    maxOutputBytes: z.number().int().min(16_384).max(100_000_000).default(2_000_000),
  })
  .strict();

const DEFAULTS = {
  trials: 1,
  timeoutMs: 300_000,
  assertionTimeoutMs: 60_000,
  concurrency: 2,
  keep: "failures" as const,
  redact: true,
  outputDir: ".harnesscheck",
  copyExclude: [
    ".git",
    ".git/**",
    ".harnesscheck",
    ".harnesscheck/**",
    "node_modules",
    "node_modules/**",
  ],
  maxOutputBytes: 2_000_000,
};

export const harnessConfigSchema = z
  .object({
    version: z.literal(1),
    name: z.string().min(1).optional(),
    defaults: defaultsSchema.default(DEFAULTS),
    agents: z.record(identifier, agentSchema).refine((agents) => Object.keys(agents).length > 0, {
      message: "Define at least one agent",
    }),
    cases: z.array(caseSchema).min(1),
  })
  .strict()
  .superRefine((value, context) => {
    const caseIds = new Set<string>();
    for (const [index, testCase] of value.cases.entries()) {
      if (caseIds.has(testCase.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate case id: ${testCase.id}`,
          path: ["cases", index, "id"],
        });
      }
      caseIds.add(testCase.id);
      for (const agentId of testCase.agents ?? []) {
        if (!(agentId in value.agents)) {
          context.addIssue({
            code: "custom",
            message: `Unknown agent: ${agentId}`,
            path: ["cases", index, "agents"],
          });
        }
      }
    }
  });

const ASSERTION_PATH_JSON_SCHEMA = {
  type: "string",
  minLength: 1,
  pattern: "^(?![A-Za-z]:[\\\\/])(?![\\\\/])(?!.*(?:^|[\\\\/])\\.\\.(?:[\\\\/]|$)).+$",
  description: "A path relative to the trial workspace without parent traversal",
} as const;

export const HARNESSCHECK_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://raw.githubusercontent.com/SiluPanda/harnesscheck/main/harnesscheck.schema.json",
  title: "HarnessCheck configuration",
  type: "object",
  additionalProperties: false,
  required: ["version", "agents", "cases"],
  properties: {
    version: { const: 1 },
    name: { type: "string", minLength: 1 },
    defaults: {
      type: "object",
      additionalProperties: false,
      properties: {
        trials: { type: "integer", minimum: 1, maximum: 100, default: 1 },
        timeoutMs: { type: "integer", minimum: 1, maximum: 3_600_000, default: 300_000 },
        assertionTimeoutMs: { type: "integer", minimum: 1, maximum: 3_600_000, default: 60_000 },
        concurrency: { type: "integer", minimum: 1, maximum: 32, default: 2 },
        keep: { enum: ["never", "failures", "always"], default: "failures" },
        redact: { type: "boolean", default: true },
        outputDir: { type: "string", default: ".harnesscheck" },
        copyExclude: { type: "array", items: { type: "string" } },
        maxOutputBytes: { type: "integer", minimum: 16_384, maximum: 100_000_000 },
      },
    },
    agents: {
      type: "object",
      minProperties: 1,
      additionalProperties: {
        type: "object",
        additionalProperties: false,
        properties: {
          adapter: { enum: ["codex", "claude", "gemini", "opencode", "custom"] },
          command: { type: "string", minLength: 1 },
          args: { type: "array", items: { type: "string" } },
          stdin: { type: "boolean" },
          env: { type: "object", additionalProperties: { type: "string" } },
          passEnv: {
            type: "array",
            items: { type: "string", pattern: "^[A-Za-z_][A-Za-z0-9_]*$" },
            description: "Additional ambient environment variables to pass to this agent",
          },
          description: { type: "string" },
        },
      },
    },
    cases: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "fixture", "prompt", "assertions"],
        properties: {
          id: { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9._-]*$" },
          description: { type: "string" },
          fixture: { type: "string", minLength: 1 },
          prompt: { type: "string", minLength: 1 },
          agents: { type: "array", minItems: 1, items: { type: "string" } },
          trials: { type: "integer", minimum: 1, maximum: 100 },
          timeoutMs: { type: "integer", minimum: 1, maximum: 3_600_000 },
          assertions: {
            type: "array",
            minItems: 1,
            items: {
              oneOf: [
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["type", "path"],
                  properties: {
                    type: { enum: ["file_exists", "file_not_exists"] },
                    path: ASSERTION_PATH_JSON_SCHEMA,
                  },
                },
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["type", "path", "value"],
                  properties: {
                    type: { enum: ["file_contains", "file_not_contains"] },
                    path: ASSERTION_PATH_JSON_SCHEMA,
                    value: { type: "string" },
                  },
                },
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["type", "path", "pattern"],
                  properties: {
                    type: { const: "file_matches" },
                    path: ASSERTION_PATH_JSON_SCHEMA,
                    pattern: { type: "string" },
                    flags: { type: "string" },
                  },
                },
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["type", "command"],
                  properties: {
                    type: { const: "command_exit" },
                    command: { type: "string" },
                    args: { type: "array", items: { type: "string" } },
                    exitCode: { type: "integer", minimum: 0, maximum: 255 },
                    timeoutMs: { type: "integer", minimum: 1 },
                  },
                },
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["type"],
                  properties: {
                    type: { const: "changed_files" },
                    include: { type: "array", items: { type: "string" } },
                    exclude: { type: "array", items: { type: "string" } },
                    min: { type: "integer", minimum: 0 },
                    max: { type: "integer", minimum: 0 },
                  },
                },
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["type", "value"],
                  properties: {
                    type: {
                      enum: [
                        "stdout_contains",
                        "stdout_not_contains",
                        "stderr_contains",
                        "stderr_not_contains",
                      ],
                    },
                    value: { type: "string" },
                  },
                },
              ],
            },
          },
        },
      },
    },
  },
} as const;
