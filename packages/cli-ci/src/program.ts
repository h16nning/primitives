// The commander program of plx-ci: the global options plx has, and the CI
// commands. plx-ci is the CI half of the Plexus tooling (PLX-Delivery,
// Maintaining): what a pipeline runs on a forge's runner or on a throwaway
// instance, kept apart from plx so that a CI strategy can change in one
// tenant without moving every tenant's plx. Same shape as plx: argv in, a
// lib Context is the only way a command touches the world, the logic lives
// under core/ and is tested there with a fake Io. Adding a command is one
// module under commands/ exporting `register(program)`, listed in commands/index.ts.
import { createRequire } from 'node:module';
import { Context, type Options, realIo } from '@plexus-ms/lib';
import { Command, Option } from 'commander';
import { commands } from './commands/index.ts';

export const { version, description } = createRequire(import.meta.url)('../package.json') as {
  version: string;
  description: string;
};

export function buildProgram(): Command {
  const program = new Command('plx-ci')
    .description(description)
    .version(version, '-V, --version')
    .showHelpAfterError('(run with --help for usage)')
    .showSuggestionAfterError()
    .configureOutput({ writeErr: (s) => process.stderr.write(s) });

  program
    .addOption(new Option('-n, --dry-run', 'print every effect this run would have, perform none').env('PLX_DRY_RUN'))
    .addOption(
      new Option('-v, --verbose', 'say more: once for reads and inputs, twice for command output')
        .argParser((_value, previous: number) => previous + 1)
        .default(0),
    )
    .addOption(new Option('-q, --quiet', 'say nothing but results and errors').env('PLX_QUIET'))
    .addOption(new Option('-y, --yes', 'answer every confirmation with yes (needed off a terminal)').env('PLX_YES'))
    .addOption(new Option('--json', 'print results as JSON').env('PLX_JSON'));

  for (const register of commands) register(program);
  return program;
}

/** The Context for a command's action, built from the root's global options; CI has no terminal, so no prompt. */
export function contextOf(command: Command): Context {
  const opts = command.optsWithGlobals() as Options;
  return new Context(opts, realIo());
}
