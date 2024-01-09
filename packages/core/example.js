import { compile } from './dist/esm/development/compiler.mjs';
import fs from 'fs/promises';

console.log(
  (
    await compile('input.ts', await fs.readFile('./input.js', 'utf-8'), {
      directive: 'use server',
      mode: 'server',
    })
  ).code,
);
