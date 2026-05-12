#!/usr/bin/env node
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { getCliOptions } from './cli';
import { loadConfig } from './config';
import {
  appendAssistantTurn,
  appendUserMessage,
  buildMessages,
  scanDirectory
} from './file-handler';
import { callAI, callAIStream } from './ai-client';
import { loadTools } from './tools-loader';
import { mergeSearchToolsPack } from './tools-merge';
import { buildPromptpileHookEnv, resolveAfterHookScript, runAfterHook } from './after-hook';
import { effectiveToolChoiceForRequest, parseToolChoiceInput } from './tool-choice';
import {
  applySystemInject,
  normalizeInjectFileContent,
  readSystemInjectContent,
  resolveSystemInjectPath
} from './system-inject';
import { isPromptpileDiagnostic } from './diagnostic-log';
import type { ChatApiToolChoice, ToolCall } from './types';

const readUserInputFromTerminal = async (): Promise<string> => {
  console.log('Enter user message. Finish with Ctrl+Z then Enter (Windows), or Ctrl+D (macOS/Linux).');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const lines: string[] = [];
  for await (const line of rl) {
    lines.push(line);
  }

  rl.close();
  return lines.join('\n').trim();
};

const resolveOutputPath = (outputPath: string): string =>
  path.isAbsolute(outputPath) ? outputPath : path.resolve(process.cwd(), outputPath);

/**
 * Ensure parent directory exists and is writable before calling the API.
 */
const ensureOutputPaths = (outputPath: string): string => {
  const resolvedPath = resolveOutputPath(outputPath);
  const dir = path.dirname(resolvedPath);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    console.error(`Error: Cannot create or write to output directory: ${dir}`);
    process.exit(1);
  }
  return resolvedPath;
};

const callsPathForMainOutput = (resolvedMainPath: string): string => {
  const { dir, name } = path.parse(resolvedMainPath);
  return path.join(dir, `${name}.calls.jsonl`);
};

const writeCallsFile = (resolvedMainPath: string, toolCalls: ToolCall[] | undefined): void => {
  if (!toolCalls || toolCalls.length === 0) {
    return;
  }
  const callsPath = callsPathForMainOutput(resolvedMainPath);
  const body = toolCalls.map(tc => JSON.stringify(tc)).join('\n') + '\n';
  fs.writeFileSync(callsPath, body, 'utf8');
};

const printToolCallsLines = (toolCalls: ToolCall[] | undefined, quiet: boolean): void => {
  if (quiet || !toolCalls?.length) {
    return;
  }
  for (const tc of toolCalls) {
    process.stdout.write(`${JSON.stringify(tc)}\n`);
  }
};

async function main(): Promise<void> {
  try {
    const cliOptions = getCliOptions();
    const config = loadConfig(cliOptions);
    const cwd = process.cwd();

    if (!config.apiKey) {
      console.error('Error: AI API key is required');
      process.exit(1);
    }

    const quiet = config.quiet;

    let files = scanDirectory(config.directory);

    if (config.inputMode) {
      const userContent = await readUserInputFromTerminal();
      if (!userContent) {
        console.error('Error: Empty input. Nothing was written.');
        process.exit(1);
      }

      appendUserMessage(config.directory, files, userContent);
      files = scanDirectory(config.directory);
    }
    if (files.length === 0) {
      console.error(
        'Error: No files found matching message patterns ([idx]role.md/json, [idx]assistant.calls.jsonl, [idx]assistant.result.jsonl)'
      );
      process.exit(1);
    }

    let tools;
    try {
      tools = loadTools({
        directory: config.directory,
        cwd,
        toolsFileCli: config.toolsFileCli,
        toolsFileEnv: config.toolsFileEnv
      });
    } catch (e) {
      console.error('Error loading tools:', e instanceof Error ? e.message : e);
      process.exit(1);
    }

    tools = mergeSearchToolsPack(tools);

    let toolChoiceForApi: ChatApiToolChoice | undefined;
    try {
      const parsed = parseToolChoiceInput(config.toolChoice);
      toolChoiceForApi = effectiveToolChoiceForRequest(tools, parsed);
    } catch (e) {
      console.error('Error: Invalid tool choice:', e instanceof Error ? e.message : e);
      process.exit(1);
    }

    let messages = buildMessages(files);

    if (config.systemInjectFileCli) {
      try {
        const resolved = resolveSystemInjectPath(cwd, config.systemInjectFileCli);
        const raw = readSystemInjectContent(resolved);
        const normalized = normalizeInjectFileContent(resolved, raw);
        const trimmed = normalized.trim();
        if (trimmed !== '') {
          messages = applySystemInject(messages, trimmed);
        }
      } catch (e) {
        console.error('Error loading system inject file:', e instanceof Error ? e.message : e);
        process.exit(1);
      }
    }

    let resolvedOutput: string | undefined;
    if (config.output) {
      resolvedOutput = ensureOutputPaths(config.output);
    }

    let response = '';
    let toolCalls: ToolCall[] | undefined;

    if (config.format === 'json') {
      const result = await callAI(
        config.apiKey,
        config.apiBaseUrl,
        config.model,
        messages,
        tools,
        toolChoiceForApi
      );
      response = result.content;
      toolCalls = result.toolCalls;

      if (resolvedOutput) {
        fs.writeFileSync(resolvedOutput, response, 'utf8');
        writeCallsFile(resolvedOutput, toolCalls);
      }
      if (!quiet) {
        process.stdout.write(
          `${JSON.stringify({ response, tool_calls: toolCalls ?? null }, null, 2)}\n`
        );
      }
    } else {
      const result = await callAIStream(
        config.apiKey,
        config.apiBaseUrl,
        config.model,
        messages,
        tools,
        toolChoiceForApi,
        (chunk) => {
          if (!quiet) {
            process.stdout.write(chunk);
          }
        }
      );
      response = result.content;
      toolCalls = result.toolCalls;

      if (resolvedOutput) {
        fs.writeFileSync(resolvedOutput, response, 'utf8');
        writeCallsFile(resolvedOutput, toolCalls);
      }
      printToolCallsLines(toolCalls, quiet);
    }

    let continueMdPath: string | undefined;
    let continueCallsPath: string | undefined;
    if (config.continueMode) {
      const saved = appendAssistantTurn(config.directory, files, response, toolCalls);
      continueMdPath = saved.mdPath;
      continueCallsPath = saved.callsPath;
    }

    const scanAbs = path.resolve(cwd, config.directory);
    const hookResolution = resolveAfterHookScript({
      cwd,
      scanAbs,
      afterHookCli: config.afterHookCli,
      afterHookEnv: config.afterHookEnv
    });
    if (hookResolution.status === 'skip' && isPromptpileDiagnostic()) {
      console.error('[promptpile] after-hook: skipped (no script resolved)');
    }
    if (hookResolution.status === 'warn_missing_explicit') {
      console.error(`Warning: after-hook script not found: ${hookResolution.attempted}`);
    } else if (hookResolution.status === 'run') {
      const hookEnv = buildPromptpileHookEnv({
        scanAbs,
        resolvedOutput,
        toolCalls,
        format: config.format,
        model: config.model,
        quiet,
        responseLength: response.length,
        continueMdPath,
        continueCallsPath
      });
      await runAfterHook({
        scriptPath: hookResolution.path,
        scanAbs,
        hookEnv,
        quiet
      });
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

void main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
