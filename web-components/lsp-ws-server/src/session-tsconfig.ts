import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Minimal tsconfig so typescript-language-server has a project root on disk. */
export function writeSessionTsconfig(sessionRoot: string): void {
  const raw = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: true,
      skipLibCheck: true,
      noEmit: true,
    },
    include: ['**/*'],
  };
  writeFileSync(join(sessionRoot, 'tsconfig.json'), `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
}
