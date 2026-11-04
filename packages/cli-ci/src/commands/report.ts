// plx-ci report --mode <mode> <matrix-json>: what the registry holds after a
// build run, every app's digest and, in repro mode, the two builds of each
// app compared layer by layer (ci.md, "Reproducible images"). Needs the
// sidecars running here (`plx-ci registry`).
//
//   plx-ci report --mode repro "$MATRIX"
import type { Command } from 'commander';
import { type Leg, type Mode, report } from '../core/plan.ts';
import { contextOf } from '../program.ts';
import { need } from './shared.ts';

export function register(program: Command): void {
  program
    .command('report')
    .description('the digests the registry holds for a run’s matrix, and in repro mode the layer-by-layer comparison')
    .argument('<matrix>', 'the plan’s matrix, JSON')
    .requiredOption('--mode <mode>', 'build, force or repro')
    .action(async (matrix: string, opts: { mode: Mode }, command: Command) => {
      const ctx = contextOf(command);
      const legs = JSON.parse(matrix) as Leg[];
      const result = await report(ctx, legs, opts.mode, need('GITHUB_RUN_ID'));
      ctx.result(result, (r) =>
        r
          .map(
            (c) =>
              `${c.app} build-${c.hash}: ${c.digest ?? 'missing'}${c.repro ? (c.repro.identical ? ' reproducible' : ` ${c.repro.same}/${c.repro.layers} layers identical`) : ''}`,
          )
          .join('\n'),
      );
    });
}
