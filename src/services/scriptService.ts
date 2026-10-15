import * as vm from 'vm';
import * as crypto from 'crypto';
import { ScriptConsoleLog, TestResultItem } from '../types';

export interface PreRequestScriptContext {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  environmentVariables: Record<string, string>;
  collectionVariables: Record<string, string>;
  resolvedVariables: Record<string, string>;
}

export interface PreRequestScriptResult {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  envMutations: Record<string, string | null>;
  colMutations: Record<string, string | null>;
  consoleLogs: ScriptConsoleLog[];
  error?: string;
}

export interface PostResponseScriptContext {
  url: string;
  method: string;
  requestHeaders: Record<string, string>;
  requestBody?: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  elapsedMs: number;
  environmentVariables: Record<string, string>;
  collectionVariables: Record<string, string>;
  resolvedVariables: Record<string, string>;
}

export interface PostResponseScriptResult {
  envMutations: Record<string, string | null>;
  colMutations: Record<string, string | null>;
  testResults: TestResultItem[];
  consoleLogs: ScriptConsoleLog[];
  error?: string;
}

export class ScriptService {
  private readonly defaultTimeoutMs: number;

  constructor(timeoutMs = 3000) {
    this.defaultTimeoutMs = timeoutMs;
  }

  /**
   * Executes a Pre-Request JavaScript script in a secure sandbox.
   * Can mutate request URL, method, headers, body, and environment/collection variables.
   */
  public executePreRequest(
    script: string,
    context: PreRequestScriptContext
  ): PreRequestScriptResult {
    const trimmed = (script || '').trim();
    if (!trimmed) {
      return {
        url: context.url,
        method: context.method,
        headers: { ...context.headers },
        body: context.body,
        envMutations: {},
        colMutations: {},
        consoleLogs: [],
      };
    }

    const consoleLogs: ScriptConsoleLog[] = [];
    const envMutations: Record<string, string | null> = {};
    const colMutations: Record<string, string | null> = {};

    const envMap = { ...context.environmentVariables };
    const colMap = { ...context.collectionVariables };
    const varMap = { ...context.resolvedVariables };

    const reqObj = {
      url: context.url,
      method: (context.method || 'GET').toUpperCase(),
      headers: { ...context.headers },
      body: context.body || '',
    };

    const envStore = {
      get: (k: string) => envMap[k],
      set: (k: string, v: unknown) => {
        const valStr = v !== undefined && v !== null ? String(v) : '';
        envMap[k] = valStr;
        varMap[k] = valStr;
        envMutations[k] = valStr;
      },
      unset: (k: string) => {
        delete envMap[k];
        delete varMap[k];
        envMutations[k] = null;
      },
      has: (k: string) => Object.prototype.hasOwnProperty.call(envMap, k),
    };

    const colStore = {
      get: (k: string) => colMap[k],
      set: (k: string, v: unknown) => {
        const valStr = v !== undefined && v !== null ? String(v) : '';
        colMap[k] = valStr;
        varMap[k] = valStr;
        colMutations[k] = valStr;
      },
      unset: (k: string) => {
        delete colMap[k];
        delete varMap[k];
        colMutations[k] = null;
      },
      has: (k: string) => Object.prototype.hasOwnProperty.call(colMap, k),
    };

    const varStore = {
      get: (k: string) => varMap[k] ?? envMap[k] ?? colMap[k],
      set: (k: string, v: unknown) => {
        const valStr = v !== undefined && v !== null ? String(v) : '';
        varMap[k] = valStr;
      },
    };

    const bbContext = {
      request: reqObj,
      environment: envStore,
      collection: colStore,
      collectionVariables: colStore,
      variables: varStore,
      info: {
        eventName: 'prerequest',
        iteration: 1,
      },
    };

    const sandbox = this.createBaseSandbox(consoleLogs);
    sandbox.bn = bbContext;
    sandbox.bb = bbContext;
    sandbox.pm = bbContext;
    sandbox.request = reqObj;
    sandbox.environment = envStore;
    sandbox.collection = colStore;
    sandbox.collectionVariables = colStore;
    sandbox.variables = varStore;

    let scriptError: string | undefined;
    try {
      const vmContext = vm.createContext(sandbox);
      const compiled = new vm.Script(trimmed, { filename: 'pre-request-script.js' });
      compiled.runInContext(vmContext, { timeout: this.defaultTimeoutMs });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      scriptError = errMsg;
      consoleLogs.push({
        level: 'error',
        message: `Pre-Request Script Error: ${errMsg}`,
        timestamp: Date.now(),
      });
    }

    return {
      url: typeof reqObj.url === 'string' ? reqObj.url : context.url,
      method: typeof reqObj.method === 'string' ? reqObj.method : context.method,
      headers: typeof reqObj.headers === 'object' && reqObj.headers !== null ? reqObj.headers : context.headers,
      body: typeof reqObj.body === 'string' ? reqObj.body : context.body,
      envMutations,
      colMutations,
      consoleLogs,
      error: scriptError,
    };
  }

  /**
   * Executes a Post-Response JavaScript test & assertion script in a secure sandbox.
   * Has access to response data, can run assertions (bb.test / bb.expect), and save environment variables.
   */
  public executePostResponse(
    script: string,
    context: PostResponseContextHelper
  ): PostResponseScriptResult {
    const trimmed = (script || '').trim();
    if (!trimmed) {
      return {
        envMutations: {},
        colMutations: {},
        testResults: [],
        consoleLogs: [],
      };
    }

    const consoleLogs: ScriptConsoleLog[] = [];
    const testResults: TestResultItem[] = [];
    const envMutations: Record<string, string | null> = {};
    const colMutations: Record<string, string | null> = {};

    const envMap = { ...context.environmentVariables };
    const colMap = { ...context.collectionVariables };
    const varMap = { ...context.resolvedVariables };

    const envStore = {
      get: (k: string) => envMap[k],
      set: (k: string, v: unknown) => {
        const valStr = v !== undefined && v !== null ? String(v) : '';
        envMap[k] = valStr;
        varMap[k] = valStr;
        envMutations[k] = valStr;
      },
      unset: (k: string) => {
        delete envMap[k];
        delete varMap[k];
        envMutations[k] = null;
      },
      has: (k: string) => Object.prototype.hasOwnProperty.call(envMap, k),
    };

    const colStore = {
      get: (k: string) => colMap[k],
      set: (k: string, v: unknown) => {
        const valStr = v !== undefined && v !== null ? String(v) : '';
        colMap[k] = valStr;
        varMap[k] = valStr;
        colMutations[k] = valStr;
      },
      unset: (k: string) => {
        delete colMap[k];
        delete varMap[k];
        colMutations[k] = null;
      },
      has: (k: string) => Object.prototype.hasOwnProperty.call(colMap, k),
    };

    const varStore = {
      get: (k: string) => varMap[k] ?? envMap[k] ?? colMap[k],
      set: (k: string, v: unknown) => {
        const valStr = v !== undefined && v !== null ? String(v) : '';
        varMap[k] = valStr;
      },
    };

    let parsedJsonCache: unknown = undefined;
    let jsonParsed = false;

    const respObj = {
      status: context.status,
      code: context.status,
      statusText: context.statusText,
      headers: { ...context.headers },
      responseTime: context.elapsedMs,
      elapsedMs: context.elapsedMs,
      text: () => context.body,
      json: () => {
        if (!jsonParsed) {
          jsonParsed = true;
          try {
            parsedJsonCache = JSON.parse(context.body);
          } catch (e: unknown) {
            const err = e instanceof Error ? e.message : String(e);
            throw new Error(`Failed to parse response body as JSON: ${err}`);
          }
        }
        return parsedJsonCache;
      },
      body: context.body,
      to: {
        have: {
          status: (expectedCode: number) => {
            if (context.status !== expectedCode) {
              throw new Error(`expected response status ${context.status} to equal ${expectedCode}`);
            }
          },
          header: (name: string, expectedVal?: string) => {
            const headerKey = Object.keys(context.headers).find(k => k.toLowerCase() === name.toLowerCase());
            if (!headerKey) {
              throw new Error(`expected header "${name}" to be present`);
            }
            if (expectedVal !== undefined && context.headers[headerKey] !== expectedVal) {
              throw new Error(`expected header "${name}" to equal "${expectedVal}", got "${context.headers[headerKey]}"`);
            }
          },
        },
        be: {
          success: () => {
            if (context.status < 200 || context.status >= 300) {
              throw new Error(`expected success status (2xx), got ${context.status}`);
            }
          },
          error: () => {
            if (context.status < 400) {
              throw new Error(`expected error status (>=400), got ${context.status}`);
            }
          },
        },
      },
    };

    const reqObj = {
      url: context.url,
      method: (context.method || 'GET').toUpperCase(),
      headers: { ...context.requestHeaders },
      body: context.requestBody || '',
    };

    const testFn = (testName: string, testCallback: () => void) => {
      try {
        testCallback();
        testResults.push({ name: testName, passed: true });
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        testResults.push({ name: testName, passed: false, error: errMsg });
      }
    };

    const expectFn = (actual: unknown) => this.createExpectChain(actual);

    const bbContext = {
      request: reqObj,
      response: respObj,
      environment: envStore,
      collection: colStore,
      collectionVariables: colStore,
      variables: varStore,
      test: testFn,
      expect: expectFn,
      info: {
        eventName: 'test',
        iteration: 1,
      },
    };

    const sandbox = this.createBaseSandbox(consoleLogs);
    sandbox.bn = bbContext;
    sandbox.bb = bbContext;
    sandbox.pm = bbContext;
    sandbox.test = testFn;
    sandbox.expect = expectFn;
    sandbox.response = respObj;
    sandbox.request = reqObj;
    sandbox.environment = envStore;
    sandbox.collection = colStore;
    sandbox.collectionVariables = colStore;
    sandbox.variables = varStore;

    let scriptError: string | undefined;
    try {
      const vmContext = vm.createContext(sandbox);
      const compiled = new vm.Script(trimmed, { filename: 'post-response-script.js' });
      compiled.runInContext(vmContext, { timeout: this.defaultTimeoutMs });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      scriptError = errMsg;
      consoleLogs.push({
        level: 'error',
        message: `Post-Response Script Error: ${errMsg}`,
        timestamp: Date.now(),
      });
      // If error occurred outside bb.test blocks, record a top-level failed test
      if (testResults.length === 0) {
        testResults.push({
          name: 'Script Execution',
          passed: false,
          error: errMsg,
        });
      }
    }

    return {
      envMutations,
      colMutations,
      testResults,
      consoleLogs,
      error: scriptError,
    };
  }

  /**
   * Constructs the base sandbox with standard utilities, crypto, and captured console.
   */
  private createBaseSandbox(consoleLogs: ScriptConsoleLog[]): Record<string, unknown> {
    const capturedConsole = {
      log: (...args: unknown[]) => {
        consoleLogs.push({
          level: 'log',
          message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '),
          timestamp: Date.now(),
        });
      },
      info: (...args: unknown[]) => {
        consoleLogs.push({
          level: 'info',
          message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '),
          timestamp: Date.now(),
        });
      },
      warn: (...args: unknown[]) => {
        consoleLogs.push({
          level: 'warn',
          message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '),
          timestamp: Date.now(),
        });
      },
      error: (...args: unknown[]) => {
        consoleLogs.push({
          level: 'error',
          message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '),
          timestamp: Date.now(),
        });
      },
    };

    return {
      console: capturedConsole,
      crypto,
      Buffer,
      atob: (s: string) => Buffer.from(s, 'base64').toString('binary'),
      btoa: (s: string) => Buffer.from(s, 'binary').toString('base64'),
      encodeURIComponent,
      decodeURIComponent,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      Date,
      Math,
      JSON,
      RegExp,
      Array,
      Object,
      String,
      Number,
      Boolean,
    };
  }

  /**
   * Chainable expect assertion helper (Jest / Chai / Postman parity).
   */
  private createExpectChain(actual: unknown, isNot = false) {
    const self = this;
    const assertCondition = (condition: boolean, passMsg: string, failMsg: string) => {
      const passed = isNot ? !condition : condition;
      if (!passed) {
        throw new Error(isNot ? failMsg : passMsg);
      }
    };

    const chain: Record<string, unknown> = {
      get not() {
        return self.createExpectChain(actual, !isNot);
      },
      get to() {
        return chain;
      },
      get be() {
        return chain;
      },
      get have() {
        return chain;
      },
      get and() {
        return chain;
      },

      toBe: (expected: unknown) => {
        assertCondition(
          actual === expected,
          `expected ${JSON.stringify(actual)} to be ${JSON.stringify(expected)}`,
          `expected ${JSON.stringify(actual)} NOT to be ${JSON.stringify(expected)}`
        );
      },

      toEqual: (expected: unknown) => {
        assertCondition(
          JSON.stringify(actual) === JSON.stringify(expected),
          `expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`,
          `expected ${JSON.stringify(actual)} NOT to equal ${JSON.stringify(expected)}`
        );
      },

      equal: (expected: unknown) => {
        assertCondition(
          actual === expected || JSON.stringify(actual) === JSON.stringify(expected),
          `expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`,
          `expected ${JSON.stringify(actual)} NOT to equal ${JSON.stringify(expected)}`
        );
      },

      eql: (expected: unknown) => {
        assertCondition(
          JSON.stringify(actual) === JSON.stringify(expected),
          `expected ${JSON.stringify(actual)} to deeply equal ${JSON.stringify(expected)}`,
          `expected ${JSON.stringify(actual)} NOT to deeply equal ${JSON.stringify(expected)}`
        );
      },

      get true() {
        assertCondition(actual === true, `expected ${actual} to be true`, `expected ${actual} NOT to be true`);
        return chain;
      },

      get false() {
        assertCondition(actual === false, `expected ${actual} to be false`, `expected ${actual} NOT to be false`);
        return chain;
      },

      get null() {
        assertCondition(actual === null, `expected ${actual} to be null`, `expected ${actual} NOT to be null`);
        return chain;
      },

      get undefined() {
        assertCondition(actual === undefined, `expected ${actual} to be undefined`, `expected ${actual} NOT to be undefined`);
        return chain;
      },

      get exist() {
        assertCondition(actual !== null && actual !== undefined, `expected ${actual} to exist`, `expected ${actual} NOT to exist`);
        return chain;
      },

      include: (val: unknown) => {
        let hasIt = false;
        if (typeof actual === 'string' && typeof val === 'string') {
          hasIt = actual.includes(val);
        } else if (Array.isArray(actual)) {
          hasIt = actual.includes(val);
        } else if (typeof actual === 'object' && actual !== null && typeof val === 'string') {
          hasIt = Object.prototype.hasOwnProperty.call(actual, val);
        }
        assertCondition(
          hasIt,
          `expected ${JSON.stringify(actual)} to include ${JSON.stringify(val)}`,
          `expected ${JSON.stringify(actual)} NOT to include ${JSON.stringify(val)}`
        );
      },

      status: (expectedStatus: number) => {
        const actualStatus = typeof actual === 'number' ? actual : (actual as any)?.status;
        assertCondition(
          actualStatus === expectedStatus,
          `expected status code ${actualStatus} to equal ${expectedStatus}`,
          `expected status code ${actualStatus} NOT to equal ${expectedStatus}`
        );
      },

      property: (propName: string, expectedVal?: unknown) => {
        const hasProp = typeof actual === 'object' && actual !== null && Object.prototype.hasOwnProperty.call(actual, propName);
        assertCondition(
          hasProp,
          `expected object to have property "${propName}"`,
          `expected object NOT to have property "${propName}"`
        );
        if (expectedVal !== undefined && hasProp) {
          const actualVal = (actual as Record<string, unknown>)[propName];
          assertCondition(
            actualVal === expectedVal || JSON.stringify(actualVal) === JSON.stringify(expectedVal),
            `expected property "${propName}" to equal ${JSON.stringify(expectedVal)}, got ${JSON.stringify(actualVal)}`,
            `expected property "${propName}" NOT to equal ${JSON.stringify(expectedVal)}`
          );
        }
      },

      a: (typeStr: string) => {
        const actualType = Array.isArray(actual) ? 'array' : typeof actual;
        assertCondition(
          actualType.toLowerCase() === typeStr.toLowerCase(),
          `expected ${JSON.stringify(actual)} to be a ${typeStr}`,
          `expected ${JSON.stringify(actual)} NOT to be a ${typeStr}`
        );
      },

      an: (typeStr: string) => {
        const actualType = Array.isArray(actual) ? 'array' : typeof actual;
        assertCondition(
          actualType.toLowerCase() === typeStr.toLowerCase(),
          `expected ${JSON.stringify(actual)} to be an ${typeStr}`,
          `expected ${JSON.stringify(actual)} NOT to be an ${typeStr}`
        );
      },

      length: (len: number) => {
        const actualLen = (actual as any)?.length;
        assertCondition(
          actualLen === len,
          `expected length ${actualLen} to equal ${len}`,
          `expected length ${actualLen} NOT to equal ${len}`
        );
      },
    };

    return chain;
  }
}

export type PostResponseContextHelper = PostResponseScriptContext;
