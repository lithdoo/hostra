#!/usr/bin/env node
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { getCliOptions } from './cli';
import { loadConfig } from './config';
import { appendAssistantMessage, appendUserMessage, readFiles, scanDirectory } from './file-handler';
import { callAI, callAIStream } from './ai-client';

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

const writeOutputIfConfigured = (outputPath: string | undefined, content: string) => {
  if (!outputPath) {
    return;
  }

  const resolvedPath = path.isAbsolute(outputPath)
    ? outputPath
    : path.resolve(process.cwd(), outputPath);

  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, content, 'utf8');
  return resolvedPath;
};

async function main() {
  try {
    const cliOptions = getCliOptions();
    const config = loadConfig(cliOptions);

    if (!config.apiKey) {
      console.error('Error: AI API key is required');
      process.exit(1);
    }

    console.log(`Scanning directory: ${config.directory}`);
    let files = scanDirectory(config.directory);

    if (config.inputMode) {
      const userContent = await readUserInputFromTerminal();
      if (!userContent) {
        console.error('Error: Empty input. Nothing was written.');
        process.exit(1);
      }

      const userFilePath = appendUserMessage(config.directory, files, userContent);
      console.log(`Saved user message: ${userFilePath}`);
      files = scanDirectory(config.directory);
    }
    if (files.length === 0) {
      console.error('Error: No files found matching the pattern [{idx}]{role}.md or [{idx}]{role}.json');
      process.exit(1);
    }

    const messages = readFiles(files);
    const quiet = config.quiet;

    console.log(`Calling AI API with ${messages.length} messages...`);
    let response = '';
    if (config.format === 'json') {
      response = await callAI(
        config.apiKey,
        config.apiBaseUrl,
        config.model,
        messages
      );
      writeOutputIfConfigured(config.output, response);
      if (!quiet) {
        process.stdout.write(`${JSON.stringify({ response }, null, 2)}\n`);
      }
    } else {
      response = await callAIStream(
        config.apiKey,
        config.apiBaseUrl,
        config.model,
        messages,
        (chunk) => {
          if (!quiet) {
            process.stdout.write(chunk);
          }
        }
      );
      writeOutputIfConfigured(config.output, response);
    }

    if (config.continueMode) {
      const savedPath = appendAssistantMessage(config.directory, files, response);
      console.log(`Saved assistant reply: ${savedPath}`);
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
