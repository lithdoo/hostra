import { Command } from 'commander';
import { Config } from './types';

const program = new Command();

program
  .name('promptpile')
  .description('Assemble message files and call Chat Completions APIs')
  .version('1.0.0')
  .option('-d, --directory <path>', 'Directory to scan for files')
  .option('-m, --model <model>', 'AI model to use')
  .option('-k, --api-key <key>', 'AI API key')
  .option('-b, --api-base-url <url>', 'AI API base URL')
  .option('-o, --output <path>', 'Output file path for AI response')
  .option('-q, --quiet', 'Disable normal stdout logs and response output')
  .option('-f, --format <format>', 'Output format (text or json)', 'text')
  .option('-i, --input', 'Read user input from terminal and append as next user message')
  .option('-c, --continue', 'Append assistant reply to next message file')
  .parse(process.argv);

export const getCliOptions = (): Partial<Config> => {
  const options = program.opts();
  return {
    directory: options.directory,
    model: options.model,
    apiKey: options.apiKey,
    apiBaseUrl: options.apiBaseUrl,
    output: options.output,
    // Do not coerce with Boolean(): undefined must reach loadConfig so QUIET env applies.
    quiet: options.quiet as boolean | undefined,
    format: options.format as 'text' | 'json',
    continueMode: Boolean(options.continue),
    inputMode: Boolean(options.input)
  };
};
