import { compile } from './dist/esm/development/compiler.mjs';

const code = `
async function example() {
  example:
  while (true) {
    'use server';
    const random = Math.random();
    if (random > 0.75) {
      return 'returned';
    } else if (random > 0.5) {
      break example;
    }
  }
  return 'broken';
}
`;

console.log(
  (
    await compile('example.ts', code, {
      directive: 'use server',
      mode: 'server',
    })
  ).code,
);
