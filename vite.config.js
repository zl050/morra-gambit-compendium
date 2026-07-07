import { defineConfig } from 'vite';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function copyRepertoireData() {
  const files = ['data/repertoire.json', 'data/cloud-evals.json'];

  return {
    name: 'copy-repertoire-data',
    closeBundle() {
      for (const file of files) {
        const target = resolve('dist', file);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(resolve(file), target);
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [copyRepertoireData()],
});
