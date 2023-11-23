import { compile } from './dist/esm/development/compiler.mjs';

const code = `
const example = async function () {
  "use server";

  return 'test';
}
`;

console.log((await compile(
  'example.ts',
  code,
  {
    directive: 'use server',
    mode: 'server',
  },
)).code);