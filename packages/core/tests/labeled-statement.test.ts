import { describe, it, expect } from 'vitest';
import * as compiler from '../compiler';

const SERVER: compiler.Options = {
  directive: 'use server',
  mode: 'server',
};
const CLIENT: compiler.Options = {
  directive: 'use server',
  mode: 'client',
};
const ID = 'example.ts';

describe('LabeledStatement', () => {
  describe('client', () => {
    it('should transform valid server labeled statements', async () => {
      const code = `
      foo: {
        'use server';
        await doStuff();
      }
      `;
      expect((await compiler.compile(ID, code, CLIENT)).code).toMatchSnapshot();
    });
    it('should skip server labeled statements in non-async functions', async () => {
      const code = `
      const example = () => {
        foo: {
          'use server';
          doStuff();
        }
      };
      `;
      expect((await compiler.compile(ID, code, CLIENT)).code).toMatchSnapshot();
    });
    it('should transform valid server functions with scope', async () => {
      const code = `
      async function foo() {
        const value = 'foo bar';
        foo: {
          'use server';
          await doStuff(value);
        }
      }
      `;
      expect((await compiler.compile(ID, code, CLIENT)).code).toMatchSnapshot();
    });
    it('should skip top-level values for scope', async () => {
      const code = `
      const value = 'foo bar';
      foo: {
        'use server';
        await doStuff(value);
      }
      `;
      expect((await compiler.compile(ID, code, CLIENT)).code).toMatchSnapshot();
    });
    it('should transform break statements', async () => {
      const code = `
      foo: {
        'use server';
        if (cond()) {
          await doStuff(value);
        } else {
          break foo;
        }
        await doMoreStuff();
      }
      `;
      expect((await compiler.compile(ID, code, CLIENT)).code).toMatchSnapshot();
    });
  });
  describe('server', () => {
    it('should transform valid server labeled statements', async () => {
      const code = `
      foo: {
        'use server';
        await doStuff();
      }
      `;
      expect((await compiler.compile(ID, code, SERVER)).code).toMatchSnapshot();
    });
    it('should skip server labeled statements in non-async functions', async () => {
      const code = `
      const example = () => {
        foo: {
          'use server';
          doStuff();
        }
      };
      `;
      expect((await compiler.compile(ID, code, SERVER)).code).toMatchSnapshot();
    });
    it('should transform valid server functions with scope', async () => {
      const code = `
      async function foo() {
        const value = 'foo bar';
        foo: {
          'use server';
          await doStuff(value);
        }
      }
      `;
      expect((await compiler.compile(ID, code, SERVER)).code).toMatchSnapshot();
    });
    it('should skip top-level values for scope', async () => {
      const code = `
      const value = 'foo bar';
      foo: {
        'use server';
        await doStuff(value);
      }
      `;
      expect((await compiler.compile(ID, code, SERVER)).code).toMatchSnapshot();
    });
    it('should transform break statements', async () => {
      const code = `
      foo: {
        'use server';
        if (cond()) {
          await doStuff(value);
        } else {
          break foo;
        }
        await doMoreStuff();
      }
      `;
      expect((await compiler.compile(ID, code, SERVER)).code).toMatchSnapshot();
    });
  });
});
