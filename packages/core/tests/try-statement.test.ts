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

describe('TryStatement', () => {
  describe('client', () => {
    it('should transform valid server try statements', async () => {
      const code = `
      try {
        'use server';
        await doStuff();
      } catch (err) {
        report(err);
      }
      `;
      expect((await compiler.compile(ID, code, CLIENT)).code).toMatchSnapshot();
    });
    it('should skip server try statements in non-async functions', async () => {
      const code = `
      const example = () => {
        try {
          'use server';
          doStuff();
        } catch (err) {
          report(err);
        }
      };
      `;
      expect((await compiler.compile(ID, code, CLIENT)).code).toMatchSnapshot();
    });
    it('should transform valid server functions with scope', async () => {
      const code = `
      async function foo() {
        const value = 'foo bar';
        try {
          'use server';
          await doStuff(value);
        } catch (err) {
          report(err);
        }
      }
      `;
      expect((await compiler.compile(ID, code, CLIENT)).code).toMatchSnapshot();
    });
    it('should skip top-level values for scope', async () => {
      const code = `
      const value = 'foo bar';
      try {
        'use server';
        await doStuff(value);
      } catch (err) {
        report(err);
      }
      `;
      expect((await compiler.compile(ID, code, CLIENT)).code).toMatchSnapshot();
    });
  });
  describe('server', () => {
    it('should transform valid server try statements', async () => {
      const code = `
      try {
        'use server';
        await doStuff();
      } catch (err) {
        report(err);
      }
      `;
      expect((await compiler.compile(ID, code, SERVER)).code).toMatchSnapshot();
    });
    it('should skip server try statements in non-async functions', async () => {
      const code = `
      const example = () => {
        try {
          'use server';
          doStuff();
        } catch (err) {
          report(err);
        }
      };
      `;
      expect((await compiler.compile(ID, code, SERVER)).code).toMatchSnapshot();
    });
    it('should transform valid server functions with scope', async () => {
      const code = `
      async function foo() {
        const value = 'foo bar';
        try {
          'use server';
          await doStuff(value);
        } catch (err) {
          report(err);
        }
      }
      `;
      expect((await compiler.compile(ID, code, SERVER)).code).toMatchSnapshot();
    });
    it('should skip top-level values for scope', async () => {
      const code = `
      const value = 'foo bar';
      try {
        'use server';
        await doStuff(value);
      } catch (err) {
        report(err);
      }
      `;
      expect((await compiler.compile(ID, code, SERVER)).code).toMatchSnapshot();
    });
  });
});
